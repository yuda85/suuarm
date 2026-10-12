import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FovMode, SensorType } from '../../core/domain/sensor';
import { OpsStore } from '../../core/state/ops-store';
import { FEED_LETTERS, FeedLayout, FeedSlot, SensorStore, ThermalPalette } from '../../core/state/sensor.store';
import { SimHost } from '../../core/state/sim-host.service';
import { MapService } from '../../map/map.service';
import { Icon } from '../../shared/ui/icon';
import { Columns2, Grid2x2, Navigation, ScanEye, Square, Video, X } from '../../shared/ui/icons';
import { FeedView } from './feed-view';

const TYPES: SensorType[] = ['EO', 'THERMAL', 'IR', 'RADAR'];
const FOVS: FovMode[] = ['WFOV', 'MFOV', 'NFOV'];
const PALETTES: { id: ThermalPalette; label: string }[] = [
  { id: 'WHITE_HOT', label: 'White hot' },
  { id: 'BLACK_HOT', label: 'Black hot' },
  { id: 'IRONBOW', label: 'Ironbow' },
];

@Component({
  selector: 'app-sensor-panel',
  imports: [FeedView, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2 class="caps">Sensors</h2>
      <div class="layout" role="radiogroup" aria-label="Feed layout">
        @for (l of layouts; track l.n) {
          <button type="button" role="radio" [attr.aria-checked]="sensors.layout() === l.n" (click)="setLayout(l.n)" [attr.aria-label]="l.label">
            <ui-icon [icon]="l.icon" [size]="15" />
          </button>
        }
      </div>
    </header>

    @if (sensors.feeds().length === 0) {
      <div class="empty">
        <ui-icon [icon]="icons.Video" [size]="22" />
        <p class="caps">No sensor open</p>
        <p>Select an aircraft and choose <b>Open sensor</b>.</p>
        @if (store.selected(); as v) {
          <button type="button" class="btn primary" (click)="sensors.openSensor(v.id)">Open sensor · {{ v.id }}</button>
        }
      </div>
    } @else {
      <div class="grid" [attr.data-n]="sensors.layout()">
        @for (slot of sensors.visibleFeeds(); track slot.vehicleId; let i = $index) {
          <div class="tile" [class.active]="isPrimary(slot)">
            <app-feed-view
              [slot]="slot"
              [letter]="letterOf(slot)"
              [primary]="isPrimary(slot)"
              [compact]="sensors.layout() === 4"
              (click)="focus(slot)"
            />
            @if (sensors.layout() !== 1) {
              <button type="button" class="tile-x" (click)="close(slot); $event.stopPropagation()" aria-label="Close feed">
                <ui-icon [icon]="icons.X" [size]="12" />
              </button>
            }
          </div>
        }
        @for (e of emptySlots(); track $index) {
          <button type="button" class="tile add" (click)="fillSlot()" [disabled]="!store.selected()">
            <span class="caps">{{ store.selected() ? 'Add ' + store.selected()!.id : 'Select aircraft' }}</span>
          </button>
        }
      </div>

      @if (primarySlot(); as slot) {
        <section class="ctl">
          <div class="src">
            <span class="letter">{{ letterOf(slot) }}</span>
            <div>
              <div class="mono id">{{ slot.vehicleId }} <span class="dim">· {{ payloadModel() }}</span></div>
              <div class="dim small">Source aircraft highlighted on map · FOV + footprint shown in 3D</div>
            </div>
          </div>

          <div class="row">
            <span class="lbl caps">Payload</span>
            <div class="seg" role="radiogroup" aria-label="Sensor type">
              @for (t of types; track t) {
                <button type="button" role="radio" [attr.aria-checked]="primaryType() === t" [disabled]="!has(slot, t)" (click)="sensors.switchType(slot, t)">
                  {{ t }}
                </button>
              }
            </div>
          </div>
          @if (primaryType() !== 'RADAR') {
            <div class="row">
              <span class="lbl caps">Field of view</span>
              <div class="seg" role="radiogroup" aria-label="Field of view">
                @for (f of fovs; track f) {
                  <button type="button" role="radio" [attr.aria-checked]="primaryFov() === f" (click)="sensors.setFov(slot, f)">{{ f }}</button>
                }
              </div>
            </div>
          }
          @if (primaryType() === 'THERMAL') {
            <div class="row">
              <span class="lbl caps">Palette</span>
              <div class="seg" role="radiogroup" aria-label="Thermal palette">
                @for (p of palettes; track p.id) {
                  <button type="button" role="radio" [attr.aria-checked]="sensors.thermalPalette() === p.id" (click)="sensors.thermalPalette.set(p.id)">
                    {{ p.label }}
                  </button>
                }
              </div>
            </div>
          }

          <div class="actions">
            @if (inPov()) {
              <button type="button" class="btn primary" (click)="sensors.exitPov('FREE_3D')">Return to map</button>
            } @else {
              <button type="button" class="btn primary" (click)="sensors.enterPov(slot.vehicleId, slot.payloadId)">
                <ui-icon [icon]="icons.ScanEye" [size]="15" /> Sensor POV
              </button>
            }
            <button type="button" class="btn" (click)="followUav(slot)"><ui-icon [icon]="icons.Navigation" [size]="15" /> Follow UAV</button>
          </div>
        </section>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--sp-2) 0 var(--sp-4);
      height: 2.5rem;
      border-bottom: 1px solid var(--c-line);
      flex: none;
      h2 {
        margin: 0;
        color: var(--c-text-2);
      }
    }
    .layout {
      display: flex;
      gap: 2px;
      button {
        display: grid;
        place-items: center;
        width: 1.9rem;
        height: 1.7rem;
        border: 0;
        border-radius: var(--r-1);
        background: none;
        color: var(--c-text-3);
        cursor: pointer;
        &[aria-checked='true'] {
          background: var(--c-accent-soft);
          color: var(--c-accent-strong);
        }
        &:hover {
          color: var(--c-text-1);
        }
      }
    }
    .grid {
      display: grid;
      gap: 4px;
      padding: var(--sp-2);
      flex: none;
      grid-template-columns: 1fr;
      &[data-n='2'] {
        grid-template-rows: 1fr 1fr;
      }
      &[data-n='4'] {
        grid-template-columns: 1fr 1fr;
      }
    }
    .tile {
      position: relative;
      aspect-ratio: 16 / 10;
      app-feed-view {
        position: absolute;
        inset: 0;
        cursor: pointer;
      }
      &.add {
        display: grid;
        place-items: center;
        border: 1px dashed var(--c-line-strong);
        border-radius: var(--r-2);
        background: none;
        color: var(--c-text-3);
        cursor: pointer;
        &:disabled {
          cursor: default;
          opacity: 0.6;
        }
      }
    }
    .grid[data-n='2'] .tile {
      aspect-ratio: 16 / 8.2;
    }
    .tile-x {
      position: absolute;
      right: 4px;
      top: 4px;
      display: grid;
      place-items: center;
      width: 1.2rem;
      height: 1.2rem;
      border: 0;
      border-radius: 2px;
      background: rgba(7, 9, 13, 0.7);
      color: var(--c-text-2);
      cursor: pointer;
    }
    .ctl {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      padding: var(--sp-3) var(--sp-4);
      border-top: 1px solid var(--c-line-soft);
    }
    .src {
      display: flex;
      gap: var(--sp-3);
      align-items: center;
      .id {
        font-size: var(--t-md);
      }
    }
    .letter {
      display: grid;
      place-items: center;
      width: 1.6rem;
      height: 1.6rem;
      border-radius: var(--r-1);
      background: rgb(120, 176, 255);
      color: #0a0e14;
      font: 600 var(--t-sm) var(--f-mono);
      flex: none;
    }
    .dim {
      color: var(--c-text-3);
    }
    .small {
      font-size: var(--t-xs);
    }
    .row {
      display: grid;
      grid-template-columns: 6rem 1fr;
      align-items: center;
    }
    .lbl {
      color: var(--c-text-3);
      font-size: 0.625rem;
    }
    .seg {
      display: flex;
      border: 1px solid var(--c-line);
      border-radius: var(--r-2);
      overflow: hidden;
      button {
        flex: 1;
        height: 1.75rem;
        border: 0;
        border-left: 1px solid var(--c-line);
        background: none;
        color: var(--c-text-2);
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        cursor: pointer;
        &:first-child {
          border-left: 0;
        }
        &[aria-checked='true'] {
          background: var(--c-accent-soft);
          color: var(--c-accent-strong);
        }
        &:hover:not(:disabled) {
          color: var(--c-text-1);
        }
        &:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
      }
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--sp-2);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      height: 2.25rem;
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-2);
      background: var(--c-raised);
      color: var(--c-text-1);
      font-size: var(--t-xs);
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background var(--m-fast), border-color var(--m-fast);
      &:hover {
        border-color: var(--c-text-3);
      }
      &.primary {
        background: var(--c-accent);
        border-color: var(--c-accent);
        color: #fff;
        &:hover {
          background: var(--c-accent-strong);
        }
      }
    }
    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--sp-2);
      padding: var(--sp-6);
      text-align: center;
      color: var(--c-text-3);
      p {
        margin: 0;
      }
      b {
        color: var(--c-text-2);
      }
      .btn {
        margin-top: var(--sp-3);
        padding: 0 var(--sp-4);
      }
    }
  `,
})
export class SensorPanel {
  protected readonly sensors = inject(SensorStore);
  protected readonly store = inject(OpsStore);
  private readonly sim = inject(SimHost);
  private readonly map = inject(MapService);
  protected readonly icons = { Square, Columns2, Grid2x2, Video, X, ScanEye, Navigation };
  protected readonly types = TYPES;
  protected readonly fovs = FOVS;
  protected readonly palettes = PALETTES;
  protected readonly layouts: { n: FeedLayout; label: string; icon: typeof Square }[] = [
    { n: 1, label: 'Single feed', icon: Square },
    { n: 2, label: 'Two-way split', icon: Columns2 },
    { n: 4, label: 'Four-way grid', icon: Grid2x2 },
  ];

  protected readonly primarySlot = computed<FeedSlot | null>(() => {
    const f = this.sensors.feeds();
    return f.length ? f[Math.min(this.sensors.primary(), f.length - 1)] : null;
  });
  protected readonly primaryType = computed(() => {
    this.sim.uiTick();
    const s = this.primarySlot();
    return s ? (this.sensors.payload(s)?.type ?? null) : null;
  });
  protected readonly primaryFov = computed(() => {
    this.sim.uiTick();
    const s = this.primarySlot();
    return s ? (this.sensors.payload(s)?.fovMode ?? 'WFOV') : 'WFOV';
  });
  protected readonly payloadModel = computed(() => {
    this.sim.uiTick();
    const s = this.primarySlot();
    return s ? (this.sensors.payload(s)?.model ?? '') : '';
  });
  protected readonly inPov = computed(() => this.store.cameraMode() === 'SENSOR_POV');
  protected readonly emptySlots = computed(() => {
    const n = this.sensors.layout();
    return n === 1 ? [] : Array(Math.max(0, n - this.sensors.visibleFeeds().length)).fill(0);
  });

  protected letterOf(slot: FeedSlot): string {
    return FEED_LETTERS[Math.max(0, this.sensors.feeds().indexOf(slot))] ?? 'A';
  }

  protected isPrimary(slot: FeedSlot): boolean {
    return this.primarySlot()?.vehicleId === slot.vehicleId;
  }

  protected has(slot: FeedSlot, t: SensorType): boolean {
    return !!this.sensors.vehicle(slot)?.payloads.some((p) => p.type === t);
  }

  protected setLayout(n: FeedLayout): void {
    this.sensors.layout.set(n);
  }

  protected focus(slot: FeedSlot): void {
    this.sensors.primary.set(this.sensors.feeds().indexOf(slot));
    this.store.select(slot.vehicleId);
  }

  protected close(slot: FeedSlot): void {
    this.sensors.closeFeed(this.sensors.feeds().indexOf(slot));
  }

  protected fillSlot(): void {
    const v = this.store.selected();
    if (v) this.sensors.assign(this.sensors.feeds().length, v.id);
  }

  protected followUav(slot: FeedSlot): void {
    this.store.select(slot.vehicleId);
    if (this.store.viewDim() === '2D') this.store.viewDim.set('3D');
    if (this.inPov()) this.sensors.exitPov('FOLLOW_VEHICLE');
    else this.store.cameraMode.set('FOLLOW_VEHICLE');
    void this.map;
  }
}
