import { ScrollingModule } from '@angular/cdk/scrolling';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { SensorType } from '../../core/domain/sensor';
import { taskGroup, taskLabel } from '../../core/domain/tasking';
import { CAPABILITY_LABEL, displayState, Vehicle, VehicleCapability, VehicleState } from '../../core/domain/vehicle';
import { PLATFORMS } from '../../core/sim/platforms';
import { OpsStore } from '../../core/state/ops-store';
import { MapService } from '../../map/map.service';
import { SimHost } from '../../core/state/sim-host.service';
import { MissionStore } from '../../core/state/mission.store';
import { MissionPanel } from '../missions/mission-panel';
import { RoleService } from '../../core/state/role.service';
import { AirframeGlyph } from '../../shared/ui/airframe-glyph';
import { Icon } from '../../shared/ui/icon';
import { ChevronLeft, Search, Signal } from '../../shared/ui/icons';
import { Meter, StatusChip } from '../../shared/ui/status-chip';

const STATES: VehicleState[] = ['ACTIVE', 'READY', 'HOLD', 'RETURNING', 'WARNING', 'OFFLINE'];

@Component({
  selector: 'app-fleet-panel',
  imports: [ScrollingModule, StatusChip, Meter, AirframeGlyph, Icon, MissionPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <div class="tabs" role="tablist">
        <button role="tab" type="button" [attr.aria-selected]="tab() === 'FLEET'" (click)="tab.set('FLEET')">Fleet</button>
        <button role="tab" type="button" [attr.aria-selected]="tab() === 'MISSIONS'" (click)="tab.set('MISSIONS')">
          Missions
          @if (missionPct() !== null) {
            <span class="tab-badge mono">{{ missionPct() }}%</span>
          }
        </button>
      </div>
      <button type="button" class="collapse" aria-label="Collapse panel" (click)="store.leftCollapsed.set(true)">
        <ui-icon [icon]="icons.ChevronLeft" [size]="16" />
      </button>
    </header>

    @if (tab() === 'FLEET') {
      <div class="summary" role="group" aria-label="Fleet state filter">
        @for (s of states; track s) {
          <button
            type="button"
            class="sum"
            [attr.data-s]="s"
            [class.on]="stateFilter() === s"
            [class.zero]="counts()[s] === 0"
            (click)="toggleState(s)"
            [attr.aria-pressed]="stateFilter() === s"
          >
            <span class="n mono">{{ counts()[s] }}</span>
            <span class="l">{{ s }}</span>
          </button>
        }
      </div>
      <label class="search">
        <ui-icon [icon]="icons.Search" [size]="14" />
        <span class="sr-only">Search fleet</span>
        <input type="search" placeholder="Search ID, callsign, capability" [value]="query()" (input)="query.set($any($event.target).value)" />
        <span class="count mono">{{ rows().length }}/{{ store.vehicles().length }}</span>
      </label>
      <div class="filters" role="group" aria-label="Fleet filters">
        <label>
          <span class="sr-only">Task</span>
          <select [value]="taskF()" (change)="taskF.set($any($event.target).value)">
            <option value="">All tasks</option>
            @for (t of taskOptions(); track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
        </label>
        <label>
          <span class="sr-only">Capability</span>
          <select [value]="capF()" (change)="capF.set($any($event.target).value)">
            <option value="">All capabilities</option>
            @for (c of capOptions; track c) {
              <option [value]="c">{{ capLabel[c] }}</option>
            }
          </select>
        </label>
        <label>
          <span class="sr-only">Payload</span>
          <select [value]="payF()" (change)="payF.set($any($event.target).value)">
            <option value="">All payloads</option>
            @for (p of payOptions; track p) {
              <option [value]="p">{{ p }}</option>
            }
          </select>
        </label>
        <label>
          <span class="sr-only">Platform</span>
          <select [value]="platF()" (change)="platF.set($any($event.target).value)">
            <option value="">All platforms</option>
            @for (p of platOptions; track p.id) {
              <option [value]="p.id">{{ p.name }}</option>
            }
          </select>
        </label>
        @if (anyFilter()) {
          <button type="button" class="clear" (click)="clearFilters()">Clear</button>
        }
      </div>
      <div class="cols caps" aria-hidden="true">
        <span>Asset</span><span>State</span><span>Batt</span><span>Link</span>
      </div>
      <cdk-virtual-scroll-viewport class="list" [itemSize]="rowPx()" minBufferPx="400" maxBufferPx="800" role="listbox" aria-label="Fleet">
        <button
          *cdkVirtualFor="let v of rows(); trackBy: trackId"
          type="button"
          role="option"
          class="row"
          [style.height.px]="rowPx()"
          [class.sel]="v.id === store.selectedId()"
          [attr.aria-selected]="v.id === store.selectedId()"
          (click)="pick(v)"
          (mouseenter)="store.hoveredId.set(v.id)"
          (mouseleave)="store.hoveredId.set(null)"
        >
          <ui-airframe [cls]="v.platform.airframe" [capability]="v.capability" [size]="24" />
          <span class="ident">
            <span class="id mono">{{ v.id }}</span>
            <span class="task">{{ maint() ? healthLine(v) : taskLabel(v) }}</span>
          </span>
          <ui-status [state]="ds(v)" />
          <span class="batt">
            <span class="mono pct">{{ pct(v.battery) }}</span>
            <ui-meter [value]="v.battery" [warnBelow]="0.25" [critBelow]="0.12" />
          </span>
          <span class="link" [attr.data-q]="linkLevel(v)" [attr.title]="'Link ' + pct(v.link.quality) + '%'">
            <i></i><i></i><i></i><i></i>
          </span>
        </button>
      </cdk-virtual-scroll-viewport>
    } @else {
      <app-mission-panel class="missions" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--sp-2) 0 var(--sp-3);
      border-bottom: 1px solid var(--c-line);
      height: 2.5rem;
      flex: none;
    }
    .tabs {
      display: flex;
      height: 100%;
      gap: var(--sp-4);
      button {
        position: relative;
        border: 0;
        background: none;
        padding: 0;
        color: var(--c-text-3);
        font-size: var(--t-xs);
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        cursor: pointer;
        &[aria-selected='true'] {
          color: var(--c-text-1);
          &::after {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            bottom: -1px;
            height: 2px;
            background: var(--c-accent);
          }
        }
        &:hover {
          color: var(--c-text-1);
        }
      }
    }
    .collapse {
      display: grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      border: 0;
      border-radius: var(--r-1);
      background: none;
      color: var(--c-text-3);
      cursor: pointer;
      &:hover {
        background: var(--c-raised);
        color: var(--c-text-1);
      }
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      margin: var(--sp-2) var(--sp-2) 0;
      background: var(--c-line);
      border: 1px solid var(--c-line);
      border-radius: var(--r-2);
      overflow: hidden;
      flex: none;
    }
    .sum {
      --c: var(--s-ready);
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      padding: 0.35rem 0.5rem;
      border: 0;
      background: var(--c-panel-solid);
      cursor: pointer;
      text-align: left;
      transition: background var(--m-fast);
      .n {
        font-size: var(--t-md);
        font-weight: 500;
        color: var(--c);
      }
      .l {
        font-size: 0.625rem;
        letter-spacing: 0.08em;
        color: var(--c-text-3);
      }
      &:hover {
        background: var(--c-raised);
      }
      &.on {
        background: color-mix(in srgb, var(--c) 14%, var(--c-panel-solid));
        box-shadow: inset 0 -2px 0 var(--c);
      }
      &.zero .n {
        color: var(--c-text-3);
      }
    }
    .sum[data-s='ACTIVE'] { --c: var(--s-active); }
    .sum[data-s='HOLD'] { --c: var(--s-hold); }
    .sum[data-s='RETURNING'] { --c: var(--s-returning); }
    .sum[data-s='WARNING'] { --c: var(--s-warning); }
    .sum[data-s='OFFLINE'] { --c: var(--s-critical); }
    .search {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      margin: var(--sp-2);
      padding: 0 var(--sp-2);
      height: 2rem;
      border: 1px solid var(--c-line);
      border-radius: var(--r-2);
      background: var(--c-app);
      color: var(--c-text-3);
      flex: none;
      &:focus-within {
        border-color: var(--c-accent-line);
      }
      input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: 0;
        background: none;
        color: var(--c-text-1);
        font: inherit;
        font-size: var(--t-sm);
        &::placeholder {
          color: var(--c-text-3);
        }
      }
      .count {
        font-size: var(--t-micro);
      }
    }
    .filters {
      position: relative;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      margin: 0 var(--sp-2) var(--sp-2);
      flex: none;
      label {
        display: block;
        min-width: 0;
      }
      select {
        width: 100%;
        height: 1.65rem;
        padding: 0 0.4rem;
        border: 1px solid var(--c-line);
        border-radius: var(--r-1);
        background: var(--c-app);
        color: var(--c-text-2);
        font: inherit;
        font-size: var(--t-xs);
        cursor: pointer;
        &:focus-visible {
          border-color: var(--c-accent-line);
        }
      }
      .clear {
        position: absolute;
        right: 0;
        top: -1.95rem;
        height: 1.4rem;
        padding: 0 0.5rem;
        border: 0;
        border-radius: var(--r-1);
        background: var(--c-accent-soft);
        color: var(--c-accent-strong);
        font-size: 0.625rem;
        cursor: pointer;
      }
    }
    .cols {
      display: grid;
      grid-template-columns: 1fr 5rem 2.9rem 1.3rem;
      gap: 0.45rem;
      padding: 0 0.6rem var(--sp-1) 2.75rem;
      color: var(--c-text-3);
      flex: none;
      font-size: 0.625rem;
    }
    .list {
      flex: 1;
      min-height: 0;
      border-top: 1px solid var(--c-line);
    }
    .row {
      display: grid;
      grid-template-columns: 1.6rem 1fr 5rem 2.9rem 1.3rem;
      align-items: center;
      gap: 0.45rem;
      width: 100%;
      padding: 0 0.6rem;
      border: 0;
      border-bottom: 1px solid var(--c-line-soft);
      background: none;
      text-align: left;
      cursor: pointer;
      transition: background var(--m-fast);
      &:hover {
        background: var(--c-raised);
      }
      &.sel {
        background: var(--c-accent-soft);
        box-shadow: inset 2px 0 0 var(--c-accent);
        ui-airframe {
          color: var(--c-accent-strong);
        }
      }
    }
    .ident {
      display: flex;
      flex-direction: column;
      min-width: 0;
      line-height: 1.25;
    }
    .id {
      font-size: var(--t-sm);
      font-weight: 500;
      color: var(--c-text-1);
      white-space: nowrap;
    }
    .task {
      font-size: var(--t-xs);
      color: var(--c-text-3);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .batt {
      display: flex;
      flex-direction: column;
      gap: 3px;
      .pct {
        font-size: var(--t-xs);
        color: var(--c-text-2);
      }
    }
    .link {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 0.8rem;
      i {
        width: 3px;
        background: var(--c-raised-2);
        border-radius: 1px;
      }
      i:nth-child(1) { height: 30%; }
      i:nth-child(2) { height: 55%; }
      i:nth-child(3) { height: 78%; }
      i:nth-child(4) { height: 100%; }
      &[data-q='4'] i { background: var(--s-active); }
      &[data-q='3'] i:nth-child(-n + 3) { background: var(--s-active); }
      &[data-q='2'] i:nth-child(-n + 2) { background: var(--s-warning); }
      &[data-q='1'] i:nth-child(1) { background: var(--s-critical); }
    }
    .missions {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .tab-badge {
      margin-left: 0.35rem;
      padding: 0 0.3rem;
      border-radius: 2px;
      background: var(--s-active-soft);
      color: var(--s-active);
      font-size: 0.625rem;
      letter-spacing: 0;
    }
    .empty {
      padding: var(--sp-6) var(--sp-4);
      color: var(--c-text-3);
      p {
        margin: 0 0 var(--sp-2);
      }
    }
  `,
})
export class FleetPanel {
  protected readonly store = inject(OpsStore);
  private readonly map = inject(MapService);
  protected readonly icons = { Search, ChevronLeft, Signal };
  protected readonly states = STATES;
  protected readonly tab = this.store.leftTab;
  private readonly missions = inject(MissionStore);
  protected readonly missionPct = computed(() => (this.missions.current()?.mission.status === 'ACTIVE' ? this.missions.progressPct() : null));
  protected readonly query = signal('');
  protected readonly stateFilter = signal<VehicleState | null>(null);
  protected readonly counts = this.store.stateCounts;

  protected readonly taskF = signal('');
  protected readonly capF = signal('');
  protected readonly payF = signal('');
  protected readonly platF = signal('');
  protected readonly capLabel = CAPABILITY_LABEL;
  protected readonly capOptions = Object.keys(CAPABILITY_LABEL) as VehicleCapability[];
  protected readonly payOptions: SensorType[] = ['EO', 'THERMAL', 'IR', 'RADAR'];
  protected readonly platOptions = Object.values(PLATFORMS).map((p) => ({ id: p.id as string, name: p.name }));
  private readonly group = (v: Vehicle) => taskGroup(v, (id) => {
    const m = this.sim.engine.missions.missions.find((x) => x.id === id);
    return m ? `${m.code} ${m.intent.name}` : null;
  });
  protected readonly taskOptions = computed(() => [...new Set(this.store.vehicles().map(this.group))].sort());
  protected readonly anyFilter = computed(() => !!(this.taskF() || this.capF() || this.payF() || this.platF() || this.stateFilter()));

  protected clearFilters(): void {
    this.taskF.set('');
    this.capF.set('');
    this.payF.set('');
    this.platF.set('');
    this.stateFilter.set(null);
  }

  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const sf = this.stateFilter();
    const tf = this.taskF();
    const cf = this.capF();
    const pf = this.payF();
    const plf = this.platF();
    const maint = this.roles.role() === 'MAINTENANCE';
    const list = this.store.vehicles().filter((v) => {
      if (sf && displayState(v) !== sf) return false;
      if (tf && this.group(v) !== tf) return false;
      if (cf && v.capability !== cf) return false;
      if (pf && !v.payloads.some((p) => p.type === pf)) return false;
      if (plf && v.platform.id !== plf) return false;
      if (!q) return true;
      return (
        v.id.toLowerCase().includes(q) ||
        v.callsign.toLowerCase().includes(q) ||
        v.capability.toLowerCase().includes(q) ||
        v.platform.name.toLowerCase().includes(q)
      );
    });
    if (!maint) return list;
    const score = (v: Vehicle) => (v.opState === 'OFFLINE' ? 0 : displayState(v) === 'WARNING' ? 1 : 2) * 10 + v.battery;
    return [...list].sort((a, b) => score(a) - score(b));
  });

  private readonly roles = inject(RoleService);
  protected readonly maint = computed(() => this.roles.role() === 'MAINTENANCE');
  /** Virtual-scroll row height tracks the rem scale (laptop → 4K wall). */
  protected readonly rowPx = signal(46);
  protected readonly ds = displayState;
  private readonly measure = () => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
    this.rowPx.set(Math.round(rem * 3.5));
  };
  constructor() {
    this.measure();
    window.addEventListener('resize', this.measure);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('resize', this.measure));
  }
  protected trackId = (_: number, v: Vehicle) => v.id;

  protected pct(x: number): number {
    return Math.round(x * 100);
  }

  protected linkLevel(v: Vehicle): number {
    if (v.opState === 'OFFLINE' || v.link.state === 'LOST') return 0;
    const q = v.link.quality;
    return q > 0.8 ? 4 : q > 0.55 ? 3 : q > 0.3 ? 2 : 1;
  }

  private readonly sim = inject(SimHost);
  protected healthLine(v: Vehicle): string {
    return `${Math.round(v.compute.tempC)}°C · load ${Math.round(v.compute.load * 100)}% · ${v.nav.state} · ${v.link.latencyMs} ms`;
  }

  protected taskLabel(v: Vehicle): string {
    return taskLabel(v, (x) => (x.taskId ? (this.sim.engine.missions.tasks.get(x.taskId)?.name ?? null) : null));
  }

  protected toggleState(s: VehicleState): void {
    this.stateFilter.set(this.stateFilter() === s ? null : s);
  }

  protected pick(v: Vehicle): void {
    this.store.select(v.id);
    this.map.focusVehicle(v.id);
  }
}
