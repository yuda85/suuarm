import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Alert, Severity } from '../../core/domain/ops';
import { AlertStore } from '../../core/state/alert.store';
import { tickClock } from '../../core/state/clock';
import { OpsStore } from '../../core/state/ops-store';
import { SimHost } from '../../core/state/sim-host.service';
import { MapService } from '../../map/map.service';
import { Icon } from '../../shared/ui/icon';
import { CircleX, Info, TriangleAlert, X } from '../../shared/ui/icons';

/** Alert center popover + transient toasts. Clicking an alert focuses its object on the map. */
@Component({
  selector: 'app-alert-center',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (alerts.centerOpen()) {
      <section class="center" role="dialog" aria-label="Alert center">
        <header>
          <h2 class="caps">Alerts</h2>
          <div class="filters" role="radiogroup" aria-label="Severity filter">
            @for (f of filters; track f) {
              <button type="button" role="radio" [attr.aria-checked]="filter() === f" (click)="filter.set(f)">{{ f }}</button>
            }
          </div>
          <button type="button" class="link" (click)="alerts.ackAll()">Acknowledge all</button>
          <button type="button" class="x" (click)="alerts.centerOpen.set(false)" aria-label="Close alerts"><ui-icon [icon]="icons.X" [size]="14" /></button>
        </header>
        <ol class="list">
          @for (a of list(); track a.id) {
            <li [attr.data-sev]="a.severity" [class.acked]="a.acknowledged">
              <button type="button" class="row" (click)="focus(a)">
                <ui-icon class="sev" [icon]="iconFor(a.severity)" [size]="15" />
                <span class="title">{{ a.title }}</span>
                <span class="t mono">{{ time(a) }}</span>
                <span class="detail">{{ a.detail }}</span>
              </button>
              @if (!a.acknowledged) {
                <button type="button" class="ack caps" (click)="alerts.ack(a)">Ack</button>
              }
            </li>
          } @empty {
            <li class="empty">No alerts</li>
          }
        </ol>
      </section>
    }
    <div class="toasts" aria-live="assertive">
      @for (a of alerts.toasts(); track a.id) {
        <button type="button" class="toast" [attr.data-sev]="a.severity" (click)="focus(a)">
          <ui-icon class="sev" [icon]="iconFor(a.severity)" [size]="16" />
          <span class="title">{{ a.title }}</span>
          <span class="detail">{{ a.detail }}</span>
          <span class="close" (click)="alerts.dismissToast(a.id); $event.stopPropagation()" aria-label="Dismiss"><ui-icon [icon]="icons.X" [size]="12" /></span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: var(--z-toast);
    }
    .center {
      position: absolute;
      top: var(--inset);
      right: calc(var(--inset) + 4rem);
      width: 26rem;
      max-height: min(36rem, calc(100% - 4rem));
      display: flex;
      flex-direction: column;
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-3);
      background: var(--c-panel-solid);
      box-shadow: var(--shadow-pop);
      pointer-events: auto;
      animation: drop var(--m-base) var(--ease-out);
    }
    @keyframes drop {
      from {
        transform: translateY(-6px);
        opacity: 0;
      }
    }
    header {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4);
      border-bottom: 1px solid var(--c-line);
      h2 {
        margin: 0;
        color: var(--c-text-2);
      }
    }
    .filters {
      display: flex;
      gap: 2px;
      button {
        height: 1.5rem;
        padding: 0 0.45rem;
        border: 0;
        border-radius: var(--r-1);
        background: none;
        color: var(--c-text-3);
        font-size: 0.625rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        cursor: pointer;
        &[aria-checked='true'] {
          background: var(--c-raised-2);
          color: var(--c-text-1);
        }
      }
    }
    .link {
      margin-left: auto;
      border: 0;
      background: none;
      color: var(--c-accent-strong);
      font-size: 0.6875rem;
      cursor: pointer;
    }
    .x {
      display: grid;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      border: 0;
      background: none;
      color: var(--c-text-3);
      cursor: pointer;
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      li {
        --c: var(--s-info);
        position: relative;
        border-bottom: 1px solid var(--c-line-soft);
        &.acked {
          opacity: 0.55;
        }
      }
      li[data-sev='WARNING'] { --c: var(--s-warning); }
      li[data-sev='CRITICAL'] { --c: var(--s-critical); }
      .empty {
        padding: var(--sp-6);
        text-align: center;
        color: var(--c-text-3);
      }
    }
    .row {
      display: grid;
      grid-template-columns: 1.3rem 1fr auto;
      column-gap: var(--sp-2);
      width: 100%;
      padding: 0.55rem var(--sp-4) 0.55rem var(--sp-3);
      border: 0;
      background: none;
      text-align: left;
      cursor: pointer;
      &:hover {
        background: var(--c-raised);
      }
      .sev {
        color: var(--c);
        grid-row: span 2;
        padding-top: 1px;
      }
      .title {
        font-size: var(--t-sm);
        font-weight: 500;
      }
      .t {
        font-size: 0.6875rem;
        color: var(--c-text-3);
      }
      .detail {
        grid-column: 2 / -1;
        font-size: var(--t-xs);
        color: var(--c-text-3);
      }
    }
    .ack {
      position: absolute;
      right: var(--sp-3);
      bottom: 0.5rem;
      height: 1.3rem;
      padding: 0 0.45rem;
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-1);
      background: var(--c-raised);
      color: var(--c-text-2);
      font-size: 0.5625rem;
      cursor: pointer;
    }
    .toasts {
      position: absolute;
      right: calc(var(--inset) + 0.25rem);
      bottom: calc(var(--feed-h) + var(--inset) * 3);
      display: flex;
      flex-direction: column-reverse;
      gap: var(--sp-2);
      width: 21rem;
    }
    :host-context(.right-open) .toasts {
      right: calc(var(--panel-r-w) + var(--inset) * 2);
    }
    .toast {
      --c: var(--s-info);
      position: relative;
      display: grid;
      grid-template-columns: 1.4rem 1fr;
      column-gap: var(--sp-2);
      padding: 0.6rem 2rem 0.6rem 0.75rem;
      border: 1px solid color-mix(in srgb, var(--c) 45%, var(--c-line));
      border-left: 3px solid var(--c);
      border-radius: var(--r-2);
      background: var(--c-panel-solid);
      box-shadow: var(--shadow-pop);
      text-align: left;
      pointer-events: auto;
      cursor: pointer;
      animation: slide-in var(--m-slow) var(--ease-out);
      .sev {
        color: var(--c);
        grid-row: span 2;
      }
      .title {
        font-size: var(--t-sm);
        font-weight: 600;
      }
      .detail {
        font-size: var(--t-xs);
        color: var(--c-text-2);
      }
      .close {
        position: absolute;
        right: 0.4rem;
        top: 0.4rem;
        color: var(--c-text-3);
      }
    }
    .toast[data-sev='WARNING'] { --c: var(--s-warning); }
    .toast[data-sev='CRITICAL'] { --c: var(--s-critical); }
    @keyframes slide-in {
      from {
        transform: translateX(16px);
        opacity: 0;
      }
    }
  `,
})
export class AlertCenter {
  protected readonly alerts = inject(AlertStore);
  private readonly ops = inject(OpsStore);
  private readonly sim = inject(SimHost);
  private readonly map = inject(MapService);
  protected readonly icons = { X, TriangleAlert, CircleX, Info };
  protected readonly filters = ['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const;
  protected readonly filter = signal<(typeof this.filters)[number]>('ALL');
  protected readonly list = computed(() => {
    const f = this.filter();
    return this.alerts.alerts().filter((a) => f === 'ALL' || a.severity === f).slice(0, 80);
  });

  protected iconFor(s: Severity) {
    return s === 'CRITICAL' ? CircleX : s === 'WARNING' ? TriangleAlert : Info;
  }

  protected time(a: Alert): string {
    return tickClock(this.sim.startedAtMs, a.tick);
  }

  protected focus(a: Alert): void {
    this.alerts.ack(a);
    const f = a.focus;
    if (f?.kind === 'vehicle' && f.id) {
      this.ops.select(f.id);
      this.map.focusVehicle(f.id);
    } else if (f?.kind === 'track' && f.id) {
      this.ops.selectTrack(f.id);
      const t = this.sim.engine.response.trackOf(f.id);
      if (t) this.map.flyToLocal(t.pos.x, t.pos.y);
    } else if ((f?.kind === 'sector' || f?.kind === 'mission') && f.id) {
      const eng = this.sim.engine;
      const s = eng.missions.sectors.get(f.id);
      const m = eng.missions.missions.find((x) => x.id === (s?.missionId ?? f.id));
      if (m) this.map.fitRing(m.intent.area);
    }
  }
}
