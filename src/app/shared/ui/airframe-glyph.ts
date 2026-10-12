import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AirframeClass, VehicleCapability, CAPABILITY_CODE } from '../../core/domain/vehicle';

/** Vehicle silhouette + capability badge: class reads by shape, not colour. */
@Component({
  selector: 'ui-airframe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="-20 -20 40 40" [attr.width]="size()" [attr.height]="size()" aria-hidden="true">
      @switch (cls()) {
        @case ('QUAD') {
          <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
            <line x1="-10" y1="-10" x2="10" y2="10" /><line x1="10" y1="-10" x2="-10" y2="10" />
          </g>
          <g fill="none" stroke="currentColor" stroke-width="1.6">
            <circle cx="-11" cy="-11" r="6" /><circle cx="11" cy="-11" r="6" /><circle cx="11" cy="11" r="6" /><circle cx="-11" cy="11" r="6" />
          </g>
          <path d="M0 -7 L4 -2 L4 5 L-4 5 L-4 -2 Z" fill="currentColor" />
        }
        @case ('VTOL') {
          <path d="M0 -17 Q3 -12 3 -4 L2 13 L-2 13 L-3 -4 Q-3 -12 0 -17 Z" fill="currentColor" />
          <path d="M-18 -3 L18 -3 L17 2 L-17 2 Z" fill="currentColor" />
          <g stroke="currentColor" stroke-width="1.4"><line x1="-7" y1="-9" x2="-7" y2="14" /><line x1="7" y1="-9" x2="7" y2="14" /></g>
          <rect x="-9" y="13" width="18" height="2.4" fill="currentColor" />
        }
        @default {
          <g stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="0" y1="0" x2="0" y2="-14" /><line x1="0" y1="0" x2="12" y2="-7" /><line x1="0" y1="0" x2="12" y2="7" />
            <line x1="0" y1="0" x2="0" y2="14" /><line x1="0" y1="0" x2="-12" y2="7" /><line x1="0" y1="0" x2="-12" y2="-7" />
          </g>
          <g fill="none" stroke="currentColor" stroke-width="1.4">
            <circle cx="0" cy="-14" r="4.2" /><circle cx="12" cy="-7" r="4.2" /><circle cx="12" cy="7" r="4.2" />
            <circle cx="0" cy="14" r="4.2" /><circle cx="-12" cy="7" r="4.2" /><circle cx="-12" cy="-7" r="4.2" />
          </g>
          <circle r="5" fill="currentColor" />
          @if (cls() === 'RELAY') {
            <circle r="2" fill="var(--c-panel-solid)" />
          }
        }
      }
    </svg>
    @if (capability(); as cap) {
      <span class="badge">{{ code[cap] }}</span>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-grid;
      place-items: center;
      color: var(--c-text-2);
    }
    .badge {
      position: absolute;
      right: -0.35rem;
      bottom: -0.25rem;
      padding: 0 0.18rem;
      border-radius: 2px;
      background: var(--c-raised-2);
      box-shadow: 0 0 0 1px var(--c-line-strong);
      color: var(--c-text-1);
      font: 600 0.5rem/0.78rem var(--f-mono);
      letter-spacing: 0.02em;
    }
  `,
})
export class AirframeGlyph {
  readonly cls = input.required<AirframeClass>();
  readonly capability = input<VehicleCapability | null>(null);
  readonly size = input(22);
  protected readonly code = CAPABILITY_CODE;
}
