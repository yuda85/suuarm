import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CAPABILITY_LABEL, VehicleCapability, VehicleState } from '../../core/domain/vehicle';
import { OpsStore } from '../../core/state/ops-store';

const ORDER: VehicleState[] = ['ACTIVE', 'READY', 'HOLD', 'RETURNING', 'WARNING', 'OFFLINE'];

/** Cluster hover summary: count, state mix, capability mix. Click on the cluster expands it. */
@Component({
  selector: 'app-cluster-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.transform]': 'pos()', '[class.on]': '!!c()', role: 'tooltip' },
  template: `
    @if (c(); as c) {
      <div class="head">
        <span class="mono n">{{ c.count }}</span>
        <span class="caps">UAVs</span>
      </div>
      <ul class="states">
        @for (s of rows(); track s.s) {
          <li [attr.data-s]="s.s"><i></i><span class="mono">{{ s.n }}</span><span>{{ s.s }}</span></li>
        }
      </ul>
      <div class="caps-row">
        @for (k of caps(); track k.k) {
          <span>{{ k.label }} <b class="mono">{{ k.n }}</b></span>
        }
      </div>
      <div class="hint caps">Click to expand</div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      left: 0;
      top: 0;
      z-index: var(--z-popover);
      min-width: 11rem;
      padding: var(--sp-2) var(--sp-3);
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-2);
      background: var(--c-panel-solid);
      box-shadow: var(--shadow-pop);
      pointer-events: none;
      opacity: 0;
      transition: opacity var(--m-fast);
    }
    :host(.on) {
      opacity: 1;
    }
    .head {
      display: flex;
      align-items: baseline;
      gap: 0.35rem;
      margin-bottom: 0.3rem;
      .n {
        font-size: var(--t-xl);
      }
      .caps {
        color: var(--c-text-3);
      }
    }
    .states {
      list-style: none;
      margin: 0;
      padding: 0;
      li {
        --c: var(--s-ready);
        display: grid;
        grid-template-columns: 0.7rem 2rem 1fr;
        align-items: center;
        font-size: var(--t-xs);
        line-height: 1.6;
        color: var(--c-text-2);
        i {
          width: 0.45rem;
          height: 0.45rem;
          border-radius: 50%;
          background: var(--c);
        }
        .mono {
          color: var(--c-text-1);
        }
      }
      li[data-s='ACTIVE'] { --c: var(--s-active); }
      li[data-s='HOLD'] { --c: var(--s-hold); }
      li[data-s='RETURNING'] { --c: var(--s-returning); }
      li[data-s='WARNING'] { --c: var(--s-warning); }
      li[data-s='OFFLINE'] { --c: var(--s-critical); }
    }
    .caps-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.2rem 0.6rem;
      margin-top: 0.4rem;
      padding-top: 0.4rem;
      border-top: 1px solid var(--c-line);
      font-size: 0.6875rem;
      color: var(--c-text-3);
      b {
        color: var(--c-text-2);
        font-weight: 500;
      }
    }
    .hint {
      margin-top: 0.35rem;
      color: var(--c-text-3);
      font-size: 0.5625rem;
    }
  `,
})
export class ClusterCard {
  private readonly store = inject(OpsStore);
  protected readonly c = this.store.hoveredCluster;
  protected readonly pos = computed(() => {
    const c = this.c();
    return c ? `translate(${c.x + 18}px, ${c.y - 20}px)` : 'translate(-9999px, 0)';
  });
  protected readonly rows = computed(() => {
    const c = this.c();
    return c ? ORDER.filter((s) => c.states[s] > 0).map((s) => ({ s, n: c.states[s] })) : [];
  });
  protected readonly caps = computed(() => {
    const c = this.c();
    if (!c) return [];
    return (Object.entries(c.caps) as [VehicleCapability, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ k, n, label: CAPABILITY_LABEL[k] }));
  });
}
