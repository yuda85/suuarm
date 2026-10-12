import { DecimalPipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { clamp } from '../../core/domain/geometry';
import { FovMode, SensorType } from '../../core/domain/sensor';
import { tickClock } from '../../core/state/clock';
import { OpsStore } from '../../core/state/ops-store';
import { SensorStore, ThermalPalette } from '../../core/state/sensor.store';
import { SimHost } from '../../core/state/sim-host.service';
import { formatLatLng } from '../../core/world/geo';
import { sensorLayers } from '../../map/layers/sensor-layers';
import { vehicleLayers } from '../../map/layers/vehicle-layers';
import { MapService } from '../../map/map.service';
import { MiniMap } from '../../map/mini-map';
import { RenderFrame } from '../../map/render-frame';
import { FrameListener } from '../../map/render-loop';
import { Icon } from '../../shared/ui/icon';
import { Crosshair, Navigation, X } from '../../shared/ui/icons';
import { RadarScope } from '../sensor/radar-scope';

interface HudState {
  az: number;
  el: number;
  hfov: number;
  vfov: number;
  slant: number;
  target: string;
  surface: string;
  alt: number;
  hdg: number;
  spd: number;
  link: number;
  lat: number;
}

const TYPES: SensorType[] = ['EO', 'THERMAL', 'IR', 'RADAR'];
const FOVS: FovMode[] = ['WFOV', 'MFOV', 'NFOV'];

/**
 * Sensor POV overlay. The main 3D map *is* the sensor image; this adds restrained gimbal
 * symbology, sensor controls, manual slew and a tactical picture-in-picture so the operator never
 * loses where the aircraft is and what it is looking at.
 */
@Component({
  selector: 'app-pov-hud',
  imports: [Icon, DecimalPipe, RadarScope],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()', '(window:keydown)': 'onKey($event)' },
  template: `
    <div
      class="slew"
      (pointerdown)="slewStart($event)"
      (pointermove)="slewMove($event)"
      (pointerup)="slewEnd()"
      (pointercancel)="slewEnd()"
      (wheel)="onWheel($event)"
      aria-label="Drag to slew gimbal"
    ></div>
    <div class="frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>

    @if (type() !== 'RADAR') {
      <div class="reticle" aria-hidden="true">
        <i class="h rl"></i><i class="h rr"></i><i class="v rt"></i><i class="v rb"></i><b></b>
      </div>
      <div class="tape mono" aria-hidden="true">
        @for (t of ticks(); track t.label) {
          <span class="tick" [class.major]="t.major" [style.left.%]="t.x">
            @if (t.major) {
              <em>{{ t.label }}</em>
            }
          </span>
        }
        <span class="caret"></span>
      </div>
      <div class="elev mono" aria-hidden="true">
        <span class="bar"><span class="mark" [style.top.%]="elPos()"></span></span>
        <em>{{ hud().el | number: '1.0-0' }}°</em>
      </div>
    }

    <div class="tl mono">
      <div class="big">{{ vehicleId() }} <span>{{ callsign() }}</span></div>
      <div>{{ type() }} · {{ payloadModel() }}</div>
      <div>{{ fovMode() }} {{ hud().hfov | number: '1.1-1' }}° × {{ hud().vfov | number: '1.1-1' }}° · GIMBAL {{ gimbalMode() }}</div>
    </div>
    <div class="tr mono">
      <div class="big">{{ clock() }}</div>
      <div>LINK {{ hud().link * 100 | number: '1.0-0' }}% · SENSOR POV</div>
      @if (type() === 'THERMAL') {
        <div class="legend" [attr.data-p]="sensors.thermalPalette()"><span>COOL</span><i></i><span>HOT</span></div>
      }
    </div>
    <div class="bl mono">
      <div>TGT {{ hud().target }}</div>
      <div>SLANT {{ hud().slant | number: '1.0-0' }} m · {{ surfaceLabel() }}</div>
    </div>
    <div class="br mono">
      <div>ALT {{ hud().alt | number: '1.0-0' }} m AGL · HDG {{ hud().hdg | number: '3.0-0' }}°</div>
      <div>GS {{ hud().spd | number: '1.0-0' }} kt · AZ {{ hud().az | number: '3.0-0' }}° EL {{ hud().el | number: '1.0-0' }}°</div>
    </div>

    @if (type() === 'RADAR') {
      <div class="bscope">
        <app-radar-scope [vehicleId]="vehicleId()" />
      </div>
    }

    <div class="pip" aria-label="Tactical picture">
      <div #pip class="pip-map"></div>
      <span class="pip-tag caps">Tactical · source aircraft</span>
    </div>

    <div class="bar" role="toolbar" aria-label="Sensor controls">
      <div class="seg" role="radiogroup" aria-label="Sensor">
        @for (t of types; track t) {
          <button type="button" role="radio" [attr.aria-checked]="type() === t" [disabled]="!has(t)" (click)="switchType(t)">{{ t }}</button>
        }
      </div>
      @if (type() !== 'RADAR') {
        <div class="seg" role="radiogroup" aria-label="Field of view">
          @for (f of fovs; track f) {
            <button type="button" role="radio" [attr.aria-checked]="fovMode() === f" (click)="setFov(f)">{{ f.slice(0, 1) }}FOV</button>
          }
        </div>
      }
      @if (type() === 'THERMAL') {
        <button type="button" class="b" (click)="cyclePalette()">{{ paletteLabel() }}</button>
      }
      @if (gimbalMode() === 'MANUAL') {
        <button type="button" class="b" (click)="gimbalAuto()"><ui-icon [icon]="icons.Crosshair" [size]="14" /> Auto track</button>
      }
      <span class="sp"></span>
      <button type="button" class="b" (click)="follow()"><ui-icon [icon]="icons.Navigation" [size]="14" /> Follow UAV</button>
      <button type="button" class="b primary" (click)="exit()"><ui-icon [icon]="icons.X" [size]="14" /> Return to map</button>
    </div>
  `,
  styleUrl: './pov-hud.scss',
})
export class PovHud implements FrameListener {
  protected readonly sensors = inject(SensorStore);
  private readonly store = inject(OpsStore);
  private readonly sim = inject(SimHost);
  private readonly svc = inject(MapService);
  private readonly pipEl = viewChild.required<ElementRef<HTMLDivElement>>('pip');
  protected readonly icons = { Crosshair, Navigation, X };
  protected readonly types = TYPES;
  protected readonly fovs = FOVS;
  protected readonly hud = signal<HudState>({ az: 0, el: 0, hfov: 0, vfov: 0, slant: 0, target: '—', surface: '', alt: 0, hdg: 0, spd: 0, link: 1, lat: 0 });
  private mini: MiniMap | null = null;
  private lastHud = 0;
  private lastPip = 0;
  private drag: { x: number; y: number; pan: number; tilt: number } | null = null;
  private lastSlew = 0;

  protected readonly slot = this.sensors.pov;
  protected readonly vehicleId = computed(() => this.slot()?.vehicleId ?? '');
  private readonly vehicle = computed(
    () => {
      this.sim.uiTick();
      const s = this.slot();
      return s ? this.sim.engine.byId.get(s.vehicleId) : undefined;
    },
    { equal: () => false },
  );
  private readonly payload = computed(
    () => {
      this.sim.uiTick();
      const s = this.slot();
      return s ? this.sensors.payload(s) : undefined;
    },
    { equal: () => false },
  );
  protected readonly type = computed<SensorType>(() => this.payload()?.type ?? 'EO');
  protected readonly fovMode = computed(() => this.payload()?.fovMode ?? 'WFOV');
  protected readonly payloadModel = computed(() => this.payload()?.model ?? '');
  protected readonly callsign = computed(() => this.vehicle()?.callsign ?? '');
  protected readonly gimbalMode = computed(() => this.vehicle()?.gimbal.mode ?? 'AUTO');
  protected readonly clock = computed(() => {
    this.sim.uiTick();
    return `${tickClock(this.sim.startedAtMs, this.sim.engine.tick)} GST`;
  });
  protected readonly elPos = computed(() => clamp((-this.hud().el / 90) * 100, 0, 100));
  protected readonly surfaceLabel = computed(() => {
    const s = this.hud().surface;
    if (!s || s === 'sky') return 'NO GROUND RETURN';
    if (s === 'ground') return 'GROUND';
    const [id, kind] = s.split(':');
    return `${id.toUpperCase()} ${kind === 'roof' ? 'ROOF' : 'FACADE'}`;
  });
  protected readonly paletteLabel = computed(() => ({ WHITE_HOT: 'WHT HOT', BLACK_HOT: 'BLK HOT', IRONBOW: 'IRONBOW' })[this.sensors.thermalPalette()]);
  protected readonly ticks = computed(() => {
    const { az, hfov } = this.hud();
    const out: { x: number; label: string; major: boolean }[] = [];
    const span = Math.max(20, hfov * 1.4);
    const step = span > 60 ? 10 : 5;
    const start = Math.ceil((az - span / 2) / step) * step;
    for (let a = start; a <= az + span / 2; a += step) {
      const x = 50 + ((a - az) / span) * 100;
      const n = ((a % 360) + 360) % 360;
      const major = n % (step * 2) === 0;
      out.push({ x, major, label: n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : String(n).padStart(3, '0') });
    }
    return out;
  });

  constructor() {
    afterNextRender(() => {
      const loop = this.svc.loop;
      const rv = loop?.frame.vehicles.find((v) => v.id === this.vehicleId());
      this.mini = new MiniMap(this.pipEl().nativeElement, this.svc.tacticalStyle(), rv ? [rv.position[0], rv.position[1]] : [0, 0]);
      loop?.listeners.add(this);
    });
    inject(DestroyRef).onDestroy(() => {
      this.svc.loop?.listeners.delete(this);
      this.mini?.destroy();
    });
  }

  render(frame: RenderFrame, now: number): void {
    const loop = this.svc.loop;
    const id = this.vehicleId();
    if (!loop || !id) return;
    const rv = frame.vehicles.find((v) => v.id === id);
    const sol = loop.solutions.get(id);
    if (!rv || !sol) return;

    if (now - this.lastHud > 100) {
      this.lastHud = now;
      const v = this.sim.engine.byId.get(id);
      const tll = loop.geo.toLngLat(sol.target.p.x, sol.target.p.y);
      this.hud.set({
        az: sol.azimuth,
        el: sol.elevation,
        hfov: sol.hfov,
        vfov: sol.vfov,
        slant: sol.target.surface === 'sky' ? sol.range : sol.target.t,
        target: sol.target.surface === 'sky' ? '—' : formatLatLng(tll[0], tll[1]),
        surface: sol.target.surface,
        alt: rv.local[2],
        hdg: rv.heading,
        spd: (v?.speed ?? 0) * 1.944,
        link: v?.link.quality ?? 0,
        lat: rv.position[1],
      });
    }

    const mini = this.mini;
    if (mini && now - this.lastPip > 33) {
      this.lastPip = now;
      const b = (sol.azimuth * Math.PI) / 180;
      const back = 260;
      const ll = loop.geo.toLngLat(rv.local[0] - Math.sin(b) * back, rv.local[1] - Math.cos(b) * back);
      mini.setCam({ lng: ll[0], lat: ll[1], alt: rv.position[2] + 330, bearing: sol.azimuth, pitch: 42, fov: 36.87 });
      const slot = this.slot();
      const pf: RenderFrame = { ...frame, povId: null, fx: null, mpp: 0.9, zoom: 15, dim: '3D', selected: null, hovered: null };
      mini.setLayers([
        ...loop.worldLayers('TACTICAL', 'pip'),
        ...sensorLayers(
          [{ vehicleId: id, label: null, type: this.type(), sol, primary: true, originWorld: [rv.position[0], rv.position[1], rv.position[2] - 0.35] }],
          loop.toWorld,
          frame.n,
          now,
        ),
        ...vehicleLayers(pf, null, loop.geo),
      ]);
      void slot;
    }
  }

  protected has(t: SensorType): boolean {
    return !!this.vehicle()?.payloads.some((p) => p.type === t);
  }

  protected switchType(t: SensorType): void {
    const s = this.slot();
    if (s) this.sensors.switchType(s, t);
  }

  protected setFov(f: FovMode): void {
    const s = this.slot();
    if (s) this.sensors.setFov(s, f);
  }

  protected cyclePalette(): void {
    const order: ThermalPalette[] = ['WHITE_HOT', 'BLACK_HOT', 'IRONBOW'];
    const i = order.indexOf(this.sensors.thermalPalette());
    this.sensors.thermalPalette.set(order[(i + 1) % order.length]);
  }

  protected gimbalAuto(): void {
    const id = this.vehicleId();
    if (id) this.sim.dispatch({ type: 'GIMBAL_AUTO', vehicleId: id });
  }

  protected follow(): void {
    this.sensors.exitPov('FOLLOW_VEHICLE');
  }

  protected exit(): void {
    this.sensors.exitPov('FREE_3D');
  }

  // ── manual gimbal slew (drag / arrows / wheel)
  protected slewStart(e: PointerEvent): void {
    const v = this.vehicle();
    if (!v) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, pan: v.gimbal.pan, tilt: v.gimbal.tilt };
  }

  protected slewMove(e: PointerEvent): void {
    const d = this.drag;
    const id = this.vehicleId();
    if (!d || !id) return;
    const now = performance.now();
    if (now - this.lastSlew < 50) return;
    this.lastSlew = now;
    const k = this.hud().hfov / Math.max(400, window.innerWidth);
    this.sim.dispatch({ type: 'SET_GIMBAL', vehicleId: id, pan: d.pan + (e.clientX - d.x) * k, tilt: d.tilt - (e.clientY - d.y) * k });
  }

  protected slewEnd(): void {
    this.drag = null;
  }

  protected onWheel(e: WheelEvent): void {
    e.preventDefault();
    const i = FOVS.indexOf(this.fovMode());
    const next = FOVS[clamp(i + (e.deltaY < 0 ? 1 : -1), 0, 2)];
    if (next !== this.fovMode()) this.setFov(next);
  }

  protected onKey(e: KeyboardEvent): void {
    const v = this.vehicle();
    if (!v || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    const step = Math.max(0.5, this.hud().hfov / 12);
    let pan = v.gimbal.targetPan;
    let tilt = v.gimbal.targetTilt;
    if (e.key === 'ArrowLeft') pan -= step;
    else if (e.key === 'ArrowRight') pan += step;
    else if (e.key === 'ArrowUp') tilt += step;
    else if (e.key === 'ArrowDown') tilt -= step;
    else if (e.key === 'Escape') return this.exit();
    else return;
    e.preventDefault();
    this.sim.dispatch({ type: 'SET_GIMBAL', vehicleId: v.id, pan, tilt });
  }
}
