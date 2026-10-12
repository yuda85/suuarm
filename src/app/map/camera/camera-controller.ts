import { MapView } from '@deck.gl/core';
import { LngLatBounds, type Map as MlMap } from 'maplibre-gl';
import { CameraMode, DEFAULT_FOLLOW, FollowParams } from '../../core/domain/camera';
import { angleDiff, clamp, DEG, easeInOutCubic, lerp, lerpAngle, wrap360 } from '../../core/domain/geometry';
import { LocalFrame } from '../../core/world/geo';
import { MapEngine } from '../map-engine';
import { RenderFrame, RenderVehicle } from '../render-frame';

const EARTH_CIRC = 40075016.686;
export const DEFAULT_FOV = 36.8699;
const FREE_PITCH_3D = 58;

/** Physical camera: position (lng/lat, metres AMSL) + orientation + vertical FOV. */
export interface CamState {
  lng: number;
  lat: number;
  alt: number;
  bearing: number;
  /** MapLibre pitch: 0 = nadir, 90 = horizon. */
  pitch: number;
  fov: number;
}

export interface PovSensor {
  vehicleId: string;
  /** Absolute boresight azimuth (deg) and elevation (deg, negative down). */
  azimuth: number;
  elevation: number;
  vfov: number;
  /** Radar has no optical image: camera frames the coverage wedge instead of sitting in the payload. */
  radar?: boolean;
}

interface Transition {
  from: CamState;
  t0: number;
  dur: number;
}

type Stage = 'follow' | 'pov' | 'release' | null;

/**
 * Camera state machine. FREE/TACTICAL hand control to MapLibre; FOLLOW / SENSOR_POV drive the
 * camera every frame from the interpolated vehicle + gimbal pose. All transitions blend in physical
 * camera space (position, orientation, FOV) so the view never teleports:
 *   FREE → FOLLOW → SENSOR POV   and back   SENSOR POV → FOLLOW → FREE.
 */
export class CameraController {
  mode: CameraMode = 'FREE_3D';
  targetId: string | null = null;
  readonly follow: FollowParams = { ...DEFAULT_FOLLOW };
  /** Supplies the live sensor pose for SENSOR_POV. */
  povSensor: (vehicleId: string, frame: RenderFrame) => PovSensor | null = () => null;
  onModeChanged: (mode: CameraMode) => void = () => {};

  private stage: Stage = null;
  private trans: Transition | null = null;
  private queue: { stage: Stage; dur: number }[] = [];
  private releaseTo: { mode: CameraMode; cam: CamState } | null = null;
  private smoothedHeading: number | null = null;
  private lastNow = performance.now();
  private dragging: { x: number; y: number } | null = null;
  private appliedFov = DEFAULT_FOV;

  constructor(
    private readonly engine: MapEngine,
    private readonly geo: LocalFrame,
  ) {
    const el = this.map.getCanvasContainer();
    el.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
  }

  private get map(): MlMap {
    return this.engine.map;
  }

  destroy(): void {
    const el = this.map.getCanvasContainer();
    el.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel, { capture: true });
  }

  get isDriving(): boolean {
    return this.stage !== null;
  }

  get transitioning(): boolean {
    return this.trans !== null || this.queue.length > 0;
  }

  setMode(mode: CameraMode, opts: { targetId?: string | null; focus?: RenderVehicle | null; fleet?: RenderVehicle[] } = {}): void {
    const prev = this.mode;
    if (opts.targetId !== undefined) this.targetId = opts.targetId;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const k = reduced ? 0.25 : 1;

    if (mode === 'FOLLOW_VEHICLE' || mode === 'SENSOR_POV') {
      if (!this.targetId) return;
      this.mode = mode;
      this.takeControl();
      if (prev !== 'FOLLOW_VEHICLE' && prev !== 'SENSOR_POV') this.smoothedHeading = null;
      this.queue = [];
      if (mode === 'FOLLOW_VEHICLE') {
        this.begin('follow', (prev === 'SENSOR_POV' ? 1000 : 1600) * k);
      } else if (prev === 'FOLLOW_VEHICLE' || prev === 'SENSOR_POV') {
        this.begin('pov', 1100 * k);
      } else {
        // Chain: fly in behind the aircraft, then drop into the payload.
        this.begin('follow', 1500 * k);
        this.queue.push({ stage: 'pov', dur: 1000 * k });
      }
      return;
    }

    this.mode = mode;
    if (this.stage) {
      // Leaving a driven mode: pull back out of the aircraft in camera space, then release.
      const v = opts.focus;
      const cam = v ? this.releaseCam(v, mode) : { ...this.currentCam(), fov: DEFAULT_FOV, pitch: mode === 'FREE_2D' ? 0 : FREE_PITCH_3D };
      this.releaseTo = { mode, cam };
      this.queue = [];
      if (prev === 'SENSOR_POV' && v) {
        this.begin('follow', 900 * k);
        this.queue.push({ stage: 'release', dur: 1300 * k });
      } else {
        this.begin('release', 1400 * k);
      }
      return;
    }
    this.freeMove(mode, opts.focus ?? null, opts.fleet, k);
  }

  private freeMove(mode: CameraMode, focus: RenderVehicle | null, fleet: RenderVehicle[] | undefined, k: number): void {
    const dur = 1100 * k;
    if (mode === 'FREE_2D') this.map.easeTo({ pitch: 0, bearing: 0, duration: dur });
    else if (mode === 'FREE_3D') this.map.easeTo({ pitch: FREE_PITCH_3D, duration: dur });
    else if (mode === 'TACTICAL') {
      if (focus) this.map.easeTo({ center: [focus.position[0], focus.position[1]], zoom: 16.3, pitch: 34, duration: dur * 1.3 });
      else if (fleet?.length) this.fitVehicles(fleet, 34);
    }
  }

  fitVehicles(vs: RenderVehicle[], pitch = this.map.getPitch()): void {
    if (!vs.length || this.isDriving) return;
    const b = new LngLatBounds();
    for (const v of vs) b.extend([v.position[0], v.position[1]]);
    this.map.fitBounds(b, { padding: { top: 110, bottom: 90, left: 380, right: 420 }, maxZoom: 16.5, pitch, duration: 1200 });
  }

  flyToVehicle(v: RenderVehicle): void {
    if (this.isDriving) return;
    this.map.flyTo({ center: [v.position[0], v.position[1]], zoom: Math.max(this.map.getZoom(), 17), pitch: this.mode === 'FREE_2D' ? 0 : 55, duration: 1300, essential: true });
  }

  /** Per-frame drive. */
  update(frame: RenderFrame, now: number): void {
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    if (!this.stage) return;
    const v = frame.vehicles.find((x) => x.id === this.targetId) ?? null;
    if (!v && this.stage !== 'release') {
      this.abort();
      return;
    }

    let target: CamState;
    if (this.stage === 'release') target = this.releaseTo!.cam;
    else if (this.stage === 'pov') target = this.povCam(v!, frame) ?? this.followCam(v!, dt);
    else target = this.followCam(v!, dt);
    if (this.stage !== 'follow' && v) this.followCam(v, dt); // keep heading filter warm

    let cam = target;
    if (this.trans) {
      const t = clamp((now - this.trans.t0) / Math.max(1, this.trans.dur), 0, 1);
      cam = blendCam(this.trans.from, target, t);
      if (t >= 1) {
        this.trans = null;
        const next = this.queue.shift();
        if (next) this.begin(next.stage, next.dur);
        else if (this.stage === 'release') {
          this.apply(target);
          this.release();
          return;
        }
      }
    }
    this.apply(cam);
  }

  // ───────────────────────────── camera states

  private followCam(v: RenderVehicle, dt: number): CamState {
    const k = 1 - Math.exp(-dt * 1.6);
    this.smoothedHeading = this.smoothedHeading === null ? v.heading : lerpAngle(this.smoothedHeading, v.heading, k);
    const b = (this.smoothedHeading + this.follow.bearingOffset) * DEG;
    const cx = v.local[0] - Math.sin(b) * this.follow.distance;
    const cy = v.local[1] - Math.cos(b) * this.follow.distance;
    const ll = this.geo.toLngLat(cx, cy);
    const alt = v.position[2] + this.follow.height;
    return {
      lng: ll[0],
      lat: ll[1],
      alt,
      bearing: wrap360(this.smoothedHeading + this.follow.bearingOffset),
      pitch: 90 - Math.atan2(this.follow.height, this.follow.distance) / DEG + 4,
      fov: DEFAULT_FOV,
    };
  }

  private povCam(v: RenderVehicle, frame: RenderFrame): CamState | null {
    const s = this.povSensor(v.id, frame);
    if (!s) return null;
    if (s.radar) {
      const b = s.azimuth * DEG;
      const ll = this.geo.toLngLat(v.local[0] - Math.sin(b) * 1500, v.local[1] - Math.cos(b) * 1500);
      return { lng: ll[0], lat: ll[1], alt: v.position[2] + 3300, bearing: s.azimuth, pitch: 40, fov: DEFAULT_FOV };
    }
    return {
      lng: v.position[0],
      lat: v.position[1],
      alt: v.position[2] - 0.35,
      bearing: s.azimuth,
      pitch: clamp(90 + s.elevation, 0, 89),
      fov: clamp(s.vfov, 1, 90),
    };
  }

  /** Where to park the camera when handing control back to the operator. */
  private releaseCam(v: RenderVehicle, mode: CameraMode): CamState {
    const heading = this.smoothedHeading ?? v.heading;
    if (mode === 'FREE_2D') {
      return { lng: v.position[0], lat: v.position[1], alt: v.position[2] + 900, bearing: 0, pitch: 0, fov: DEFAULT_FOV };
    }
    const tactical = mode === 'TACTICAL';
    const back = tactical ? 380 : 230;
    const up = tactical ? 520 : 170;
    const b = heading * DEG;
    const ll = this.geo.toLngLat(v.local[0] - Math.sin(b) * back, v.local[1] - Math.cos(b) * back);
    return { lng: ll[0], lat: ll[1], alt: v.position[2] + up, bearing: heading, pitch: 90 - Math.atan2(up, back) / DEG + 6, fov: DEFAULT_FOV };
  }

  /** Reads MapLibre's current camera and reconstructs its physical position. */
  currentCam(): CamState {
    const m = this.map;
    const c = m.getCenter();
    const zoom = m.getZoom();
    const pitch = m.getPitch();
    const bearing = m.getBearing();
    const fov = this.appliedFov;
    const elev = m.getCenterElevation?.() ?? 0;
    const H = m.getCanvas().clientHeight || 800;
    const mpp = (EARTH_CIRC * Math.cos(c.lat * DEG)) / (512 * Math.pow(2, zoom));
    const d = ((0.5 * H) / Math.tan((fov / 2) * DEG)) * mpp;
    const horiz = d * Math.sin(pitch * DEG);
    const b = bearing * DEG;
    const p = this.geo.fromLngLat(c.lng, c.lat);
    const ll = this.geo.toLngLat(p.x - Math.sin(b) * horiz, p.y - Math.cos(b) * horiz);
    return { lng: ll[0], lat: ll[1], alt: elev + d * Math.cos(pitch * DEG), bearing, pitch, fov };
  }

  private apply(cam: CamState): void {
    this.setFov(cam.fov);
    const opts = this.map.calculateCameraOptionsFromCameraLngLatAltRotation([cam.lng, cam.lat], cam.alt, cam.bearing, cam.pitch);
    this.map.jumpTo(opts);
  }

  setFov(fov: number): void {
    if (Math.abs(fov - this.appliedFov) < 0.005) return;
    this.appliedFov = fov;
    this.map.setVerticalFieldOfView(fov);
    this.engine.overlay.setProps({ views: new MapView({ id: 'maplibre', fovy: fov }) as never });
  }

  // ───────────────────────────── control hand-off

  private begin(stage: Stage, dur: number): void {
    this.stage = stage;
    this.trans = { from: this.currentCam(), t0: performance.now(), dur };
  }

  private takeControl(): void {
    this.setInteractions(false);
    this.map.setCenterClampedToGround(false);
    this.map.setMaxPitch(89.5);
  }

  private release(): void {
    const to = this.releaseTo;
    this.stage = null;
    this.trans = null;
    this.queue = [];
    this.releaseTo = null;
    this.setFov(DEFAULT_FOV);
    this.setInteractions(true);
    this.map.setCenterClampedToGround(true);
    this.map.setMaxPitch(85);
    if (to?.mode === 'FREE_2D') this.map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
  }

  private abort(): void {
    this.release();
    this.mode = 'FREE_3D';
    this.onModeChanged('FREE_3D');
  }

  private setInteractions(on: boolean): void {
    const m = this.map;
    for (const h of [m.dragPan, m.dragRotate, m.scrollZoom, m.touchZoomRotate, m.doubleClickZoom, m.keyboard, m.boxZoom, m.touchPitch]) {
      if (on) h.enable();
      else h.disable();
    }
  }

  // ───────────────────────────── orbit input while following
  private onPointerDown = (e: PointerEvent): void => {
    if (this.mode !== 'FOLLOW_VEHICLE') return;
    this.dragging = { x: e.clientX, y: e.clientY };
  };
  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || this.mode !== 'FOLLOW_VEHICLE') return;
    const dx = e.clientX - this.dragging.x;
    const dy = e.clientY - this.dragging.y;
    this.dragging = { x: e.clientX, y: e.clientY };
    this.follow.bearingOffset = clamp(this.follow.bearingOffset - dx * 0.3, -175, 175);
    this.follow.height = clamp(this.follow.height + dy * 0.12, 2, 160);
  };
  private onPointerUp = (): void => {
    this.dragging = null;
  };
  private onWheel = (e: WheelEvent): void => {
    if (this.mode !== 'FOLLOW_VEHICLE') return;
    e.preventDefault();
    e.stopPropagation();
    const f = Math.exp(e.deltaY * 0.0012);
    this.follow.distance = clamp(this.follow.distance * f, 8, 500);
    this.follow.height = clamp(this.follow.height * f, 2, 260);
  };
}

function blendCam(a: CamState, b: CamState, t: number): CamState {
  const u = easeInOutCubic(t);
  // Altitude in log space: big descents feel like a steady glide, not a dive.
  const la = Math.log(Math.max(1, a.alt + 50));
  const lb = Math.log(Math.max(1, b.alt + 50));
  return {
    lng: lerp(a.lng, b.lng, u),
    lat: lerp(a.lat, b.lat, u),
    alt: Math.exp(lerp(la, lb, u)) - 50,
    bearing: wrap360(a.bearing + angleDiff(a.bearing, b.bearing) * u),
    pitch: lerp(a.pitch, b.pitch, u),
    fov: lerp(a.fov, b.fov, u),
  };
}
