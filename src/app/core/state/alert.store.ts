import { computed, inject, Injectable, signal } from '@angular/core';
import { Alert, AutonomyMode, Recommendation, SystemHealth } from '../domain/ops';
import { OpsStore } from './ops-store';
import { SimHost } from './sim-host.service';

const TOAST_MS = 6500;

/** Alerts, operator recommendations (supervised autonomy) and system health. */
@Injectable({ providedIn: 'root' })
export class AlertStore {
  private readonly sim = inject(SimHost);
  private readonly ops = inject(OpsStore);

  readonly centerOpen = signal(false);
  readonly healthOpen = signal(false);
  readonly toasts = signal<Alert[]>([]);

  constructor() {
    this.sim.reset$.subscribe(() => this.toasts.set([]));
    this.sim.alerts$.subscribe((a) => {
      if (a.severity === 'INFO' && a.kind !== 'TASK_REASSIGNED') return;
      this.toasts.update((t) => [a, ...t].slice(0, 4));
      setTimeout(() => this.dismissToast(a.id), a.severity === 'CRITICAL' ? TOAST_MS + 2500 : TOAST_MS);
    });
  }

  readonly alerts = computed<readonly Alert[]>(
    () => {
      this.sim.uiTick();
      this.sim.generation();
      return this.sim.engine.alerts;
    },
    { equal: () => false },
  );

  readonly unacked = computed(() => this.alerts().filter((a) => !a.acknowledged));
  readonly unackedCritical = computed(() => this.unacked().some((a) => a.severity === 'CRITICAL'));

  readonly pending = computed<Recommendation[]>(() => {
    this.sim.uiTick();
    return this.sim.engine.missions.recommendations.filter((r) => r.status === 'PENDING');
  });

  readonly autonomy = computed<AutonomyMode>(() => {
    this.sim.uiTick();
    return this.sim.engine.missions.autonomy;
  });

  readonly health = computed<SystemHealth>(() => {
    const vs = this.ops.vehicles();
    const total = vs.length;
    const online = vs.filter((v) => v.opState !== 'OFFLINE' && !v.health.linkLost).length;
    const linkIssues = vs.some((v) => v.health.linkLost || v.health.linkDegraded);
    const sensorIssues = vs.some((v) => v.health.payloadFault);
    const offline = vs.filter((v) => v.opState === 'OFFLINE').length;
    const mapDeg = this.ops.mapProvider() === 'OFFLINE';
    const ratio = total ? online / total : 1;
    const level: SystemHealth['level'] =
      ratio < 0.9 || this.unacked().filter((a) => a.severity === 'CRITICAL').length >= 3
        ? 'CRITICAL'
        : offline || linkIssues || sensorIssues || mapDeg || this.pending().length
          ? 'DEGRADED'
          : 'HEALTHY';
    return {
      level,
      core: 'ONLINE',
      network: linkIssues ? 'DEGRADED' : 'ONLINE',
      edgeOnline: online,
      edgeTotal: total,
      sensorServices: sensorIssues ? 'DEGRADED' : 'ONLINE',
      mapServices: mapDeg ? 'DEGRADED' : 'ONLINE',
    };
  });

  approve(r: Recommendation): void {
    this.sim.dispatch({ type: 'APPROVE', recommendationId: r.id });
  }

  reject(r: Recommendation): void {
    this.sim.dispatch({ type: 'REJECT', recommendationId: r.id });
  }

  setAutonomy(mode: AutonomyMode): void {
    this.sim.dispatch({ type: 'SET_AUTONOMY', mode });
  }

  ack(a: Alert): void {
    a.acknowledged = true;
    this.sim.uiTick.update((t) => t + 1);
  }

  ackAll(): void {
    for (const a of this.sim.engine.alerts) a.acknowledged = true;
    this.sim.uiTick.update((t) => t + 1);
  }

  dismissToast(id: string): void {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
