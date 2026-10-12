import { computed, inject, Injectable, signal } from '@angular/core';
import { Ring } from '../domain/geometry';
import { Mission, MissionIntent, MissionType, Priority, Sector, Task } from '../domain/mission';
import { SensorType } from '../domain/sensor';
import { displayState, VehicleState } from '../domain/vehicle';
import { SimHost } from './sim-host.service';

export interface MissionView {
  mission: Mission;
  sectors: Sector[];
  tasks: Task[];
  assets: Record<VehicleState, number>;
}

export interface Draft {
  type: MissionType;
  name: string;
  areaId: string | 'DRAWN' | null;
  drawn: Ring | null;
  priority: Priority;
  sensors: SensorType[];
  altitude: number;
  targetId: string | null;
}

export type PlanStage = 'idle' | 'evaluate' | 'capable' | 'divide' | 'allocate' | 'routes' | 'ready';
export const PLAN_STAGES: { id: PlanStage; label: string }[] = [
  { id: 'evaluate', label: 'Evaluate fleet' },
  { id: 'capable', label: 'Select capable' },
  { id: 'divide', label: 'Divide mission area' },
  { id: 'allocate', label: 'Allocate tasks' },
  { id: 'routes', label: 'Generate routes' },
  { id: 'ready', label: 'Present plan' },
];

/** Mission-level UI state. Truth lives in the engine's MissionSystem; this exposes 4 Hz views + the builder. */
@Injectable({ providedIn: 'root' })
export class MissionStore {
  private readonly sim = inject(SimHost);

  readonly builderOpen = signal(false);
  readonly draft = signal<Draft>(this.defaultDraft());
  readonly stage = signal<PlanStage>('idle');
  private stageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.sim.reset$.subscribe(() => {
      this.stage.set('idle');
      this.builderOpen.set(false);
      this.draft.set(this.defaultDraft());
    });
  }

  private defaultDraft(): Draft {
    const d = this.sim.engine.scenario.defaultIntent();
    return {
      type: d.type,
      name: d.name,
      areaId: 'campus',
      drawn: null,
      priority: d.priority,
      sensors: [...d.requiredSensors],
      altitude: 60,
      targetId: d.targetBuildingId ?? null,
    };
  }

  readonly buildings = computed(() => {
    this.sim.generation();
    return this.sim.engine.scenario.campus?.buildings ?? [];
  });

  readonly presets = computed(() => {
    this.sim.generation();
    return this.sim.engine.scenario.presetAreas;
  });

  private readonly ms = computed(
    () => {
      this.sim.uiTick();
      return this.sim.engine.missions;
    },
    { equal: () => false },
  );

  readonly views = computed<MissionView[]>(() => {
    const sys = this.ms();
    const vs = this.sim.engine.byId;
    return sys.missions.map((m) => {
      const sectors = m.sectorIds.map((id) => sys.sectors.get(id)!).filter(Boolean);
      const tasks = m.taskIds.map((id) => sys.tasks.get(id)!).filter(Boolean);
      const assets: Record<VehicleState, number> = { READY: 0, ACTIVE: 0, HOLD: 0, RETURNING: 0, WARNING: 0, OFFLINE: 0 };
      for (const t of tasks) {
        const v = t.vehicleId ? vs.get(t.vehicleId) : undefined;
        if (v) assets[displayState(v)]++;
      }
      return { mission: m, sectors, tasks, assets };
    });
  });

  readonly current = computed<MissionView | null>(() => {
    const vs = this.views();
    return vs.find((v) => v.mission.status === 'ACTIVE') ?? vs.find((v) => v.mission.status === 'PLANNED') ?? [...vs].reverse().find((v) => v.mission.status === 'COMPLETE') ?? null;
  });

  readonly progressPct = computed(() => Math.round((this.current()?.mission.progress ?? 0) * 100));

  draftRing(): Ring | null {
    const d = this.draft();
    if (d.areaId === 'DRAWN') return d.drawn;
    return this.presets().find((p) => p.id === d.areaId)?.ring ?? null;
  }

  patch(p: Partial<Draft>): void {
    this.draft.set({ ...this.draft(), ...p });
  }

  /** Generate plan: engine plans immediately; UI walks the operator through each planning stage. */
  generate(): void {
    const d = this.draft();
    const target = d.type === 'BUILDING_SCAN' ? this.buildings().find((b) => b.id === d.targetId) ?? this.buildings()[0] : null;
    const ring = target ? target.ring : this.draftRing();
    if (!ring || ring.length < 3) return;
    const intent: MissionIntent = {
      type: d.type,
      name: d.name,
      area: ring,
      priority: d.priority,
      requiredSensors: d.sensors,
      altitude: d.altitude,
      targetBuildingId: target?.id,
    };
    this.sim.dispatch({ type: 'PLAN_MISSION', intent });
    this.runStages();
  }

  private runStages(): void {
    if (this.stageTimer) clearTimeout(this.stageTimer);
    const ids = PLAN_STAGES.map((s) => s.id);
    let i = 0;
    const step = () => {
      this.stage.set(ids[i]);
      i++;
      if (i < ids.length) this.stageTimer = setTimeout(step, 420);
    };
    step();
  }

  start(): void {
    this.sim.dispatch({ type: 'START_MISSION' });
    this.stage.set('idle');
    this.builderOpen.set(false);
  }

  abort(): void {
    this.sim.dispatch({ type: 'ABORT_MISSION' });
    this.stage.set('idle');
  }

  discardPlan(): void {
    const p = this.views().find((v) => v.mission.status === 'PLANNED');
    if (p) this.sim.dispatch({ type: 'ABORT_MISSION', missionId: p.mission.id });
    this.stage.set('idle');
  }
}
