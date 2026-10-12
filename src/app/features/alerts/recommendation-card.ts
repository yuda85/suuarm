import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { displayState } from '../../core/domain/vehicle';
import { AlertStore } from '../../core/state/alert.store';
import { OpsStore } from '../../core/state/ops-store';
import { SimHost } from '../../core/state/sim-host.service';
import { MapService } from '../../map/map.service';
import { Icon } from '../../shared/ui/icon';
import { ArrowUpRight, Check, Crosshair, X } from '../../shared/ui/icons';
import { StatusChip } from '../../shared/ui/status-chip';

/**
 * Supervised autonomy: SuuarmOS proposes, the operator decides. One clear action, the reasoning
 * behind it, and approve / reject — nothing else competes for attention.
 */
@Component({
  selector: 'app-recommendation-card',
  imports: [Icon, StatusChip, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.on]': '!!rec()', role: 'region', 'aria-label': 'Recommended action', '(window:keydown)': 'onKey($event)' },
  template: `
    @if (rec(); as r) {
      <div class="kicker caps">
        <span class="dot" aria-hidden="true"></span> Recommended action
        @if (more() > 0) {
          <span class="more">+{{ more() }} pending</span>
        }
        <span class="conf mono">confidence {{ r.confidence * 100 | number: '1.0-0' }}%</span>
      </div>
      <h3>{{ r.title }}</h3>
      @if (r.kind === 'RESPONSE_GROUP') {
        <div class="group">
          <span class="caps lbl">Response group</span>
          <div class="chips">
            @for (id of r.toIds; track id) {
              <button type="button" class="chip mono" (click)="focus(id)">{{ id }}</button>
            }
          </div>
        </div>
      } @else {
      <div class="swap">
        <button type="button" class="veh from" (click)="focus(r.fromId)">
          <span class="caps lbl">From</span>
          <span class="mono id">{{ r.fromId ?? '—' }}</span>
          @if (fromState(); as s) {
            <ui-status [state]="s" />
          }
        </button>
        <ui-icon class="arrow" [icon]="icons.ArrowUpRight" [size]="18" />
        <button type="button" class="veh to" (click)="focus(r.toIds[0])">
          <span class="caps lbl">To</span>
          <span class="mono id">{{ r.toIds[0] }}</span>
          @if (toState(); as s) {
            <ui-status [state]="s" />
          }
        </button>
      </div>
      }
      <ul class="why">
        @for (line of r.rationale; track line) {
          <li>{{ line }}</li>
        }
      </ul>
      @if (r.alternatives.length) {
        <div class="alt">Alternatives: <span class="mono">{{ r.alternatives.join(' · ') }}</span></div>
      }
      <div class="actions">
        <button type="button" class="btn ghost" (click)="alerts.reject(r)"><ui-icon [icon]="icons.X" [size]="14" /> Reject</button>
        <button type="button" class="btn primary" (click)="alerts.approve(r)"><ui-icon [icon]="icons.Check" [size]="14" /> Approve</button>
      </div>
      <div class="hint caps">Supervised autonomy · Enter approve · Backspace reject</div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      top: calc(var(--inset) + 0.25rem);
      left: 50%;
      z-index: var(--z-popover);
      width: 27rem;
      transform: translate(-50%, -12px);
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--m-base) var(--ease), transform var(--m-base) var(--ease);
    }
    :host(.on) {
      transform: translate(-50%, 0);
      opacity: 1;
      pointer-events: auto;
      padding: var(--sp-3) var(--sp-4) var(--sp-3);
      border: 1px solid color-mix(in srgb, var(--s-warning) 45%, var(--c-line));
      border-left: 3px solid var(--s-warning);
      border-radius: var(--r-3);
      background: var(--c-panel-solid);
      box-shadow: var(--shadow-pop);
    }
    .kicker {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      color: var(--s-warning);
      font-size: 0.625rem;
      .dot {
        width: 0.45rem;
        height: 0.45rem;
        border-radius: 50%;
        background: var(--s-warning);
        animation: pulse 1.6s var(--ease) infinite;
      }
      .more {
        color: var(--c-text-3);
      }
      .conf {
        margin-left: auto;
        color: var(--c-text-3);
        text-transform: none;
        letter-spacing: 0;
      }
    }
    @keyframes pulse {
      50% {
        opacity: 0.35;
      }
    }
    h3 {
      margin: 0.3rem 0 var(--sp-3);
      font-size: var(--t-lg);
      font-weight: 500;
    }
    .swap {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: var(--sp-2);
      .arrow {
        color: var(--c-text-3);
        transform: rotate(45deg);
      }
    }
    .veh {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
      column-gap: 0.4rem;
      align-items: center;
      padding: 0.45rem 0.6rem;
      border: 1px solid var(--c-line);
      border-radius: var(--r-2);
      background: var(--c-raised);
      text-align: left;
      cursor: pointer;
      .lbl {
        grid-column: 1 / -1;
        color: var(--c-text-3);
        font-size: 0.5625rem;
      }
      .id {
        font-size: var(--t-md);
        white-space: nowrap;
      }
      ui-status {
        justify-self: end;
      }
      &.to {
        border-color: var(--c-accent-line);
      }
    }
    .group {
      .lbl {
        color: var(--c-text-3);
        font-size: 0.5625rem;
      }
      .chips {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
        margin-top: 0.3rem;
      }
      .chip {
        height: 1.9rem;
        border: 1px solid var(--c-accent-line);
        border-radius: var(--r-2);
        background: var(--c-accent-soft);
        color: var(--c-text-1);
        font-size: var(--t-sm);
        cursor: pointer;
      }
    }
    .why {
      margin: var(--sp-3) 0 0;
      padding: 0 0 0 1rem;
      color: var(--c-text-2);
      font-size: var(--t-xs);
      line-height: 1.55;
    }
    .alt {
      margin-top: 0.3rem;
      color: var(--c-text-3);
      font-size: 0.6875rem;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1.6fr;
      gap: var(--sp-2);
      margin-top: var(--sp-3);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      height: 2.3rem;
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-2);
      background: none;
      color: var(--c-text-1);
      font-size: var(--t-xs);
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      &:hover {
        border-color: var(--c-text-3);
      }
      &.primary {
        background: var(--c-accent);
        border-color: var(--c-accent);
        color: #fff;
        &:hover {
          background: var(--c-accent-strong);
        }
      }
    }
    .hint {
      margin-top: 0.45rem;
      color: var(--c-text-3);
      font-size: 0.5625rem;
      text-align: center;
    }
  `,
})
export class RecommendationCard {
  protected readonly alerts = inject(AlertStore);
  private readonly ops = inject(OpsStore);
  private readonly sim = inject(SimHost);
  private readonly map = inject(MapService);
  protected readonly icons = { ArrowUpRight, Check, X, Crosshair };
  protected readonly rec = computed(() => this.alerts.pending()[0] ?? null);
  protected readonly more = computed(() => Math.max(0, this.alerts.pending().length - 1));
  protected readonly fromState = computed(() => {
    this.sim.uiTick();
    const id = this.rec()?.fromId;
    const v = id ? this.sim.engine.byId.get(id) : undefined;
    return v ? displayState(v) : null;
  });
  protected readonly toState = computed(() => {
    this.sim.uiTick();
    const id = this.rec()?.toIds[0];
    const v = id ? this.sim.engine.byId.get(id) : undefined;
    return v ? displayState(v) : null;
  });

  protected focus(id: string | null): void {
    if (!id) return;
    const t = this.sim.engine.response.trackOf(id);
    if (t) {
      this.ops.selectTrack(id);
      this.map.flyToLocal(t.pos.x, t.pos.y);
      return;
    }
    this.ops.select(id);
    this.map.focusVehicle(id);
  }

  protected onKey(e: KeyboardEvent): void {
    const r = this.rec();
    const tag = (e.target as HTMLElement)?.tagName;
    if (!r || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || this.map.drawing()) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.alerts.approve(r);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      this.alerts.reject(r);
    }
  }
}
