import { DecimalPipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { clamp } from '../../core/domain/geometry';
import { FeedSlot, SensorStore } from '../../core/state/sensor.store';
import { SimHost } from '../../core/state/sim-host.service';
import { vehicleLayers } from '../../map/layers/vehicle-layers';
import { MapService } from '../../map/map.service';
import { MiniMap } from '../../map/mini-map';
import { RenderFrame } from '../../map/render-frame';
import { FrameListener } from '../../map/render-loop';
import { RadarScope } from './radar-scope';

interface FeedInfo {
  az: number;
  el: number;
  range: number;
  fov: string;
  surface: string;
}

/**
 * One live sensor feed: a non-interactive 3D view rendered from the payload pose of its source
 * aircraft (same world as the main map), with simulated sensor imaging applied.
 */
@Component({
  selector: 'app-feed-view',
  imports: [RadarScope, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-fx]': 'type()',
    '[attr.data-palette]': 'sensors.thermalPalette()',
    '[class.primary]': 'primary()',
  },
  template: `
    <div #mapEl class="mm" [class.hidden]="type() === 'RADAR'"></div>
    @if (type() === 'RADAR') {
      <app-radar-scope [vehicleId]="slot().vehicleId" />
    }
    <div class="vignette" aria-hidden="true"></div>
    @if (type() !== 'RADAR') {
      <div class="reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    }
    @if (acquiring() && !lost()) {
      <div class="acq"><span class="caps">Acquiring</span><i></i></div>
    }
    @if (lost()) {
      <div class="lost"><span class="caps">Signal lost</span><span class="mono">{{ slot().vehicleId }} · {{ lostReason() }}</span></div>
    }
    <div class="tl">
      <span class="letter">{{ letter() }}</span>
      <span class="mono src">{{ slot().vehicleId }}</span>
      <span class="mono type">{{ type() }}@if (!compact()) { · {{ info().fov }}}</span>
    </div>
    @if (!compact()) {
      <div class="bl mono">
        AZ {{ info().az | number: '3.0-0' }}° · EL {{ info().el | number: '1.0-0' }}° · RNG {{ info().range | number: '1.0-0' }} m
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      overflow: hidden;
      background: #020304;
      border-radius: var(--r-2);
      box-shadow: inset 0 0 0 1px var(--c-line);
    }
    :host(.primary) {
      box-shadow: inset 0 0 0 1px var(--c-accent-line);
    }
    .mm {
      position: absolute;
      inset: 0;
    }
    .mm.hidden {
      visibility: hidden;
    }
    .vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, 0.45) 100%);
    }
    .reticle {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 2.2rem;
      height: 2.2rem;
      transform: translate(-50%, -50%);
      pointer-events: none;
      i {
        position: absolute;
        background: rgba(255, 255, 255, 0.8);
      }
      i:nth-child(1) { left: 0; top: 50%; width: 35%; height: 1px; }
      i:nth-child(2) { right: 0; top: 50%; width: 35%; height: 1px; }
      i:nth-child(3) { top: 0; left: 50%; height: 35%; width: 1px; }
      i:nth-child(4) { bottom: 0; left: 50%; height: 35%; width: 1px; }
    }
    .tl {
      position: absolute;
      left: 0.4rem;
      right: 1.6rem;
      top: 0.4rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      white-space: nowrap;
      overflow: hidden;
      font-size: 0.6875rem;
      color: rgba(255, 255, 255, 0.92);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    }
    .letter {
      display: grid;
      place-items: center;
      width: 1.1rem;
      height: 1.1rem;
      border-radius: 2px;
      background: rgb(120, 176, 255);
      color: #0a0e14;
      font: 600 0.6875rem var(--f-mono);
      text-shadow: none;
    }
    .type {
      color: rgba(255, 255, 255, 0.7);
    }
    .acq {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      background: #05070a;
      color: var(--c-text-3);
      font-size: 0.625rem;
      i {
        width: 5rem;
        height: 2px;
        background: linear-gradient(90deg, transparent, var(--c-accent), transparent);
        background-size: 200% 100%;
        animation: scan 1.1s linear infinite;
      }
    }
    @keyframes scan {
      from {
        background-position: 100% 0;
      }
      to {
        background-position: -100% 0;
      }
    }
    .lost {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      background:
        repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px 3px),
        rgba(8, 10, 14, 0.92);
      color: var(--s-critical);
      font-size: 0.6875rem;
      .mono {
        color: var(--c-text-2);
        font-size: 0.625rem;
      }
    }
    .bl {
      position: absolute;
      left: 0.5rem;
      bottom: 0.4rem;
      font-size: 0.625rem;
      color: rgba(255, 255, 255, 0.8);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    }
  `,
})
export class FeedView implements FrameListener {
  readonly slot = input.required<FeedSlot>();
  readonly letter = input('A');
  readonly primary = input(false);
  readonly compact = input(false);
  protected readonly sensors = inject(SensorStore);
  private readonly sim = inject(SimHost);
  private readonly svc = inject(MapService);
  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');
  private mini: MiniMap | null = null;
  private last = 0;
  private lastInfo = 0;
  private ro: ResizeObserver | null = null;
  protected readonly info = signal<FeedInfo>({ az: 0, el: 0, range: 0, fov: '', surface: '' });
  protected readonly acquiring = signal(true);
  private readonly consumer = `feed-${Math.random().toString(36).slice(2, 8)}`;

  protected readonly lost = computed(() => {
    this.sim.uiTick();
    const v = this.sensors.vehicle(this.slot());
    return !v || v.opState === 'OFFLINE' || v.health.linkLost || v.health.payloadFault;
  });
  protected readonly lostReason = computed(() => {
    this.sim.uiTick();
    const v = this.sensors.vehicle(this.slot());
    if (!v || v.opState === 'OFFLINE') return 'VEHICLE OFFLINE';
    if (v.health.linkLost) return 'C2 LINK LOST';
    return 'PAYLOAD FAULT';
  });

  protected readonly type = computed(() => {
    this.sim.uiTick();
    return this.sensors.payload(this.slot())?.type ?? 'EO';
  });

  constructor() {
    afterNextRender(() => {
      const loop = this.svc.loop;
      const rv = loop?.frame.vehicles.find((v) => v.id === this.slot().vehicleId);
      const center: [number, number] = rv ? [rv.position[0], rv.position[1]] : [0, 0];
      this.mini = new MiniMap(this.mapEl().nativeElement, this.svc.sensorStyle(), center);
      loop?.listeners.add(this);
      this.ro = new ResizeObserver(() => this.mini?.resize());
      this.ro.observe(this.mapEl().nativeElement);
    });
    inject(DestroyRef).onDestroy(() => {
      this.svc.loop?.listeners.delete(this);
      this.svc.loop?.releaseWorld(this.consumer);
      this.ro?.disconnect();
      this.mini?.destroy();
    });
  }

  render(frame: RenderFrame, now: number): void {
    const mini = this.mini;
    const loop = this.svc.loop;
    if (!mini || !loop || now - this.last < 33) return;
    this.last = now;
    const slot = this.slot();
    const rv = frame.vehicles.find((v) => v.id === slot.vehicleId);
    const sol = loop.solutions.get(slot.vehicleId);
    const payload = this.sensors.payload(slot);
    if (!rv || !sol || !payload) return;
    if (this.acquiring() && (mini.ready || payload.type === 'RADAR')) this.acquiring.set(false);
    if (now - this.lastInfo > 250) {
      this.lastInfo = now;
      this.info.set({
        az: sol.azimuth,
        el: sol.elevation,
        range: sol.target.surface === 'sky' ? sol.range : sol.target.t,
        fov: `${payload.fovMode} ${sol.hfov.toFixed(1)}°`,
        surface: sol.target.surface,
      });
    }
    if (payload.type === 'RADAR') return;
    mini.setCam({
      lng: rv.position[0],
      lat: rv.position[1],
      alt: rv.position[2] - 0.35,
      bearing: sol.azimuth,
      pitch: clamp(90 + sol.elevation, 0, 89),
      fov: clamp(sol.vfov, 1, 90),
    });
    const look = payload.type === 'EO' ? 'EO' : 'THERMAL';
    mini.setLayers([...loop.worldLayers(look, this.consumer), ...vehicleLayers({ ...frame, povId: slot.vehicleId, fx: payload.type }, null, loop.geo)]);
  }
}
