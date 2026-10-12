import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { OperationalEvent } from '../../core/domain/ops';
import { tickClock } from '../../core/state/clock';
import { EventFeedStore } from '../../core/state/event-feed.store';
import { OpsStore } from '../../core/state/ops-store';
import { SimHost } from '../../core/state/sim-host.service';
import { MapService } from '../../map/map.service';
import { Icon } from '../../shared/ui/icon';
import { Activity, ChevronDown } from '../../shared/ui/icons';

/** Compact live event stream. Not a timeline — no playback, newest first. */
@Component({
  selector: 'app-event-strip',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="toggle" (click)="open.set(!open())" [attr.aria-expanded]="open()" aria-controls="event-log">
      <ui-icon [icon]="icons.Activity" [size]="14" />
      <span class="caps">Live</span>
      <ui-icon class="chev" [class.up]="!open()" [icon]="icons.ChevronDown" [size]="14" />
    </button>
    <ol id="event-log" class="log" [class.open]="open()" aria-live="polite" aria-label="Operational events">
      @for (e of visible(); track e.id) {
        <li [attr.data-sev]="e.severity" (click)="focus(e)" [class.clickable]="!!e.focus">
          <span class="t mono">{{ time(e) }}</span>
          <span class="sev" aria-hidden="true"></span>
          <span class="txt">{{ e.text }}</span>
        </li>
      }
    </ol>
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-end;
      min-width: 0;
      background: var(--c-panel);
      border: 1px solid var(--c-line);
      border-radius: var(--r-2);
      overflow: hidden;
      pointer-events: auto;
    }
    .toggle {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      height: calc(var(--feed-h) - 2px);
      padding: 0 var(--sp-3);
      border: 0;
      border-right: 1px solid var(--c-line);
      background: none;
      color: var(--s-active);
      cursor: pointer;
      flex: none;
      .caps {
        color: var(--c-text-2);
      }
      .chev {
        color: var(--c-text-3);
        transition: transform var(--m-base) var(--ease);
      }
      .chev.up {
        transform: rotate(180deg);
      }
    }
    .log {
      flex: 1;
      min-width: 0;
      margin: 0;
      padding: 0;
      list-style: none;
      max-height: calc(var(--feed-h) - 2px);
      overflow: hidden;
      transition: max-height var(--m-slow) var(--ease);
      &.open {
        max-height: 11rem;
        overflow-y: auto;
      }
    }
    li {
      --c: var(--s-info);
      display: grid;
      grid-template-columns: 4.2rem 0.5rem 1fr;
      align-items: center;
      gap: var(--sp-2);
      height: calc(var(--feed-h) - 2px);
      padding: 0 var(--sp-3);
      font-size: var(--t-xs);
      color: var(--c-text-2);
      border-bottom: 1px solid var(--c-line-soft);
      &.clickable {
        cursor: pointer;
        &:hover {
          background: var(--c-raised);
          color: var(--c-text-1);
        }
      }
      &:first-child {
        color: var(--c-text-1);
        animation: arrive var(--m-slow) var(--ease-out);
      }
    }
    li[data-sev='WARNING'] { --c: var(--s-warning); }
    li[data-sev='CRITICAL'] { --c: var(--s-critical); }
    .t {
      color: var(--c-text-3);
    }
    .sev {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--c);
    }
    .txt {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @keyframes arrive {
      from {
        background: color-mix(in srgb, var(--c-accent) 12%, transparent);
      }
    }
  `,
})
export class EventStrip {
  private readonly feed = inject(EventFeedStore);
  private readonly sim = inject(SimHost);
  private readonly store = inject(OpsStore);
  private readonly map = inject(MapService);
  protected readonly icons = { Activity, ChevronDown };
  protected readonly open = signal(false);
  protected readonly visible = computed(() => this.feed.events().slice(0, this.open() ? 60 : 1));

  protected time(e: OperationalEvent): string {
    return tickClock(this.sim.startedAtMs, e.tick);
  }

  protected focus(e: OperationalEvent): void {
    if (e.focus?.kind === 'vehicle' && e.focus.id) {
      this.store.select(e.focus.id);
      this.map.focusVehicle(e.focus.id);
    } else if (e.focus?.kind === 'track' && e.focus.id) {
      this.store.selectTrack(e.focus.id);
      const t = this.sim.engine.response.trackOf(e.focus.id);
      if (t) this.map.flyToLocal(t.pos.x, t.pos.y);
    }
  }
}
