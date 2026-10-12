import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { runtimeConfig } from '../core/config/runtime-config';
import { OpsStore } from '../core/state/ops-store';
import { SensorStore } from '../core/state/sensor.store';
import { SimHost } from '../core/state/sim-host.service';
import { LocalFrame } from '../core/world/geo';
import { CameraController } from './camera/camera-controller';
import { MapEngine } from './map-engine';
import { setDemCeiling } from './style/dem-protocol';
import { MapService } from './map.service';
import { RenderVehicle } from './render-frame';
import { ClusterItem } from './clustering/cluster-engine';
import { TrackDatum } from './layers/track-layers';
import { DrawTool } from './tools/draw-tool';
import { RenderLoop } from './render-loop';
import { TerrainSampler } from './terrain-sampler';

/** The only DOM the map owns. Everything spatial is GPU-rendered inside. */
@Component({
  selector: 'app-map-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-fx]': 'fx()', '[attr.data-palette]': 'sensors.thermalPalette()' },
  template: `<div #mapEl class="map" role="application" aria-label="Operational map"></div>`,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: var(--z-map);
      background: var(--c-app);
    }
    .map {
      position: absolute;
      inset: 0;
    }
  `,
})
export class MapHost {
  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');
  private readonly store = inject(OpsStore);
  private readonly sim = inject(SimHost);
  private readonly svc = inject(MapService);
  private readonly sensors = inject(SensorStore);
  private engine: MapEngine | null = null;
  private camera: CameraController | null = null;
  private loop: RenderLoop | null = null;

  /** Sensor visual simulation active on the main canvas (only inside SENSOR POV). */
  protected readonly fx = computed(() => (this.store.cameraMode() === 'SENSOR_POV' ? this.sensors.povType() : null));

  constructor() {
    afterNextRender(() => this.init());
    inject(DestroyRef).onDestroy(() => this.teardown());

    // Basemap / terrain / buildings / 2D-3D / sensor view → style
    effect(() => {
      const fx = this.fx();
      const optical = fx === 'EO' || fx === 'THERMAL' || fx === 'IR';
      const basemap = optical ? 'SATELLITE' : this.store.basemap();
      const terrain = this.store.terrain() && this.store.viewDim() === '3D';
      const buildings = this.store.buildings() || optical;
      untracked(() => this.engine?.updateStyle({ basemap, terrain, buildings, sensorView: optical }));
    });

    // Camera mode → controller
    effect(() => {
      const mode = this.store.cameraMode();
      const target = this.store.selectedId();
      untracked(() => {
        const cam = this.camera;
        if (!cam) return;
        if (cam.mode === mode && (cam.targetId === target || !cam.isDriving)) return;
        const focus = this.loop?.frame.vehicles.find((v) => v.id === target) ?? null;
        cam.setMode(mode, { targetId: target, focus, fleet: this.loop?.frame.vehicles });
      });
    });

    // 2D/3D dimension → camera mode
    effect(() => {
      const dim = this.store.viewDim();
      untracked(() => {
        const mode = this.store.cameraMode();
        if (dim === '2D' && mode !== 'FREE_2D') this.store.cameraMode.set('FREE_2D');
        if (dim === '3D' && mode === 'FREE_2D') this.store.cameraMode.set('FREE_3D');
      });
    });
  }

  private init(): void {
    // Never leave the operator on a boot screen if the basemap is slow/unavailable.
    setTimeout(() => this.store.mapReady.set(true), 9000);
    const scenario = this.sim.engine.scenario;
    setDemCeiling(scenario.terrainCeiling ?? 9000);
    const geo = new LocalFrame(scenario.origin[0], scenario.origin[1]);
    const key = runtimeConfig().maptilerKey;
    const plot = scenario.campus?.plot;
    const excludeArea: GeoJSON.Polygon | undefined = plot
      ? { type: 'Polygon', coordinates: [[...plot.map((p) => geo.toLngLat(p.x, p.y)), geo.toLngLat(plot[0].x, plot[0].y)]] }
      : undefined;
    this.svc.excludeArea = excludeArea;
    const provider = key ? 'MAPTILER' : 'OPENFREEMAP';
    this.store.mapProvider.set(provider);

    const engine = new MapEngine(
      this.mapEl().nativeElement,
      scenario.view,
      {
        provider,
        maptilerKey: key,
        basemap: this.store.basemap(),
        terrain: this.store.terrain() && this.store.viewDim() === '3D',
        buildings: this.store.buildings(),
        excludeArea,
      },
      {
        onProviderChange: (p) => this.store.mapProvider.set(p),
        onClick: (info) => {
          if (this.svc.drawTool?.active) return;
          const obj = info.object as (RenderVehicle | ClusterItem | TrackDatum) | undefined;
          if (obj && 't' in obj && 'label' in obj) this.store.selectTrack(obj.t.id);
          else if (obj && 'cls' in obj) this.store.select(obj.id);
          else if (obj && 'count' in obj) this.expandCluster(obj);
          else if (!this.camera?.isDriving) {
            this.store.select(null);
            this.store.selectTrack(null);
          }
        },
        onHover: (info) => {
          const obj = info.object as (RenderVehicle | ClusterItem) | undefined;
          this.store.hoveredId.set(obj && 'cls' in obj ? obj.id : null);
          const x = (info as { x?: number }).x ?? 0;
          const y = (info as { y?: number }).y ?? 0;
          this.store.hoveredCluster.set(obj && 'count' in obj ? { x, y, count: obj.count, states: obj.states, caps: obj.caps } : null);
        },
      },
    );
    const map = engine.map;
    const terrain = new TerrainSampler(map, geo);
    const camera = new CameraController(engine, geo);
    camera.onModeChanged = (m) => this.store.cameraMode.set(m);
    const loop = new RenderLoop(engine, this.sim, this.store, this.sensors, camera, terrain, geo);
    camera.povSensor = (id) => {
      const sol = loop.solutions.get(id);
      const slot = this.sensors.pov();
      if (!sol || !slot) return null;
      const type = this.sensors.payload(slot)?.type;
      return { vehicleId: id, azimuth: sol.azimuth, elevation: sol.elevation, vfov: sol.vfov, radar: type === 'RADAR' };
    };

    map.on('styledata', () => terrain.reset());
    map.on('mousemove', (e) => this.svc.cursor.set({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
    map.on('move', () => {
      this.svc.bearing.set(map.getBearing());
      this.svc.pitch.set(map.getPitch());
      this.svc.zoom.set(map.getZoom());
    });
    map.once('load', () => {
      this.store.mapReady.set(true);
      // Collapse attribution to its (i) button; full credits stay one click away.
      map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      if (this.store.viewDim() === '3D') map.easeTo({ pitch: 58, bearing: -28, zoom: 15.6, duration: 2400, essential: true });
    });

    const draw = new DrawTool(map, geo);
    loop.draw = draw;
    this.svc.drawTool = draw;
    this.engine = engine;
    this.camera = camera;
    this.loop = loop;
    this.svc.attach(engine, camera, loop);
    loop.start();
  }

  private expandCluster(c: ClusterItem): void {
    const map = this.engine?.map;
    const loop = this.loop;
    if (!map || !loop || this.camera?.isDriving) return;
    const z = Math.min(16, Math.max(map.getZoom() + 1.5, loop.clusters.expansionZoom(c.id) + 0.4));
    map.flyTo({ center: [c.position[0], c.position[1]], zoom: z, duration: 900, essential: true });
  }

  private teardown(): void {
    this.svc.drawTool?.destroy();
    this.svc.drawTool = null;
    this.loop?.stop();
    this.camera?.destroy();
    this.engine?.destroy();
    this.svc.detach();
  }
}
