import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AlertStore } from '../../core/state/alert.store';

/** Compact system health breakdown (popover from the SYSTEM indicator). */
@Component({
  selector: 'app-system-health',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (alerts.healthOpen()) {
      <section class="pop" role="dialog" aria-label="System health" [attr.data-level]="h().level">
        <header>
          <span class="caps">System</span>
          <b>{{ h().level }}</b>
        </header>
        <dl>
          <div><dt>SuuarmOS Core</dt><dd [attr.data-s]="h().core">{{ h().core }}</dd></div>
          <div><dt>Fleet Network</dt><dd [attr.data-s]="h().network">{{ h().network }}</dd></div>
          <div><dt>Edge Nodes</dt><dd class="mono" [attr.data-s]="h().edgeOnline < h().edgeTotal ? 'DEGRADED' : 'ONLINE'">{{ h().edgeOnline }}/{{ h().edgeTotal }}</dd></div>
          <div><dt>Sensor Services</dt><dd [attr.data-s]="h().sensorServices">{{ h().sensorServices }}</dd></div>
          <div><dt>Map Services</dt><dd [attr.data-s]="h().mapServices">{{ h().mapServices }}</dd></div>
          <div><dt>Autonomy</dt><dd>{{ alerts.autonomy() === 'AUTONOMOUS' ? 'AUTONOMOUS' : 'SUPERVISED' }}</dd></div>
        </dl>
        <div class="seg" role="radiogroup" aria-label="Autonomy level">
          <button type="button" role="radio" [attr.aria-checked]="alerts.autonomy() === 'SUPERVISED'" (click)="alerts.setAutonomy('SUPERVISED')">Supervised</button>
          <button type="button" role="radio" [attr.aria-checked]="alerts.autonomy() === 'AUTONOMOUS'" (click)="alerts.setAutonomy('AUTONOMOUS')">Autonomous</button>
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      position: absolute;
      top: var(--inset);
      right: calc(var(--inset) + 9rem);
      z-index: var(--z-popover);
    }
    .pop {
      --c: var(--s-active);
      width: 17rem;
      padding: var(--sp-3) var(--sp-4);
      border: 1px solid var(--c-line-strong);
      border-top: 2px solid var(--c);
      border-radius: var(--r-3);
      background: var(--c-panel-solid);
      box-shadow: var(--shadow-pop);
      animation: drop var(--m-base) var(--ease-out);
    }
    .pop[data-level='DEGRADED'] { --c: var(--s-warning); }
    .pop[data-level='CRITICAL'] { --c: var(--s-critical); }
    @keyframes drop {
      from {
        transform: translateY(-6px);
        opacity: 0;
      }
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: var(--sp-2);
      .caps {
        color: var(--c-text-3);
      }
      b {
        color: var(--c);
        letter-spacing: 0.08em;
      }
    }
    dl {
      margin: 0;
      div {
        display: flex;
        justify-content: space-between;
        padding: 0.3rem 0;
        border-bottom: 1px solid var(--c-line-soft);
        font-size: var(--t-xs);
      }
      dt {
        color: var(--c-text-2);
      }
      dd {
        margin: 0;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: var(--s-active);
        &[data-s='DEGRADED'],
        &[data-s='FALLBACK'] {
          color: var(--s-warning);
        }
      }
    }
    .seg {
      display: flex;
      margin-top: var(--sp-3);
      border: 1px solid var(--c-line);
      border-radius: var(--r-2);
      overflow: hidden;
      button {
        flex: 1;
        height: 1.75rem;
        border: 0;
        background: none;
        color: var(--c-text-2);
        font-size: 0.6875rem;
        font-weight: 600;
        cursor: pointer;
        &[aria-checked='true'] {
          background: var(--c-accent-soft);
          color: var(--c-accent-strong);
        }
      }
    }
  `,
})
export class SystemHealthPopover {
  protected readonly alerts = inject(AlertStore);
  protected readonly h = this.alerts.health;
}
