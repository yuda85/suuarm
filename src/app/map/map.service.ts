import { inject, Injectable, signal } from '@angular/core';
import { SimHost } from '../core/state/sim-host.service';
import { AnnotationKind, makeAnnotation } from './tools/annotations';
import type { StyleSpecification } from 'maplibre-gl';
import { runtimeConfig } from '../core/config/runtime-config';
import { buildStyle } from './style/style-builder';
import { CameraController } from './camera/camera-controller';
import { MapEngine } from './map-engine';
import { RenderLoop } from './render-loop';
import { DrawKind, DrawTool } from './tools/draw-tool';
import { Ring, Vec2 } from '../core/domain/geometry';
import { LngLatBounds } from 'maplibre-gl';

export type ToolKind = 'distance' | 'area' | 'radius' | 'poi' | 'coord' | 'geofence';

/** Imperative bridge from Angular UI to the map runtime (camera moves, focus). */
@Injectable({ providedIn: 'root' })
export class MapService {
  engine: MapEngine | null = null;
  camera: CameraController | null = null;
  loop: RenderLoop | null = null;
  drawTool: DrawTool | null = null;
  /** lng/lat polygon where basemap buildings are suppressed (synthetic campus). */
  excludeArea: GeoJSON.Polygon | undefined;
  /** Active drawing kind (null when not drawing). */
  readonly drawing = signal<DrawKind | null>(null);
  /** Active map tool (measurement / POI / geofence). */
  readonly tool = signal<ToolKind | null>(null);
  readonly annotationCount = signal(0);
  readonly lastCopied = signal<string | null>(null);
  private readonly sim = inject(SimHost);
  private fenceSeq = 0;
  readonly ready = signal(false);
  readonly cursor = signal<{ lng: number; lat: number } | null>(null);
  readonly bearing = signal(0);
  readonly pitch = signal(0);
  readonly zoom = signal(14);

  attach(engine: MapEngine, camera: CameraController, loop: RenderLoop): void {
    this.engine = engine;
    this.camera = camera;
    this.loop = loop;
    this.ready.set(true);
  }

  detach(): void {
    this.engine = this.camera = this.loop = null;
    this.ready.set(false);
  }

  /** Style for sensor-view mini maps (imagery, no labels, solid structures). */
  sensorStyle(): StyleSpecification {
    return buildStyle({
      provider: this.engine?.provider ?? 'OPENFREEMAP',
      basemap: 'SATELLITE',
      terrain: true,
      buildings: true,
      sensorView: true,
      maptilerKey: runtimeConfig().maptilerKey,
      excludeArea: this.excludeArea,
    });
  }

  /** Tactical style for PIP insets. */
  tacticalStyle(): StyleSpecification {
    return buildStyle({
      provider: this.engine?.provider ?? 'OPENFREEMAP',
      basemap: 'VECTOR',
      terrain: false,
      buildings: true,
      maptilerKey: runtimeConfig().maptilerKey,
      excludeArea: this.excludeArea,
    });
  }

  async draw(kind: DrawKind): Promise<Vec2[] | null> {
    if (!this.drawTool) return null;
    this.drawing.set(kind);
    const pts = await this.drawTool.start(kind);
    this.drawing.set(null);
    return pts;
  }

  async useTool(kind: ToolKind): Promise<void> {
    if (this.tool() === kind) {
      this.cancelDraw();
      return;
    }
    this.cancelDraw();
    this.tool.set(kind);
    const drawKind: DrawKind = kind === 'distance' ? 'line' : kind === 'radius' ? 'circle' : kind === 'poi' || kind === 'coord' ? 'point' : 'polygon';
    const pts = await this.draw(drawKind);
    this.tool.set(null);
    const loop = this.loop;
    if (!pts || !loop) return;
    if (kind === 'geofence') {
      const n = ++this.fenceSeq;
      this.sim.dispatch({
        type: 'ADD_GEOFENCE',
        fence: { id: `GF-OP-${n}`, name: `NO-FLY ${n}`, ring: pts, floor: 0, ceiling: 150, kind: 'NO_FLY', appliesToFleet: true },
      });
      return;
    }
    const a = makeAnnotation(kind as AnnotationKind, pts, loop.geo);
    loop.annotations = [...loop.annotations, a];
    this.annotationCount.set(loop.annotations.length);
    if (kind === 'coord') {
      void navigator.clipboard?.writeText(a.label).catch(() => undefined);
      this.lastCopied.set(a.label);
      setTimeout(() => this.lastCopied.set(null), 2500);
    }
  }

  clearAnnotations(): void {
    if (this.loop) this.loop.annotations = [];
    this.annotationCount.set(0);
  }

  cancelDraw(): void {
    this.drawTool?.cancel();
  }

  fitRing(ring: Ring): void {
    const loop = this.loop;
    const m = this.engine?.map;
    if (!loop || !m || this.camera?.isDriving) return;
    const b = new LngLatBounds();
    for (const p of ring) b.extend(loop.geo.toLngLat(p.x, p.y));
    m.fitBounds(b, { padding: { top: 120, bottom: 100, left: 380, right: 440 }, maxZoom: 17.2, duration: 1100 });
  }

  zoomToFleet(): void {
    const loop = this.loop;
    if (!loop || !this.camera) return;
    this.camera.fitVehicles(loop.frame.vehicles);
  }

  focusVehicle(id: string): void {
    const rv = this.loop?.frame.vehicles.find((v) => v.id === id);
    if (rv && this.camera && !this.camera.isDriving) this.camera.flyToVehicle(rv);
  }

  flyToLocal(x: number, y: number, zoom = 15.2): void {
    const loop = this.loop;
    const m = this.engine?.map;
    if (!loop || !m || this.camera?.isDriving) return;
    const ll = loop.geo.toLngLat(x, y);
    m.flyTo({ center: ll, zoom: Math.max(m.getZoom(), zoom), duration: 1200, essential: true });
  }

  flyToView(v: { center: [number, number]; zoom: number; pitch: number; bearing: number }): void {
    this.engine?.map.flyTo({ center: v.center, zoom: v.zoom, pitch: v.pitch || 50, bearing: v.bearing, duration: 1600, essential: true });
  }

  resetNorth(): void {
    this.engine?.map.easeTo({ bearing: 0, duration: 600 });
  }

  zoomBy(delta: number): void {
    const m = this.engine?.map;
    if (m) m.easeTo({ zoom: m.getZoom() + delta, duration: 250 });
  }
}
