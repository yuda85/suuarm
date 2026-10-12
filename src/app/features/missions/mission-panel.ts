import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MissionType, Priority, SectorState } from '../../core/domain/mission';
import { SensorType } from '../../core/domain/sensor';
import { VehicleState } from '../../core/domain/vehicle';
import { MissionStore, PLAN_STAGES } from '../../core/state/mission.store';
import { OpsStore } from '../../core/state/ops-store';
import { MapService } from '../../map/map.service';
import { Icon } from '../../shared/ui/icon';
import { CircleCheck, Crosshair, MapPin, Play, Square, Target, X } from '../../shared/ui/icons';

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
const SENSORS: SensorType[] = ['EO', 'THERMAL', 'IR', 'RADAR'];
const ASSET_ORDER: VehicleState[] = ['ACTIVE', 'READY', 'RETURNING', 'HOLD', 'WARNING', 'OFFLINE'];

@Component({
  selector: 'app-mission-panel',
  imports: [Icon, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mission-panel.html',
  styleUrl: './mission-panel.scss',
})
export class MissionPanel {
  protected readonly ms = inject(MissionStore);
  protected readonly ops = inject(OpsStore);
  private readonly map = inject(MapService);
  protected readonly icons = { Play, Square, X, MapPin, Crosshair, Target, CircleCheck };
  protected readonly priorities = PRIORITIES;
  protected readonly sensors = SENSORS;
  protected readonly stages = PLAN_STAGES;
  protected readonly cur = this.ms.current;
  protected readonly draft = this.ms.draft;
  protected readonly drawing = this.map.drawing;

  protected readonly stageIndex = computed(() => PLAN_STAGES.findIndex((s) => s.id === this.ms.stage()));
  protected readonly planned = computed(() => this.cur()?.mission.status === 'PLANNED');
  protected readonly active = computed(() => this.cur()?.mission.status === 'ACTIVE');
  protected readonly complete = computed(() => this.cur()?.mission.status === 'COMPLETE');
  protected readonly showBuilder = computed(() => this.ms.builderOpen() || (!this.cur() && this.ms.stage() === 'idle'));
  protected readonly assetRows = computed(() => {
    const c = this.cur();
    return c ? ASSET_ORDER.filter((s) => c.assets[s] > 0).map((s) => ({ s, n: c.assets[s] })) : [];
  });
  protected readonly stageDetail = computed(() => {
    const st = this.cur()?.mission.stats;
    if (!st) return {} as Record<string, string>;
    return {
      evaluate: `${st.evaluated} assets online`,
      capable: `${st.capable} meet sensor + endurance`,
      divide: `${st.sectors} sectors`,
      allocate: `${st.assigned} assets assigned`,
      routes: `${st.routeKm.toFixed(1)} km of routes`,
      ready: `ETA ${Math.max(1, Math.round(st.etaMin))} min`,
    } as Record<string, string>;
  });

  protected typeLabel(t: MissionType): string {
    return t === 'BUILDING_SCAN' ? 'Building scan' : t === 'AERIAL_RESPONSE' ? 'Airspace response' : 'Area survey';
  }

  protected stateLabel(s: SectorState): string {
    return s === 'SCANNED' ? 'COMPLETE' : s;
  }

  protected setType(t: MissionType): void {
    this.ms.patch({ type: t, name: t === 'BUILDING_SCAN' ? 'Building Scan' : 'Area Survey', targetId: this.draft().targetId ?? this.ms.buildings()[0]?.id ?? null });
  }

  protected toggleSensor(s: SensorType): void {
    const cur = this.draft().sensors;
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    if (next.length) this.ms.patch({ sensors: next });
  }

  protected async drawArea(): Promise<void> {
    const pts = await this.map.draw('polygon');
    if (pts && pts.length >= 3) this.ms.patch({ areaId: 'DRAWN', drawn: pts });
  }

  protected newMission(): void {
    this.ms.builderOpen.set(true);
  }

  protected focusArea(): void {
    const d = this.draft();
    const target = d.type === 'BUILDING_SCAN' ? this.ms.buildings().find((b) => b.id === d.targetId) : null;
    const ring = (this.ms.builderOpen() || !this.cur() ? (target ? target.ring : this.ms.draftRing()) : null) ?? this.cur()?.mission.intent.area;
    if (ring) this.map.fitRing(ring);
  }
}
