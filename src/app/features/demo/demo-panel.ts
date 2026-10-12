import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FLEET_SIZES, FleetSize } from '../../core/domain/scenario';
import { OpsStore } from '../../core/state/ops-store';
import { SimHost } from '../../core/state/sim-host.service';
import { MapService } from '../../map/map.service';
import { AlertStore } from '../../core/state/alert.store';
import { StoryService } from './story.service';
import { Icon } from '../../shared/ui/icon';
import { Presentation, X } from '../../shared/ui/icons';

/** Hidden presenter / developer panel (Ctrl+Shift+D). Drives the simulation for reliable demos. */
@Component({
  selector: 'app-demo-panel',
  imports: [Icon, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.open]': 'open()', '(window:keydown)': 'onKey($event)' },
  template: `
    @if (open()) {
      <section class="panel" role="dialog" aria-label="Presenter controls">
        <header>
          <ui-icon [icon]="icons.Presentation" [size]="15" />
          <h2 class="caps">Presenter</h2>
          <span class="mono fps">{{ fps() | number: '1.0-0' }} fps · {{ sim.engine.vehicles.length }} assets</span>
          <button type="button" class="x" (click)="open.set(false)" aria-label="Close presenter panel"><ui-icon [icon]="icons.X" [size]="14" /></button>
        </header>

        <div class="group">
          <span class="lbl caps">Swarm</span>
          <div class="row">
            <button type="button" [class.on]="store.swarmMode() === 'READY'" (click)="store.setSwarm('READY')">Set READY</button>
            <button type="button" [class.on]="store.swarmMode() === 'ACTIVE'" (click)="store.setSwarm('ACTIVE')">Set ACTIVE</button>
          </div>
        </div>

        <div class="group">
          <span class="lbl caps">Fleet size</span>
          <div class="row">
            @for (n of sizes; track n) {
              <button type="button" class="mono" [class.on]="sim.fleetSize() === n" (click)="setSize(n)">{{ n }}</button>
            }
          </div>
        </div>

        <div class="group">
          <span class="lbl caps">Sim rate</span>
          <div class="row">
            @for (s of speeds; track s) {
              <button type="button" class="mono" [class.on]="sim.speed() === s" (click)="sim.speed.set(s)">{{ s }}×</button>
            }
            <button type="button" [class.on]="sim.paused()" (click)="sim.paused.set(!sim.paused())">{{ sim.paused() ? 'Resume' : 'Pause' }}</button>
          </div>
        </div>

        <div class="group">
          <span class="lbl caps">Injects · {{ target() }}</span>
          <div class="row wrap">
            <button type="button" (click)="inject('FAIL_VEHICLE')">Vehicle failure</button>
            <button type="button" (click)="inject('LINK_LOST')">Link lost</button>
            <button type="button" (click)="inject('LOW_BATTERY')">Low battery</button>
            <button type="button" (click)="inject('PAYLOAD_FAIL')">Payload failure</button>
            <button type="button" (click)="inject('NAV_DEGRADED')">Nav degraded</button>
            <button type="button" (click)="sim.dispatch({ type: 'SPAWN_TRACK' })">Add track</button>
          </div>
        </div>

        <div class="group">
          <span class="lbl caps">Mission</span>
          <div class="row wrap">
            <button type="button" (click)="sim.dispatch({ type: 'COMPLETE_SECTOR' })">Complete sector</button>
            <button type="button" (click)="sim.dispatch({ type: 'COMPLETE_MISSION' })">Complete mission</button>
            <button type="button" [class.on]="alerts.autonomy() === 'AUTONOMOUS'" (click)="alerts.setAutonomy(alerts.autonomy() === 'AUTONOMOUS' ? 'SUPERVISED' : 'AUTONOMOUS')">
              Autonomous realloc
            </button>
          </div>
        </div>

        <div class="group">
          <span class="lbl caps">Map</span>
          <div class="row">
            <button type="button" [class.on]="store.clustering()" (click)="store.clustering.set(!store.clustering())">Clusters</button>
            <button type="button" [class.on]="store.trails()" (click)="store.trails.set(!store.trails())">Trails</button>
            <button type="button" (click)="map.zoomToFleet()">Zoom fleet</button>
          </div>
        </div>

        <div class="story">
          <div class="story-head">
            <span class="lbl caps">Story director · {{ story.index() + 1 }}/{{ story.steps.length }}</span>
            <button type="button" class="next" (click)="story.next()">{{ story.index() < 0 ? 'Start story' : 'Next step' }} ▸</button>
          </div>
          @if (story.index() >= 0) {
            <p class="say">{{ story.steps[story.index()].say }}</p>
          }
          <ol>
            @for (s of story.steps; track s.title; let i = $index) {
              <li [class.cur]="i === story.index()" [class.done]="i < story.index()">
                <button type="button" (click)="story.go(i)"><span class="mono n">{{ i + 1 }}</span>{{ s.title }}</button>
              </li>
            }
          </ol>
        </div>

        <footer>
          <button type="button" class="danger" (click)="sim.reset()">Reset scenario</button>
          <span class="caps hint">Ctrl + Shift + D</span>
        </footer>
      </section>
    }
  `,
  styles: `
    :host {
      position: absolute;
      left: 50%;
      bottom: 3.2rem;
      z-index: var(--z-demo);
      transform: translateX(-50%);
    }
    .panel {
      width: 30rem;
      padding: var(--sp-3);
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-3);
      background: var(--c-panel-solid);
      box-shadow: var(--shadow-pop);
      animation: rise var(--m-base) var(--ease-out);
    }
    @keyframes rise {
      from {
        transform: translateY(8px);
        opacity: 0;
      }
    }
    header {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      margin-bottom: var(--sp-2);
      color: var(--s-warning);
      h2 {
        margin: 0;
        color: var(--c-text-1);
      }
      .fps {
        margin-left: auto;
        font-size: var(--t-xs);
        color: var(--c-text-3);
      }
    }
    .x {
      display: grid;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      border: 0;
      border-radius: var(--r-1);
      background: none;
      color: var(--c-text-3);
      cursor: pointer;
    }
    .group {
      display: grid;
      grid-template-columns: 6.5rem 1fr;
      align-items: center;
      gap: var(--sp-2);
      padding: 0.35rem 0;
      border-top: 1px solid var(--c-line-soft);
    }
    .lbl {
      color: var(--c-text-3);
      font-size: 0.625rem;
    }
    .row {
      display: flex;
      gap: 4px;
      &.wrap {
        flex-wrap: wrap;
      }
      button {
        flex: 1 1 auto;
        height: 1.75rem;
        padding: 0 0.55rem;
        border: 1px solid var(--c-line);
        border-radius: var(--r-1);
        background: var(--c-raised);
        color: var(--c-text-2);
        font-size: 0.6875rem;
        cursor: pointer;
        white-space: nowrap;
        &:hover {
          color: var(--c-text-1);
          border-color: var(--c-line-strong);
        }
        &.on {
          border-color: var(--c-accent-line);
          background: var(--c-accent-soft);
          color: var(--c-accent-strong);
        }
      }
    }
    .story {
      padding-top: var(--sp-2);
      border-top: 1px solid var(--c-line-soft);
      .story-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .next {
        height: 1.75rem;
        padding: 0 0.8rem;
        border: 0;
        border-radius: var(--r-1);
        background: var(--c-accent);
        color: #fff;
        font-size: 0.6875rem;
        font-weight: 600;
        cursor: pointer;
      }
      .say {
        margin: 0.4rem 0 0;
        color: var(--s-active);
        font-size: var(--t-xs);
      }
      ol {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2px 6px;
        margin: var(--sp-2) 0;
        padding: 0;
        list-style: none;
        max-height: 13rem;
        overflow-y: auto;
      }
      li button {
        display: flex;
        gap: 0.4rem;
        width: 100%;
        padding: 0.2rem 0.3rem;
        border: 0;
        border-radius: var(--r-1);
        background: none;
        color: var(--c-text-3);
        font-size: 0.6875rem;
        text-align: left;
        cursor: pointer;
        &:hover {
          background: var(--c-raised);
          color: var(--c-text-1);
        }
      }
      li.done button {
        color: var(--c-text-2);
      }
      li.cur button {
        background: var(--c-accent-soft);
        color: var(--c-accent-strong);
      }
      .n {
        width: 1.1rem;
        color: inherit;
        opacity: 0.7;
      }
    }
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: var(--sp-2);
      border-top: 1px solid var(--c-line-soft);
      .hint {
        color: var(--c-text-3);
        font-size: 0.5625rem;
      }
    }
    .danger {
      height: 1.75rem;
      padding: 0 0.7rem;
      border: 1px solid color-mix(in srgb, var(--s-critical) 50%, transparent);
      border-radius: var(--r-1);
      background: var(--s-critical-soft);
      color: var(--s-critical);
      font-size: 0.6875rem;
      cursor: pointer;
    }
  `,
})
export class DemoPanel {
  protected readonly sim = inject(SimHost);
  protected readonly store = inject(OpsStore);
  protected readonly map = inject(MapService);
  protected readonly alerts = inject(AlertStore);
  protected readonly story = inject(StoryService);
  protected readonly icons = { Presentation, X };
  protected readonly sizes = FLEET_SIZES;
  protected readonly speeds = [1, 2, 4, 8];
  readonly open = signal(false);
  protected readonly fps = computed(() => {
    this.sim.uiTick();
    return this.map.loop?.fps ?? 0;
  });
  protected readonly target = computed(() => this.store.selectedId() ?? 'select an asset');

  protected onKey(e: KeyboardEvent): void {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      this.open.set(!this.open());
    } else if (this.open() && e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
      e.preventDefault();
      this.story.next();
    }
  }

  protected setSize(n: FleetSize): void {
    this.sim.setFleetSize(n);
    setTimeout(() => this.map.zoomToFleet(), 300);
  }

  protected inject(type: 'FAIL_VEHICLE' | 'LINK_LOST' | 'LOW_BATTERY' | 'PAYLOAD_FAIL' | 'NAV_DEGRADED'): void {
    const id = this.store.selectedId();
    if (id) this.sim.dispatch({ type, vehicleId: id });
  }
}
