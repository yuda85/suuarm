import { ChangeDetectionStrategy, Component } from '@angular/core';

/** SUUARM mark: three nodes in formation forming a chevron — a coordinated swarm, pointed forward. */
@Component({
  selector: 'ui-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 32 32" width="26" height="26" role="img" aria-label="SUUARM Systems">
      <path d="M5 23 L16 9 L27 23" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" opacity="0.55" />
      <path d="M10 26 L16 18.5 L22 26" fill="none" stroke="var(--c-accent)" stroke-width="2.2" stroke-linejoin="round" />
      <circle cx="16" cy="9" r="3" fill="currentColor" />
      <circle cx="5" cy="23" r="2.4" fill="currentColor" />
      <circle cx="27" cy="23" r="2.4" fill="currentColor" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      color: var(--c-text-1);
    }
  `,
})
export class Logo {}
