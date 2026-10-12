import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { VehicleState } from '../../core/domain/vehicle';

/** Status always = shape glyph + label + colour (never colour alone). */
@Component({
  selector: 'ui-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="glyph" [attr.data-s]="state()"></span>
    @if (!compact()) {
      <span class="label">{{ state() }}</span>
    }
  `,
  host: { '[attr.data-s]': 'state()', '[class.compact]': 'compact()', '[attr.title]': 'state()', role: 'status' },
  styles: `
    :host {
      --c: var(--s-ready);
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      height: 1.25rem;
      padding: 0 0.4rem 0 0.35rem;
      border-radius: var(--r-1);
      background: color-mix(in srgb, var(--c) 13%, transparent);
      color: var(--c);
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      white-space: nowrap;
    }
    :host(.compact) {
      padding: 0;
      background: none;
      height: auto;
    }
    :host([data-s='ACTIVE']) { --c: var(--s-active); }
    :host([data-s='HOLD']) { --c: var(--s-hold); }
    :host([data-s='RETURNING']) { --c: var(--s-returning); }
    :host([data-s='WARNING']) { --c: var(--s-warning); }
    :host([data-s='OFFLINE']) { --c: var(--s-offline); }
    .glyph {
      width: 0.5rem;
      height: 0.5rem;
      flex: none;
      background: var(--c);
      border-radius: 50%;
    }
    .glyph[data-s='READY'] { background: transparent; box-shadow: inset 0 0 0 1.5px var(--c); }
    .glyph[data-s='HOLD'] { border-radius: 1px; width: 0.45rem; }
    .glyph[data-s='RETURNING'] { border-radius: 0; clip-path: polygon(50% 100%, 0 0, 100% 0); }
    .glyph[data-s='WARNING'] { border-radius: 0; clip-path: polygon(50% 0, 100% 100%, 0 100%); width: 0.6rem; }
    .glyph[data-s='OFFLINE'] { border-radius: 0; background: var(--s-critical); clip-path: polygon(15% 0, 50% 35%, 85% 0, 100% 15%, 65% 50%, 100% 85%, 85% 100%, 50% 65%, 15% 100%, 0 85%, 35% 50%, 0 15%); }
  `,
})
export class StatusChip {
  readonly state = input.required<VehicleState>();
  readonly compact = input(false);
}

@Component({
  selector: 'ui-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="bar"><span class="fill" [style.transform]="'scaleX(' + clamped() + ')'"></span></span>`,
  host: { '[attr.data-level]': 'level()', role: 'meter', '[attr.aria-valuenow]': 'pct()', 'aria-valuemin': '0', 'aria-valuemax': '100' },
  styles: `
    :host {
      --c: var(--s-active);
      display: inline-flex;
      align-items: center;
      width: 100%;
    }
    :host([data-level='warn']) { --c: var(--s-warning); }
    :host([data-level='crit']) { --c: var(--s-critical); }
    .bar {
      position: relative;
      flex: 1;
      height: 4px;
      border-radius: 1px;
      background: var(--c-raised-2);
      overflow: hidden;
    }
    .fill {
      position: absolute;
      inset: 0;
      background: var(--c);
      transform-origin: left center;
      transition: transform var(--m-slow) var(--ease);
    }
  `,
})
export class Meter {
  readonly value = input.required<number>();
  readonly warnBelow = input(0.3);
  readonly critBelow = input(0.15);
  readonly clamped = computed(() => Math.min(1, Math.max(0, this.value())));
  readonly pct = computed(() => Math.round(this.clamped() * 100));
  readonly level = computed(() => (this.value() < this.critBelow() ? 'crit' : this.value() < this.warnBelow() ? 'warn' : 'ok'));
}
