import { computed, inject, Injectable, signal } from '@angular/core';
import { FovMode, Payload, SensorType } from '../domain/sensor';
import { Vehicle } from '../domain/vehicle';
import { OpsStore } from './ops-store';
import { SimHost } from './sim-host.service';

export type FeedLayout = 1 | 2 | 4;
export type ThermalPalette = 'WHITE_HOT' | 'BLACK_HOT' | 'IRONBOW';

export interface FeedSlot {
  vehicleId: string;
  payloadId: string;
}

export const FEED_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Sensor feeds + Sensor POV state. Feeds stay spatially linked to their source on the map. */
@Injectable({ providedIn: 'root' })
export class SensorStore {
  private readonly sim = inject(SimHost);
  private readonly ops = inject(OpsStore);

  readonly layout = signal<FeedLayout>(1);
  readonly feeds = signal<FeedSlot[]>([]);
  /** Feed shown in single view / receiving switch commands. */
  readonly primary = signal(0);
  readonly thermalPalette = signal<ThermalPalette>('WHITE_HOT');
  /** AR overlay of other assets inside POV. */
  readonly overlay = signal(true);
  /** Feed currently projected through the main map camera (SENSOR POV). */
  readonly pov = signal<FeedSlot | null>(null);

  constructor() {
    this.sim.reset$.subscribe(() => {
      this.feeds.set([]);
      this.primary.set(0);
      this.pov.set(null);
    });
  }

  readonly visibleFeeds = computed(() => {
    const f = this.feeds();
    const n = this.layout();
    if (n === 1) return f.length ? [f[Math.min(this.primary(), f.length - 1)]] : [];
    return f.slice(0, n);
  });

  /** Payload type for the POV slot (re-evaluated at UI rate so switches show up). */
  readonly povType = computed<SensorType | null>(() => {
    this.sim.uiTick();
    const p = this.pov();
    return p ? (this.payload(p)?.type ?? null) : null;
  });

  vehicle(slot: FeedSlot): Vehicle | undefined {
    return this.sim.engine.byId.get(slot.vehicleId);
  }

  payload(slot: FeedSlot): Payload | undefined {
    return this.vehicle(slot)?.payloads.find((p) => p.id === slot.payloadId);
  }

  feedIndexOf(vehicleId: string): number {
    return this.feeds().findIndex((f) => f.vehicleId === vehicleId);
  }

  /** OPEN SENSOR: put the vehicle's active payload on the primary feed and show the sensor panel. */
  openSensor(vehicleId: string, payloadId?: string): void {
    const v = this.sim.engine.byId.get(vehicleId);
    if (!v) return;
    const pid = payloadId ?? v.activePayloadId ?? v.payloads[0]?.id;
    if (!pid) return;
    const slot: FeedSlot = { vehicleId, payloadId: pid };
    const feeds = [...this.feeds()];
    const existing = feeds.findIndex((f) => f.vehicleId === vehicleId);
    if (existing >= 0) {
      feeds[existing] = slot;
      this.primary.set(existing);
    } else if (this.layout() === 1 || feeds.length >= 4) {
      const i = Math.min(this.primary(), Math.max(0, feeds.length - 1));
      if (feeds.length === 0) feeds.push(slot);
      else feeds[i] = slot;
      this.primary.set(Math.max(0, i));
    } else {
      feeds.push(slot);
      this.primary.set(feeds.length - 1);
    }
    this.feeds.set(feeds);
    this.ops.select(vehicleId);
    this.ops.rightPanel.set('SENSOR');
  }

  /** Assign a vehicle into a specific feed slot (split/quad views). */
  assign(index: number, vehicleId: string): void {
    const v = this.sim.engine.byId.get(vehicleId);
    if (!v) return;
    const feeds = [...this.feeds()];
    const slot = { vehicleId, payloadId: v.activePayloadId ?? v.payloads[0].id };
    if (index < feeds.length) feeds[index] = slot;
    else feeds.push(slot);
    this.feeds.set(feeds);
  }

  closeFeed(index: number): void {
    const feeds = this.feeds().filter((_, i) => i !== index);
    this.feeds.set(feeds);
    this.primary.set(Math.max(0, Math.min(this.primary(), feeds.length - 1)));
  }

  /** Switch payload type (EO / THERMAL / IR / RADAR) on a slot; mirrors into POV if same vehicle. */
  switchType(slot: FeedSlot, type: SensorType): void {
    const v = this.vehicle(slot);
    const p = v?.payloads.find((x) => x.type === type);
    if (!v || !p) return;
    this.sim.dispatch({ type: 'SET_PAYLOAD', vehicleId: v.id, payloadId: p.id });
    const next: FeedSlot = { vehicleId: v.id, payloadId: p.id };
    this.feeds.set(this.feeds().map((f) => (f.vehicleId === v.id ? next : f)));
    if (this.pov()?.vehicleId === v.id) this.pov.set(next);
  }

  setFov(slot: FeedSlot, mode: FovMode): void {
    this.sim.dispatch({ type: 'SET_FOV', vehicleId: slot.vehicleId, payloadId: slot.payloadId, mode });
  }

  enterPov(vehicleId: string, payloadId?: string): void {
    const v = this.sim.engine.byId.get(vehicleId);
    if (!v) return;
    const pid = payloadId ?? this.feeds().find((f) => f.vehicleId === vehicleId)?.payloadId ?? v.activePayloadId ?? v.payloads[0].id;
    this.pov.set({ vehicleId, payloadId: pid });
    this.ops.select(vehicleId);
    if (this.ops.viewDim() === '2D') this.ops.viewDim.set('3D');
    this.ops.cameraMode.set('SENSOR_POV');
  }

  exitPov(to: 'FREE_3D' | 'FOLLOW_VEHICLE' | 'TACTICAL' = 'FREE_3D'): void {
    this.pov.set(null);
    this.ops.cameraMode.set(to);
  }
}
