import { computed, inject, Injectable, signal } from '@angular/core';
import { CameraMode } from '../domain/camera';
import { SwarmMode } from '../domain/ops';
import { displayState, Vehicle, VehicleCapability, VehicleState } from '../domain/vehicle';
import { SimHost } from './sim-host.service';

export type ViewDim = '2D' | '3D';

export interface ClusterSummary {
  x: number;
  y: number;
  count: number;
  states: Record<VehicleState, number>;
  caps: Partial<Record<VehicleCapability, number>>;
}
export type Basemap = 'VECTOR' | 'SATELLITE';

export type LayerKey = 'missions' | 'coverage' | 'sensors' | 'links' | 'geofences' | 'tracks' | 'annotations' | 'labels' | 'hubs' | 'campus';
export const LAYER_PREFIXES: Record<LayerKey, string[]> = {
  missions: ['mission-area', 'mission-sectors', 'mission-routes', 'mission-sector-labels', 'sel-route'],
  coverage: ['mission-coverage', 'campus-coverage', 'campus-sector-labels'],
  sensors: ['sensor-'],
  links: ['link-'],
  geofences: ['geofence-'],
  tracks: ['track-'],
  annotations: ['anno-', 'draw-'],
  labels: ['uav-label', 'uav-cap-badge', 'hub-labels', 'mission-sector-labels', 'campus-sector-labels'],
  hubs: ['hub-'],
  campus: ['campus-lots', 'campus-bodies', 'campus-windows', 'campus-hvac', 'campus-cars', 'campus-edges'],
};
export type RightPanel = 'ASSET' | 'SENSOR' | 'MISSION' | null;

export interface Kpis {
  missionPct: number;
  fleetOnline: number;
  fleetTotal: number;
  tasks: number;
  warnings: number;
  system: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
}

/** Application/UI state. Simulation truth lives in the engine; this exposes 4 Hz views of it. */
@Injectable({ providedIn: 'root' })
export class OpsStore {
  private readonly sim = inject(SimHost);

  readonly selectedId = signal<string | null>(null);
  readonly selectedTrackId = signal<string | null>(null);
  readonly hoveredId = signal<string | null>(null);
  readonly viewDim = signal<ViewDim>('3D');
  readonly basemap = signal<Basemap>('VECTOR');
  readonly terrain = signal(true);
  readonly buildings = signal(true);
  readonly cameraMode = signal<CameraMode>('FREE_3D');
  readonly rightPanel = signal<RightPanel>('ASSET');
  readonly leftCollapsed = signal(false);
  readonly leftTab = signal<'FLEET' | 'MISSIONS'>('FLEET');
  readonly mapReady = signal(false);
  readonly mapProvider = signal<'MAPTILER' | 'OPENFREEMAP' | 'OFFLINE'>('OPENFREEMAP');
  /** Map layer toggles. */
  readonly layers = signal<Record<LayerKey, boolean>>({
    missions: true,
    coverage: true,
    sensors: true,
    links: false,
    geofences: true,
    tracks: true,
    annotations: true,
    labels: true,
    hubs: true,
    campus: true,
  });
  readonly trails = signal(false);

  toggleLayer(k: LayerKey): void {
    this.layers.set({ ...this.layers(), [k]: !this.layers()[k] });
  }
  readonly clustering = signal(true);
  /** Hovered cluster summary for the hover card (screen coords). */
  readonly hoveredCluster = signal<ClusterSummary | null>(null);

  constructor() {
    this.sim.reset$.subscribe(() => {
      this.selectedId.set(null);
      this.selectedTrackId.set(null);
      this.hoveredId.set(null);
      this.hoveredCluster.set(null);
      this.cameraMode.set(this.viewDim() === '2D' ? 'FREE_2D' : 'FREE_3D');
    });
  }

  /** Vehicles, re-emitted at UI rate (mutable engine objects; equality disabled on purpose). */
  readonly vehicles = computed<readonly Vehicle[]>(
    () => {
      this.sim.uiTick();
      this.sim.generation();
      return this.sim.engine.vehicles;
    },
    { equal: () => false },
  );

  readonly swarmMode = computed<SwarmMode>(() => {
    this.sim.uiTick();
    return this.sim.engine.swarmMode;
  });

  readonly selected = computed<Vehicle | null>(
    () => {
      const id = this.selectedId();
      if (!id) return null;
      return this.vehicles().find((v) => v.id === id) ?? null;
    },
    { equal: () => false },
  );

  readonly stateCounts = computed(() => {
    const c: Record<VehicleState, number> = { READY: 0, ACTIVE: 0, HOLD: 0, RETURNING: 0, WARNING: 0, OFFLINE: 0 };
    for (const v of this.vehicles()) c[displayState(v)]++;
    return c;
  });

  readonly kpis = computed<Kpis>(() => {
    const vs = this.vehicles();
    const c = this.stateCounts();
    const online = vs.length - c.OFFLINE;
    const tasks = vs.filter((v) => v.opState === 'ACTIVE' && !!v.route).length;
    const warnings = c.WARNING + c.OFFLINE;
    return {
      missionPct: 0,
      fleetOnline: online,
      fleetTotal: vs.length,
      tasks,
      warnings,
      system: c.OFFLINE > 0 ? 'DEGRADED' : 'HEALTHY',
    };
  });

  selectTrack(id: string | null): void {
    this.selectedTrackId.set(id);
    if (id) {
      this.selectedId.set(null);
      this.rightPanel.set('ASSET');
      if (this.cameraMode() === 'FOLLOW_VEHICLE' || this.cameraMode() === 'SENSOR_POV') this.cameraMode.set('FREE_3D');
    }
  }

  select(id: string | null): void {
    this.selectedId.set(id);
    if (id) this.selectedTrackId.set(null);
    if (id) this.rightPanel.set(this.rightPanel() ?? 'ASSET');
    if (!id && (this.cameraMode() === 'FOLLOW_VEHICLE' || this.cameraMode() === 'SENSOR_POV')) {
      this.cameraMode.set(this.viewDim() === '2D' ? 'FREE_2D' : 'FREE_3D');
    }
  }

  setSwarm(mode: SwarmMode): void {
    this.sim.dispatch({ type: 'SET_SWARM_MODE', mode });
  }
}
