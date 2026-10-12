import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { OpsStore } from './ops-store';
import { SensorStore } from './sensor.store';
import { SimHost } from './sim-host.service';

export type Role = 'COMMANDER' | 'OPERATOR' | 'INTELLIGENCE' | 'MAINTENANCE';

export const ROLES: { id: Role; label: string; focus: string }[] = [
  { id: 'COMMANDER', label: 'Commander', focus: 'Mission & fleet overview' },
  { id: 'OPERATOR', label: 'Operator', focus: 'Map · tasks · assets' },
  { id: 'INTELLIGENCE', label: 'Intelligence', focus: 'Sensors · POIs · tracks' },
  { id: 'MAINTENANCE', label: 'Maintenance', focus: 'Health · telemetry · warnings' },
];

/**
 * Role views change information emphasis, not permissions (no authentication in this prototype).
 * Each role applies a layout/layer preset; operators can still change anything afterwards.
 */
@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly ops = inject(OpsStore);
  private readonly sensors = inject(SensorStore);
  private readonly sim = inject(SimHost);
  readonly role = signal<Role>('OPERATOR');
  readonly presentation = signal(false);

  constructor() {
    effect(() => {
      const r = this.role();
      untracked(() => this.apply(r));
    });
    effect(() => {
      const on = this.presentation();
      document.documentElement.classList.toggle('presentation', on);
      // rem-scaled widgets (virtual list rows, map canvas) re-measure.
      setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    });
  }

  private apply(r: Role): void {
    const o = this.ops;
    const base = { ...o.layers() };
    switch (r) {
      case 'COMMANDER':
        o.leftCollapsed.set(false);
        o.leftTab.set('MISSIONS');
        o.layers.set({ ...base, missions: true, coverage: true, sensors: false, links: false, labels: false, tracks: true, geofences: true });
        o.clustering.set(true);
        break;
      case 'OPERATOR':
        o.leftCollapsed.set(false);
        o.leftTab.set('FLEET');
        o.layers.set({ ...base, missions: true, coverage: true, sensors: true, links: false, labels: true, tracks: true, annotations: true });
        break;
      case 'INTELLIGENCE': {
        o.layers.set({ ...base, sensors: true, annotations: true, tracks: true, labels: true, links: false });
        const e = this.sim.engine;
        const busy = e.vehicles.filter((v) => v.missionId && v.opState === 'ACTIVE' && v.pos.z > 5).slice(0, 4);
        if (busy.length) {
          this.sensors.layout.set(busy.length >= 3 ? 4 : busy.length === 2 ? 2 : 1);
          this.sensors.feeds.set([]);
          busy.forEach((v, i) => this.sensors.assign(i, v.id));
          o.select(busy[0].id);
        }
        o.rightPanel.set('SENSOR');
        break;
      }
      case 'MAINTENANCE':
        o.leftCollapsed.set(false);
        o.leftTab.set('FLEET');
        o.layers.set({ ...base, links: true, sensors: false, coverage: false, labels: true });
        break;
    }
  }
}
