import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MapService } from '../../map/map.service';
import { TOOLS } from './map-toolbar';

/** Inline guidance while a map tool is active (and confirmation for copied coordinates). */
@Component({
  selector: 'app-tool-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.on]': '!!text()', role: 'status', 'aria-live': 'polite' },
  template: `
    @if (map.lastCopied(); as c) {
      <span class="caps k">Copied</span><span class="mono">{{ c }}</span>
    } @else if (tool(); as t) {
      <span class="caps k">{{ t.label }}</span>
      <span>{{ t.hint }} · Backspace undo · Esc cancel</span>
      <button type="button" (click)="map.cancelDraw()">Cancel</button>
    } @else if (map.drawing()) {
      <span class="caps k">Draw area</span>
      <span>Click to add vertices · double-click or Enter to finish · Esc cancel</span>
      <button type="button" (click)="map.cancelDraw()">Cancel</button>
    }
  `,
  styles: `
    :host {
      position: absolute;
      left: 50%;
      bottom: calc(var(--feed-h) + var(--inset) * 2.5);
      z-index: var(--z-popover);
      display: none;
      align-items: center;
      gap: var(--sp-3);
      padding: 0.45rem 0.5rem 0.45rem 0.8rem;
      transform: translateX(-50%);
      border: 1px solid var(--c-accent-line);
      border-radius: var(--r-2);
      background: var(--c-panel-solid);
      box-shadow: var(--shadow-pop);
      font-size: var(--t-xs);
      color: var(--c-text-2);
      white-space: nowrap;
    }
    :host(.on) {
      display: flex;
    }
    .k {
      color: var(--c-accent-strong);
    }
    button {
      height: 1.6rem;
      padding: 0 0.6rem;
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-1);
      background: var(--c-raised);
      color: var(--c-text-1);
      font-size: 0.6875rem;
      cursor: pointer;
    }
  `,
})
export class ToolHint {
  protected readonly map = inject(MapService);
  protected readonly tool = computed(() => TOOLS.find((t) => t.id === this.map.tool()) ?? null);
  protected readonly text = computed(() => this.map.lastCopied() ?? this.tool()?.hint ?? (this.map.drawing() ? 'draw' : null));
}
