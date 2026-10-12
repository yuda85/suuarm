import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { OpsStore } from '../../core/state/ops-store';
import { formatLatLng } from '../../core/world/geo';
import { MapService } from '../../map/map.service';

@Component({
  selector: 'app-map-footer',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="mono">{{ cursor() }}</span>
    <span class="sep"></span>
    <span class="mono">Z {{ map.zoom() | number: '1.1-1' }}</span>
    <span class="mono">P {{ map.pitch() | number: '1.0-0' }}°</span>
    <span class="sep"></span>
    <span class="prov" [attr.data-p]="store.mapProvider()">{{ providerLabel() }}</span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      height: 1.5rem;
      padding: 0 var(--sp-2);
      border-radius: var(--r-1);
      background: rgba(7, 9, 13, 0.72);
      color: var(--c-text-3);
      font-size: 0.6875rem;
      pointer-events: none;
    }
    .sep {
      width: 1px;
      height: 0.8rem;
      background: var(--c-line-strong);
    }
    .prov {
      letter-spacing: 0.06em;
    }
    .prov[data-p='OFFLINE'] {
      color: var(--s-warning);
    }
  `,
})
export class MapFooter {
  protected readonly map = inject(MapService);
  protected readonly store = inject(OpsStore);
  protected readonly cursor = computed(() => {
    const c = this.map.cursor();
    return c ? formatLatLng(c.lng, c.lat) : '—';
  });
  protected readonly providerLabel = computed(() => {
    switch (this.store.mapProvider()) {
      case 'MAPTILER':
        return 'MAP · MAPTILER';
      case 'OPENFREEMAP':
        return 'MAP · OPENFREEMAP';
      default:
        return 'MAP · OFFLINE FALLBACK';
    }
  });
}
