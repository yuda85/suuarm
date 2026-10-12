import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, input } from '@angular/core';
import { createElement, type IconNode } from 'lucide';

/** Renders a Lucide icon node as inline SVG. Decorative by default (aria-hidden). */
@Component({
  selector: 'ui-icon',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'ui-icon' },
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
      color: inherit;
    }
  `,
})
export class Icon {
  readonly icon = input.required<IconNode>();
  readonly size = input(16);
  readonly stroke = input(1.6);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => {
      const s = this.size();
      const svg = createElement(this.icon(), { width: s, height: s, 'stroke-width': this.stroke() });
      this.el.nativeElement.replaceChildren(svg);
    });
  }
}
