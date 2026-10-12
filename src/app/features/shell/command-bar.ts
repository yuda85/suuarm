import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SCENARIOS } from '../../core/scenarios/registry';
import { Role, RoleService, ROLES } from '../../core/state/role.service';
import { MapService } from '../../map/map.service';
import { OpsStore } from '../../core/state/ops-store';
import { SimHost } from '../../core/state/sim-host.service';
import { MissionStore } from '../../core/state/mission.store';
import { AlertStore } from '../../core/state/alert.store';
import { missionElapsed, tickClock } from '../../core/state/clock';
import { Icon } from '../../shared/ui/icon';
import { Bell, ShieldCheck, TriangleAlert } from '../../shared/ui/icons';
import { Logo } from '../../shared/ui/logo';

@Component({
  selector: 'app-command-bar',
  imports: [Logo, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="brand">
      <ui-logo />
      <div class="brand-text">
        <span class="product">Suuarm<b>OS</b></span>
        <span class="org">SUUARM SYSTEMS</span>
      </div>
      <span class="sep" aria-hidden="true"></span>
      <div class="scenario-wrap">
        <button type="button" class="scenario" (click)="menu.set(!menu())" [attr.aria-expanded]="menu()" aria-haspopup="menu">
          <span class="caps dim">Scenario · {{ scenarioName() }} ▾</span>
          <span class="mission">{{ missionName() }}</span>
        </button>
        @if (menu()) {
          <div class="menu" role="menu">
            @for (s of scenarios; track s.id) {
              <button type="button" role="menuitem" [class.on]="s.id === sim.scenarioId()" (click)="switchScenario(s.id)">
                <b>{{ s.name }}</b><span>{{ s.missionName }}</span>
              </button>
            }
          </div>
        }
      </div>
    </div>

    <div class="swarm" [attr.data-mode]="swarm()" role="group" aria-label="Swarm mode">
      <span class="caps swarm-label">Swarm mode</span>
      <div class="swarm-state" aria-live="polite">
        <span class="swarm-dot" aria-hidden="true"></span>
        <span class="swarm-value">{{ swarm() }}</span>
      </div>
      <button
        type="button"
        class="swarm-toggle"
        (click)="toggleSwarm()"
        [attr.aria-label]="swarm() === 'READY' ? 'Activate swarm' : 'Return swarm to ready'"
      >
        {{ toggleLabel() }}
      </button>
    </div>

    <dl class="kpis">
      <div class="kpi">
        <dt class="caps">Mission</dt>
        <dd class="mono">{{ k().missionPct }}<small>%</small></dd>
      </div>
      <div class="kpi">
        <dt class="caps">Fleet</dt>
        <dd class="mono">{{ k().fleetOnline }}<small> / {{ k().fleetTotal }}</small></dd>
      </div>
      <div class="kpi">
        <dt class="caps">Tasks</dt>
        <dd class="mono">{{ k().tasks }}</dd>
      </div>
      <div class="kpi" [class.warn]="k().warnings > 0">
        <dt class="caps">Warnings</dt>
        <dd class="mono">
          @if (k().warnings > 0) {
            <ui-icon [icon]="icons.TriangleAlert" [size]="13" />
          }
          {{ k().warnings }}
        </dd>
      </div>
      <button type="button" class="kpi system" [attr.data-level]="health().level" (click)="toggleHealth()" [attr.aria-expanded]="alerts.healthOpen()">
        <dt class="caps">System</dt>
        <dd><ui-icon [icon]="icons.ShieldCheck" [size]="14" /> {{ health().level }}</dd>
      </button>
    </dl>

    <div class="right">
      <div class="role-wrap">
        <button type="button" class="role" (click)="roleMenu.set(!roleMenu())" [attr.aria-expanded]="roleMenu()" aria-haspopup="menu" title="Role view">
          <span class="caps dim">Role</span>
          <span class="rname">{{ roleLabel() }} ▾</span>
        </button>
        @if (roleMenu()) {
          <div class="menu right" role="menu">
            @for (r of roleList; track r.id) {
              <button type="button" role="menuitem" [class.on]="roles.role() === r.id" (click)="setRole(r.id)">
                <b>{{ r.label }}</b><span>{{ r.focus }}</span>
              </button>
            }
            <button type="button" role="menuitemcheckbox" [attr.aria-checked]="roles.presentation()" [class.on]="roles.presentation()" (click)="roles.presentation.set(!roles.presentation()); roleMenu.set(false)">
              <b>Presentation mode</b><span>Larger type · cleaner chrome (B)</span>
            </button>
          </div>
        }
      </div>
      <div class="clock">
        <span class="mono time">{{ clock() }}</span>
        <span class="mono elapsed">{{ elapsed() }}</span>
      </div>
      <button type="button" class="icon-btn bell" [class.crit]="alerts.unackedCritical()" aria-label="Alerts" (click)="toggleCenter()" [attr.aria-expanded]="alerts.centerOpen()">
        <ui-icon [icon]="icons.Bell" [size]="17" />
        @if (alerts.unacked().length) {
          <span class="badge mono">{{ alerts.unacked().length > 99 ? '99+' : alerts.unacked().length }}</span>
        }
      </button>
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0 0 auto 0;
      height: var(--bar-h);
      z-index: var(--z-toolbar);
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
      align-items: center;
      padding: 0 var(--sp-3) 0 var(--sp-4);
      background: var(--c-graphite);
      border-bottom: 1px solid var(--c-line);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      min-width: 0;
    }
    .brand-text {
      display: flex;
      flex-direction: column;
      line-height: 1.05;
    }
    .product {
      font-size: var(--t-lg);
      font-weight: 500;
      letter-spacing: 0.01em;
      b {
        font-weight: 600;
        color: var(--c-accent-strong);
      }
    }
    .org {
      font-size: 0.5625rem;
      letter-spacing: 0.22em;
      color: var(--c-text-3);
    }
    .sep {
      width: 1px;
      height: 1.6rem;
      background: var(--c-line-strong);
    }
    .scenario {
      display: flex;
      flex-direction: column;
      min-width: 0;
      line-height: 1.2;
    }
    .dim {
      color: var(--c-text-3);
    }
    .scenario-wrap {
      position: relative;
      min-width: 0;
    }
    .scenario {
      border: 0;
      background: none;
      padding: 0.15rem 0.35rem;
      margin-left: -0.35rem;
      border-radius: var(--r-1);
      text-align: left;
      cursor: pointer;
      &:hover {
        background: var(--c-raised);
      }
    }
    .menu {
      position: absolute;
      top: calc(100% + 0.4rem);
      left: 0;
      z-index: var(--z-popover);
      width: 22rem;
      padding: 0.3rem;
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-3);
      background: var(--c-panel-solid);
      box-shadow: var(--shadow-pop);
      button {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: 0.5rem 0.6rem;
        border: 0;
        border-radius: var(--r-2);
        background: none;
        text-align: left;
        cursor: pointer;
        b {
          font-weight: 500;
        }
        span {
          color: var(--c-text-3);
          font-size: var(--t-xs);
        }
        &:hover {
          background: var(--c-raised);
        }
        &.on {
          background: var(--c-accent-soft);
          box-shadow: inset 2px 0 0 var(--c-accent);
        }
      }
    }
    .mission {
      font-size: var(--t-sm);
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .swarm {
      --sc: var(--s-ready);
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      height: 2.25rem;
      padding: 0 0.3rem 0 var(--sp-3);
      border: 1px solid color-mix(in srgb, var(--sc) 45%, var(--c-line));
      border-radius: var(--r-2);
      background: color-mix(in srgb, var(--sc) 9%, var(--c-graphite));
      transition: border-color var(--m-slow) var(--ease), background var(--m-slow) var(--ease);
    }
    .swarm[data-mode='ACTIVE'] {
      --sc: var(--s-active);
    }
    .swarm-label {
      color: var(--c-text-3);
    }
    .swarm-state {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 6.2rem;
    }
    .swarm-dot {
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      box-shadow: inset 0 0 0 2px var(--sc);
    }
    .swarm[data-mode='ACTIVE'] .swarm-dot {
      background: var(--sc);
      animation: beat 2.4s var(--ease) infinite;
    }
    .swarm-value {
      font-size: var(--t-xl);
      font-weight: 600;
      letter-spacing: 0.12em;
      color: var(--sc);
    }
    .swarm-toggle {
      height: 1.75rem;
      padding: 0 0.7rem;
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-1);
      background: var(--c-raised);
      color: var(--c-text-2);
      font-size: var(--t-micro);
      font-weight: 600;
      letter-spacing: 0.08em;
      cursor: pointer;
      transition: background var(--m-fast), color var(--m-fast), border-color var(--m-fast);
      &:hover {
        color: var(--c-text-1);
        border-color: var(--c-text-3);
      }
    }
    @keyframes beat {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.45;
      }
    }

    .kpis {
      display: flex;
      justify-self: end;
      margin: 0;
      gap: 0;
    }
    .kpi {
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 0 var(--sp-4);
      border-left: 1px solid var(--c-line);
      line-height: 1.15;
      dt {
        color: var(--c-text-3);
      }
      dd {
        margin: 0;
        font-size: var(--t-lg);
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 0.3rem;
        white-space: nowrap;
        small {
          color: var(--c-text-3);
          font-size: var(--t-xs);
        }
      }
    }
    .kpi.warn dd {
      color: var(--s-warning);
    }
    button.kpi {
      border: 0;
      border-left: 1px solid var(--c-line);
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      &:hover dd {
        filter: brightness(1.2);
      }
    }
    .bell {
      position: relative;
      .badge {
        position: absolute;
        top: 0.15rem;
        right: 0.1rem;
        min-width: 1rem;
        height: 1rem;
        padding: 0 0.2rem;
        border-radius: 0.5rem;
        background: var(--s-warning);
        color: var(--c-text-inv);
        font-size: 0.5625rem;
        font-weight: 600;
        line-height: 1rem;
        text-align: center;
      }
      &.crit .badge {
        background: var(--s-critical);
        color: #fff;
      }
    }
    .kpi.system dd {
      font-size: var(--t-sm);
      font-weight: 600;
      letter-spacing: 0.06em;
      color: var(--s-active);
    }
    .kpi.system[data-level='DEGRADED'] dd {
      color: var(--s-warning);
    }
    .kpi.system[data-level='CRITICAL'] dd {
      color: var(--s-critical);
    }
    .right {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      padding-left: var(--sp-4);
      border-left: 1px solid var(--c-line);
      margin-left: var(--sp-2);
    }
    .role-wrap {
      position: relative;
    }
    .role {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      line-height: 1.15;
      padding: 0.15rem 0.45rem;
      border: 1px solid var(--c-line);
      border-radius: var(--r-2);
      background: var(--c-raised);
      cursor: pointer;
      .rname {
        font-size: var(--t-xs);
        font-weight: 600;
        letter-spacing: 0.04em;
      }
    }
    .menu.right {
      left: auto;
      right: 0;
      width: 17rem;
    }
    .clock {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      line-height: 1.15;
      .time {
        font-size: var(--t-sm);
      }
      .elapsed {
        font-size: var(--t-micro);
        color: var(--c-text-3);
      }
    }
    .icon-btn {
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border: 0;
      border-radius: var(--r-2);
      background: transparent;
      color: var(--c-text-2);
      cursor: pointer;
      &:hover {
        background: var(--c-raised);
        color: var(--c-text-1);
      }
    }
    @media (max-width: 1200px) {
      .swarm-label,
      .org {
        display: none;
      }
      .swarm-state {
        min-width: 5.2rem;
      }
      .kpi {
        padding: 0 0.55rem !important;
      }
    }
    @media (max-width: 1100px) {
      .kpi:nth-child(3),
      .clock .elapsed {
        display: none;
      }
      .swarm-value {
        font-size: var(--t-lg);
      }
      .role .caps {
        display: none;
      }
    }
    @media (max-width: 1360px) {
      .scenario {
        display: none;
      }
      .sep {
        display: none;
      }
      .kpi {
        padding: 0 var(--sp-3);
      }
    }
  `,
})
export class CommandBar {
  private readonly store = inject(OpsStore);
  protected readonly sim = inject(SimHost);
  private readonly mapSvc = inject(MapService);
  protected readonly scenarios = SCENARIOS;
  protected readonly menu = signal(false);

  protected readonly roles = inject(RoleService);
  protected readonly roleList = ROLES;
  protected readonly roleMenu = signal(false);
  protected readonly roleLabel = computed(() => ROLES.find((r) => r.id === this.roles.role())?.label ?? '');

  protected setRole(r: Role): void {
    this.roles.role.set(r);
    this.roleMenu.set(false);
  }

  protected switchScenario(id: string): void {
    this.menu.set(false);
    if (id === this.sim.scenarioId()) return;
    this.sim.start(id, this.sim.fleetSize());
    this.mapSvc.flyToView(this.sim.engine.scenario.view);
  }
  protected readonly icons = { Bell, ShieldCheck, TriangleAlert };
  protected readonly swarm = this.store.swarmMode;
  private readonly missions = inject(MissionStore);
  protected readonly alerts = inject(AlertStore);
  protected readonly health = this.alerts.health;
  protected readonly k = computed(() => ({ ...this.store.kpis(), missionPct: this.missions.progressPct() }));
  protected readonly toggleLabel = computed(() =>
    this.swarm() === 'ACTIVE' ? 'STAND DOWN' : this.missions.current()?.mission.status === 'PLANNED' ? 'START MISSION' : 'ACTIVATE',
  );
  protected readonly scenarioName = computed(() => {
    this.sim.generation();
    return this.sim.engine.scenario.name;
  });
  protected readonly missionName = computed(() => {
    this.sim.generation();
    return this.sim.engine.scenario.missionName;
  });
  protected readonly clock = computed(() => {
    this.sim.uiTick();
    return `${tickClock(this.sim.startedAtMs, this.sim.engine.tick)} GST`;
  });
  protected readonly elapsed = computed(() => {
    this.sim.uiTick();
    return missionElapsed(this.sim.engine.tick);
  });

  protected toggleCenter(): void {
    this.alerts.healthOpen.set(false);
    this.alerts.centerOpen.set(!this.alerts.centerOpen());
  }

  protected toggleHealth(): void {
    this.alerts.centerOpen.set(false);
    this.alerts.healthOpen.set(!this.alerts.healthOpen());
  }

  toggleSwarm(): void {
    if (this.swarm() === 'ACTIVE') {
      this.missions.abort();
      this.store.setSwarm('READY');
      return;
    }
    const cur = this.missions.current();
    if (cur?.mission.status === 'PLANNED') {
      this.missions.start();
      return;
    }
    // No plan yet: the operator states intent first.
    this.store.leftCollapsed.set(false);
    this.store.leftTab.set('MISSIONS');
    this.missions.builderOpen.set(true);
  }
}
