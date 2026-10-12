import type { Layer } from '@deck.gl/core';
import { lerp, lerpAngle, Vec3 } from '../core/domain/geometry';
import { Payload } from '../core/domain/sensor';
import { AirframeClass, displayState } from '../core/domain/vehicle';
import { SensorSolution, solveSensor } from '../core/sensor/sensor-geometry';
import { POSE_STRIDE } from '../core/sim/engine';
import { OpsStore } from '../core/state/ops-store';
import { FEED_LETTERS, SensorStore } from '../core/state/sensor.store';
import { SimHost } from '../core/state/sim-host.service';
import { LocalFrame } from '../core/world/geo';
import { CameraController } from './camera/camera-controller';
import { sceneLayers } from './layers/scene-layers';
import { P3, sensorLayers, SensorView } from './layers/sensor-layers';
import { RouteGeometry, Trail, vehicleLayers } from './layers/vehicle-layers';
import { clusterLayers } from './layers/cluster-layers';
import { ClusterEngine } from './clustering/cluster-engine';
import { missionLayers } from './layers/mission-layers';
import { geofenceLayers, trackLayers } from './layers/track-layers';
import { linkLayers } from './layers/link-layers';
import { Annotation, annotationLayers } from './tools/annotations';
import { LayerKey, LAYER_PREFIXES } from '../core/state/ops-store';
import { DrawTool } from './tools/draw-tool';
import { campusLayers, CampusLook } from './layers/campus-layers';
import { MapEngine } from './map-engine';
import { RenderFrame, RenderVehicle, STATE_RGB } from './render-frame';
import { TerrainSampler } from './terrain-sampler';

const EARTH_CIRC = 40075016.686;

export interface FrameListener {
  render(frame: RenderFrame, now: number): void;
}

/**
 * Animation-frame renderer. Interpolates between the last two 10 Hz sim states and hands deck.gl
 * fresh layer descriptors every frame. Never touches Angular change detection.
 */
export class RenderLoop {
  private raf = 0;
  private gen = -1;
  private sceneKey = '';
  private scene: Layer[] = [];
  private routeKey = '';
  private route: RouteGeometry | null = null;
  readonly frame: RenderFrame = {
    n: 0,
    vehicles: [],
    byClass: { QUAD: [], HEXA: [], VTOL: [], RELAY: [] },
    selected: null,
    hovered: null,
    zoom: 14,
    pitch: 0,
    mpp: 1,
    dim: '3D',
    povId: null,
    fx: null,
  };
  /** Extra layer providers (missions, campus, tools…) registered by features. */
  readonly extraLayers: ((frame: RenderFrame) => Layer[])[] = [];
  /** Secondary views (sensor feeds, PIP) rendered from the same interpolated frame. */
  readonly listeners = new Set<FrameListener>();
  /** Latest sensor solutions keyed by vehicle id (HUD, feeds). */
  readonly solutions = new Map<string, SensorSolution>();
  fps = 60;
  private lastFrameAt = performance.now();
  readonly clusters = new ClusterEngine();
  draw: DrawTool | null = null;
  private worldCache = new Map<string, Layer[]>();
  private fenceKey = '';
  private fenceCache: Layer[] = [];
  private missionKey = '';
  private missionCache: Layer[] = [];
  /** Recent track history per vehicle (1 Hz samples). */
  private readonly trails = new Map<string, [number, number, number][]>();
  private lastTrailAt = 0;

  constructor(
    private readonly engine: MapEngine,
    private readonly sim: SimHost,
    private readonly store: OpsStore,
    private readonly sensors: SensorStore,
    private readonly camera: CameraController,
    readonly terrain: TerrainSampler,
    readonly geo: LocalFrame,
  ) {}

  start(): void {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Local metres (+surface) → [lng, lat, z AMSL]. */
  readonly toWorld = (p: Vec3, surface = 'ground'): P3 => {
    const ll = this.geo.toLngLat(p.x, p.y);
    const g = this.terrain.elevation(p.x, p.y);
    return [ll[0], ll[1], g + Math.max(0, p.z) + (surface === 'ground' ? 0.3 : 0.06)];
  };

  /** Sensor solution for a vehicle/payload at the current interpolated pose. */
  solve(rv: RenderVehicle, payload: Payload): SensorSolution {
    return solveSensor(
      { x: rv.local[0], y: rv.local[1], z: Math.max(0.5, rv.local[2] - 0.35) },
      rv.heading,
      rv.gimbalPan,
      rv.gimbalTilt,
      payload,
      this.sim.engine.prisms,
    );
  }

  private rebuildVehicles(): void {
    const vs = this.sim.engine.vehicles;
    this.frame.vehicles = vs.map((v, i) => ({
      i,
      id: v.id,
      callsign: v.callsign,
      cls: v.platform.airframe,
      capability: v.capability,
      state: displayState(v),
      position: [0, 0, 0],
      ground: [0, 0, 0],
      local: [0, 0, 0],
      heading: 0,
      pitch: 0,
      roll: 0,
      gimbalPan: 0,
      gimbalTilt: 0,
      airborne: false,
      color: [255, 255, 255, 255],
      selected: false,
      hovered: false,
      clustered: false,
    }));
    this.trails.clear();
    const by: Record<AirframeClass, RenderVehicle[]> = { QUAD: [], HEXA: [], VTOL: [], RELAY: [] };
    for (const rv of this.frame.vehicles) by[rv.cls].push(rv);
    this.frame.byClass = by;
  }

  private tick(now: number): void {
    const dtMs = now - this.lastFrameAt;
    this.lastFrameAt = now;
    if (dtMs > 0) this.fps = this.fps * 0.94 + (1000 / dtMs) * 0.06;

    const eng = this.sim.engine;
    const gen = this.sim.generation();
    if (gen !== this.gen) {
      this.gen = gen;
      this.rebuildVehicles();
      this.sceneKey = '';
    }
    const f = this.frame;
    f.n++;
    f.dim = this.store.viewDim();
    const inPov = this.store.cameraMode() === 'SENSOR_POV';
    const povSlot = inPov ? this.sensors.pov() : null;
    f.povId = povSlot?.vehicleId ?? null;
    f.fx = povSlot ? (this.sensors.payload(povSlot)?.type ?? null) : null;

    const alpha = Math.min(1, Math.max(0, (now - this.sim.lastTickAt) / this.sim.stepMs));
    const prev = eng.prevPose;
    const curr = eng.currPose;
    const selId = this.store.selectedId();
    const hovId = this.store.hoveredId();
    f.selected = null;
    f.hovered = null;
    const terrainOn = this.store.terrain() && f.dim === '3D';
    this.terrain.enabled = terrainOn;

    for (let i = 0; i < f.vehicles.length; i++) {
      const rv = f.vehicles[i];
      const v = eng.vehicles[i];
      const o = i * POSE_STRIDE;
      const x = lerp(prev[o], curr[o], alpha);
      const y = lerp(prev[o + 1], curr[o + 1], alpha);
      const z = lerp(prev[o + 2], curr[o + 2], alpha);
      rv.local[0] = x;
      rv.local[1] = y;
      rv.local[2] = z;
      rv.heading = lerpAngle(prev[o + 3], curr[o + 3], alpha);
      rv.pitch = lerp(prev[o + 4], curr[o + 4], alpha);
      rv.roll = lerp(prev[o + 5], curr[o + 5], alpha);
      rv.gimbalPan = lerp(prev[o + 6], curr[o + 6], alpha);
      rv.gimbalTilt = lerp(prev[o + 7], curr[o + 7], alpha);
      const ground = this.terrain.elevation(x, y);
      const ll = this.geo.toLngLat(x, y);
      rv.position[0] = rv.ground[0] = ll[0];
      rv.position[1] = rv.ground[1] = ll[1];
      rv.ground[2] = ground + 0.2;
      rv.position[2] = ground + Math.max(z, 0.35);
      rv.airborne = z > 1.2;
      rv.state = displayState(v);
      const c = STATE_RGB[rv.state];
      rv.color[0] = c[0];
      rv.color[1] = c[1];
      rv.color[2] = c[2];
      rv.color[3] = 255;
      rv.selected = rv.id === selId;
      rv.hovered = rv.id === hovId;
      if (rv.selected) f.selected = rv;
      if (rv.hovered) f.hovered = rv;
    }

    // Sensor solutions: feeds + selected vehicle (+ POV source for the HUD).
    const views = this.computeSensors(f);

    this.camera.update(f, now);

    const map = this.engine.map;
    f.zoom = map.getZoom();
    f.pitch = map.getPitch();
    const lat = map.getCenter().lat;
    f.mpp = (EARTH_CIRC * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, f.zoom));

    const sceneKey = `${gen}|${terrainOn}`;
    if (sceneKey !== this.sceneKey) {
      this.sceneKey = sceneKey;
      const hub = eng.hubs[0];
      this.scene = sceneLayers(eng, this.geo, hub ? this.terrain.elevation(hub.pos.x, hub.pos.y) : 0);
    }

    // Clustering (selected / followed / feed sources always stay individual)
    const keep = new Set<string>();
    if (f.selected) keep.add(f.selected.id);
    for (const slot of this.sensors.feeds()) keep.add(slot.vehicleId);
    this.clusters.update(f, this.store.clustering(), keep, now);
    this.sampleTrails(f, now);

    this.updateRoute(f);
    const look: CampusLook = f.fx === 'EO' ? 'EO' : f.fx === 'THERMAL' || f.fx === 'IR' ? 'THERMAL' : 'TACTICAL';
    const layers: Layer[] = [...this.scene, ...this.worldLayers(look)];
    for (const p of this.extraLayers) layers.push(...p(f));
    if (!f.povId) {
      const mk = `${gen}|${eng.missions.version}|${f.dim}|${terrainOn}`;
      if (mk !== this.missionKey) {
        this.missionKey = mk;
        this.missionCache = missionLayers(eng, this.toWorld, f.dim === '3D');
      }
      layers.push(...this.missionCache);
      const fk = `${gen}|${eng.geofences.length}|${f.dim}|${terrainOn}`;
      if (fk !== this.fenceKey) {
        this.fenceKey = fk;
        this.fenceCache = geofenceLayers(eng.geofences, (p) => this.toWorld(p, 'air'), f.dim === '3D');
      }
      layers.push(...this.fenceCache);
      layers.push(...trackLayers(eng, f, this.toWorld, this.store.selectedTrackId(), alpha));
      if (this.draw?.active) layers.push(...this.draw.layers((p) => this.toWorld({ x: p.x, y: p.y, z: 0.8 })));
    }
    // Radar has no image: its "point of view" is the tactical coverage picture, so keep symbology.
    const radarPov = f.fx === 'RADAR';
    if ((!f.povId || radarPov) && f.dim === '3D') {
      layers.push(...sensorLayers(radarPov ? views.filter((v) => v.vehicleId === f.povId) : views, this.toWorld, f.n, now));
    }
    const vf = radarPov ? { ...f, povId: null } : f;
    if (!f.povId && this.store.layers().links) layers.push(...linkLayers(eng, f, (p) => this.toWorld(p, 'air')));
    if (!f.povId && this.annotations.length) {
      layers.push(...annotationLayers(this.annotations, this.terrain.enabled ? this.terrain.elevation(0, 0) : 0));
    }
    layers.push(...vehicleLayers(vf, f.povId ? null : this.route, this.geo, f.povId ? [] : this.trailData(f)));
    if (!f.povId) {
      const groundOf = (lng: number, lat: number) => {
        const p = this.geo.fromLngLat(lng, lat);
        return this.terrain.elevation(p.x, p.y);
      };
      layers.push(...clusterLayers(this.clusters.clusters, groundOf, f.dim === '3D', f.n));
    }
    this.engine.setLayers(this.visible(layers));

    for (const l of this.listeners) l.render(f, now);
  }

  /**
   * Physical world layers (campus + live scan coverage) for main map, feeds and PIP.
   * Layer instances are cached per consumer: deck.gl layers cannot be shared across Deck instances.
   */
  releaseWorld(consumer: string): void {
    for (const k of [...this.worldCache.keys()]) if (k.startsWith(consumer + '|')) this.worldCache.delete(k);
  }

  worldLayers(look: CampusLook, consumer = 'main'): Layer[] {
    const eng = this.sim.engine;
    const campus = eng.scenario.campus;
    if (!campus) return [];
    const ground = this.terrain.enabled ? this.terrain.elevation(0, 0) : 0;
    const key = `${this.gen}|${eng.missions.version}|${look}|${ground.toFixed(1)}`;
    const slot = `${consumer}|${look}`;
    let hit = this.worldCache.get(slot);
    if (!hit || (hit as unknown as { key?: string }).key !== key) {
      hit = campusLayers(eng, campus, ground, (x, y) => this.geo.toLngLat(x, y), look);
      (hit as unknown as { key?: string }).key = key;
      this.worldCache.set(slot, hit);
    }
    return hit;
  }

  /** Operator annotations (measurements, POIs, coordinate pins). */
  annotations: Annotation[] = [];

  private visible(layers: Layer[]): Layer[] {
    const vis = this.store.layers();
    const hidden: string[] = [];
    for (const k of Object.keys(vis) as LayerKey[]) if (!vis[k]) hidden.push(...LAYER_PREFIXES[k]);
    if (!hidden.length) return layers;
    return layers.filter((l) => !hidden.some((h) => l.id.startsWith(h)));
  }

  private sampleTrails(f: RenderFrame, now: number): void {
    if (now - this.lastTrailAt < 1000 / Math.max(1, this.sim.speed())) return;
    this.lastTrailAt = now;
    for (const v of f.vehicles) {
      if (!v.airborne) {
        this.trails.delete(v.id);
        continue;
      }
      let t = this.trails.get(v.id);
      if (!t) this.trails.set(v.id, (t = []));
      t.push([v.position[0], v.position[1], v.position[2]]);
      if (t.length > 45) t.shift();
    }
  }

  private trailData(f: RenderFrame): Trail[] {
    const all = this.store.trails();
    const out: Trail[] = [];
    for (const v of f.vehicles) {
      if (v.clustered || !(all || v.selected || v.hovered)) continue;
      const t = this.trails.get(v.id);
      if (!t || t.length < 2) continue;
      out.push({ path: [...t, [v.position[0], v.position[1], v.position[2]]], color: [v.color[0], v.color[1], v.color[2], v.selected ? 200 : 110] });
    }
    return out;
  }

  private computeSensors(f: RenderFrame): SensorView[] {
    this.solutions.clear();
    const eng = this.sim.engine;
    const feeds = this.sensors.feeds();
    const views: SensorView[] = [];
    const seen = new Set<string>();
    const visible = new Set(this.sensors.visibleFeeds().map((s) => s.vehicleId));
    const add = (rv: RenderVehicle, payloadId: string | null, label: string | null, primary: boolean) => {
      if (seen.has(rv.id)) return;
      const v = eng.vehicles[rv.i];
      const p = v.payloads.find((x) => x.id === payloadId) ?? v.payloads.find((x) => x.id === v.activePayloadId) ?? v.payloads[0];
      if (!p || v.opState === 'OFFLINE' || p.status === 'FAULT') return;
      seen.add(rv.id);
      const sol = this.solve(rv, p);
      this.solutions.set(rv.id, sol);
      views.push({ vehicleId: rv.id, label, type: p.type, sol, primary, originWorld: [rv.position[0], rv.position[1], rv.position[2] - 0.35] });
    };
    if (f.povId) {
      const rv = f.vehicles.find((x) => x.id === f.povId);
      const slot = this.sensors.pov();
      if (rv && slot) add(rv, slot.payloadId, null, true);
    }
    feeds.forEach((slot, i) => {
      const rv = f.vehicles.find((x) => x.id === slot.vehicleId);
      if (rv) add(rv, slot.payloadId, `FEED ${FEED_LETTERS[i]}`, visible.has(slot.vehicleId) || rv.selected);
    });
    if (f.selected && f.selected.airborne) add(f.selected, null, null, true);
    // Everyone actively working a mission shows where their sensor is pointed (close range only).
    if (f.zoom > 15.6 && f.dim === '3D') {
      for (const rv of f.vehicles) {
        const v = eng.vehicles[rv.i];
        if (seen.has(rv.id) || rv.clustered || v.phase !== 'ON_TASK') continue;
        const n = views.length;
        add(rv, null, null, false);
        if (views.length > n) views[n].light = true;
      }
    }
    return views;
  }

  private updateRoute(f: RenderFrame): void {
    const sel = f.selected;
    if (!sel) {
      this.route = null;
      return;
    }
    const v = this.sim.engine.vehicles[sel.i];
    if (!v.route || v.phase === 'PARKED' || v.phase === 'LANDING') {
      this.route = null;
      return;
    }
    const wps = v.route.waypoints;
    const key = `${v.route.id}|${v.routeIndex}|${v.phase}`;
    const toPos = (x: number, y: number, z: number): [number, number, number] => {
      const ll = this.geo.toLngLat(x, y);
      return [ll[0], ll[1], this.terrain.elevation(x, y) + z];
    };
    if (key !== this.routeKey || !this.route) {
      this.routeKey = key;
      const ahead: [number, number, number][] = [];
      if (v.phase === 'RTB') {
        ahead.push(toPos(v.pad.x, v.pad.y, Math.max(this.sim.engine.scenario.cruiseAlt, 30)), toPos(v.pad.x, v.pad.y, 0));
      } else {
        const n = v.route.loop ? wps.length + 1 : wps.length - v.routeIndex;
        for (let k = 0; k < n; k++) {
          const w = wps[(v.routeIndex + k) % wps.length];
          ahead.push(toPos(w.x, w.y, w.z));
        }
      }
      this.route = { remaining: [[...sel.position], ...ahead], flown: [] };
    } else {
      this.route.remaining[0] = [...sel.position];
    }
  }
}
