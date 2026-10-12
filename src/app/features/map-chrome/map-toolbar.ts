import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CameraMode } from '../../core/domain/camera';
import { LayerKey, OpsStore } from '../../core/state/ops-store';
import { MapService, ToolKind } from '../../map/map.service';
import { Icon } from '../../shared/ui/icon';
import {
  Boxes,
  Building,
  Circle,
  Compass,
  Crosshair,
  Hexagon,
  Layers,
  Map,
  MapPin,
  Mountain,
  Navigation,
  Ruler,
  Satellite,
  Scan,
  Square,
  View,
  Waypoints,
} from '../../shared/ui/icons';

const TOOLS: { id: ToolKind; label: string; hint: string; icon: typeof Ruler; key: string }[] = [
  { id: 'distance', label: 'Distance', hint: 'Click to add points · double-click to finish', icon: Ruler, key: 'M' },
  { id: 'area', label: 'Area', hint: 'Click to add vertices · double-click to close', icon: Square, key: 'A' },
  { id: 'radius', label: 'Radius', hint: 'Click centre, then click edge', icon: Circle, key: 'R' },
  { id: 'poi', label: 'POI', hint: 'Click to place a point of interest', icon: MapPin, key: 'P' },
  { id: 'coord', label: 'Coordinates', hint: 'Click to pin and copy coordinates', icon: Crosshair, key: 'C' },
  { id: 'geofence', label: 'Geofence', hint: 'Draw a no-fly polygon · double-click to activate', icon: Hexagon, key: 'G' },
];

const LAYERS: { id: LayerKey; label: string }[] = [
  { id: 'missions', label: 'Mission areas · sectors · routes' },
  { id: 'coverage', label: 'Scan coverage' },
  { id: 'sensors', label: 'Sensor FOV · footprints' },
  { id: 'links', label: 'Communication links' },
  { id: 'geofences', label: 'Geofences · restricted areas' },
  { id: 'tracks', label: 'Aerial tracks' },
  { id: 'annotations', label: 'Measurements · POIs' },
  { id: 'labels', label: 'Labels' },
  { id: 'hubs', label: 'Bases · pads' },
  { id: 'campus', label: 'Campus structures' },
];

@Component({
  selector: 'app-map-toolbar',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:keydown)': 'onKey($event)' },
  template: `
    <div class="group dim" role="radiogroup" aria-label="Map dimension">
      <button type="button" role="radio" [attr.aria-checked]="store.viewDim() === '2D'" (click)="store.viewDim.set('2D')">2D</button>
      <button type="button" role="radio" [attr.aria-checked]="store.viewDim() === '3D'" (click)="store.viewDim.set('3D')">3D</button>
    </div>

    <div class="group" role="radiogroup" aria-label="Camera mode">
      <button type="button" class="tb" role="radio" [attr.aria-checked]="isFree()" (click)="cam(free())" title="Free camera (F1)">
        <ui-icon [icon]="icons.Scan" [size]="17" /><span>Free</span>
      </button>
      <button type="button" class="tb" role="radio" [attr.aria-checked]="store.cameraMode() === 'FOLLOW_VEHICLE'" [disabled]="!store.selectedId()" (click)="cam('FOLLOW_VEHICLE')" title="Follow selected vehicle (F)">
        <ui-icon [icon]="icons.Navigation" [size]="17" /><span>Follow</span>
      </button>
      <button type="button" class="tb" role="radio" [attr.aria-checked]="store.cameraMode() === 'TACTICAL'" (click)="cam('TACTICAL')" title="Tactical view (T)">
        <ui-icon [icon]="icons.View" [size]="17" /><span>Tactical</span>
      </button>
    </div>

    <div class="group">
      <button type="button" class="tb" (click)="map.zoomToFleet()" title="Zoom to fleet">
        <ui-icon [icon]="icons.Boxes" [size]="17" /><span>Fleet</span>
      </button>
      <button type="button" class="tb compass" (click)="map.resetNorth()" title="Reset north" aria-label="Reset bearing to north">
        <span class="needle" [style.transform]="'rotate(' + -map.bearing() + 'deg)'"><ui-icon [icon]="icons.Compass" [size]="17" /></span>
        <span class="mono">{{ bearing() }}°</span>
      </button>
    </div>

    <div class="group">
      <button type="button" class="tb" [attr.aria-expanded]="open() === 'tools'" [class.on]="!!map.tool()" (click)="toggle('tools')" title="Map tools">
        <ui-icon [icon]="icons.Ruler" [size]="17" /><span>Tools</span>
      </button>
      <button type="button" class="tb" [attr.aria-expanded]="open() === 'layers'" (click)="toggle('layers')" title="Layers and basemap (L)">
        <ui-icon [icon]="icons.Layers" [size]="17" /><span>Layers</span>
      </button>
    </div>

    @if (open() === 'tools') {
      <section class="fly" role="menu" aria-label="Map tools">
        <h3 class="caps">Map tools</h3>
        <div class="tools">
          @for (t of tools; track t.id) {
            <button type="button" role="menuitem" class="tool" [class.on]="map.tool() === t.id" (click)="use(t.id)">
              <ui-icon [icon]="t.icon" [size]="16" />
              <span>{{ t.label }}</span>
              <kbd>{{ t.key }}</kbd>
            </button>
          }
        </div>
        <div class="foot">
          <span class="mono dim">{{ map.annotationCount() }} annotation{{ map.annotationCount() === 1 ? '' : 's' }}</span>
          <button type="button" class="link" [disabled]="!map.annotationCount()" (click)="map.clearAnnotations()">Clear</button>
        </div>
      </section>
    }

    @if (open() === 'layers') {
      <section class="fly" aria-label="Layers">
        <h3 class="caps">Basemap</h3>
        <div class="seg" role="radiogroup" aria-label="Basemap">
          <button type="button" role="radio" [attr.aria-checked]="store.basemap() === 'VECTOR'" (click)="store.basemap.set('VECTOR')">
            <ui-icon [icon]="icons.Map" [size]="14" /> Vector
          </button>
          <button type="button" role="radio" [attr.aria-checked]="store.basemap() === 'SATELLITE'" (click)="store.basemap.set('SATELLITE')">
            <ui-icon [icon]="icons.Satellite" [size]="14" /> Satellite
          </button>
        </div>
        <div class="checks">
          <label><input type="checkbox" [checked]="store.terrain()" (change)="store.terrain.set(!store.terrain())" /> <ui-icon [icon]="icons.Mountain" [size]="14" /> Terrain</label>
          <label><input type="checkbox" [checked]="store.buildings()" (change)="store.buildings.set(!store.buildings())" /> <ui-icon [icon]="icons.Building" [size]="14" /> 3D buildings</label>
        </div>
        <h3 class="caps">Operational layers</h3>
        <div class="checks">
          <label><input type="checkbox" checked disabled /> UAVs</label>
          <label><input type="checkbox" [checked]="store.clustering()" (change)="store.clustering.set(!store.clustering())" /> Clusters</label>
          <label><input type="checkbox" [checked]="store.trails()" (change)="store.trails.set(!store.trails())" /> <ui-icon [icon]="icons.Waypoints" [size]="13" /> Flight paths</label>
          @for (l of layers; track l.id) {
            <label><input type="checkbox" [checked]="store.layers()[l.id]" (change)="store.toggleLayer(l.id)" /> {{ l.label }}</label>
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      pointer-events: auto;
    }
    .group {
      display: flex;
      flex-direction: column;
      background: var(--c-panel);
      border: 1px solid var(--c-line);
      border-radius: var(--r-2);
      overflow: hidden;
    }
    .dim {
      flex-direction: row;
      button {
        flex: 1;
        height: 1.9rem;
        border: 0;
        background: none;
        color: var(--c-text-3);
        font-size: var(--t-xs);
        font-weight: 600;
        letter-spacing: 0.06em;
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
    .tb {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      width: 3.5rem;
      padding: 0.45rem 0 0.35rem;
      border: 0;
      border-top: 1px solid var(--c-line-soft);
      background: none;
      color: var(--c-text-2);
      font-size: 0.625rem;
      letter-spacing: 0.03em;
      cursor: pointer;
      transition: background var(--m-fast), color var(--m-fast);
      &:first-child {
        border-top: 0;
      }
      &:hover:not(:disabled) {
        background: var(--c-raised);
        color: var(--c-text-1);
      }
      &[aria-checked='true'],
      &[aria-expanded='true'],
      &.on {
        color: var(--c-accent-strong);
        background: var(--c-accent-soft);
        box-shadow: inset 2px 0 0 var(--c-accent);
      }
      &:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
    }
    .needle {
      display: inline-flex;
      transition: transform 80ms linear;
    }
    .fly {
      position: absolute;
      right: calc(100% + var(--sp-2));
      top: 0;
      width: 16.5rem;
      padding: var(--sp-3);
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-3);
      background: var(--c-panel-solid);
      box-shadow: var(--shadow-pop);
      animation: pop var(--m-base) var(--ease-out);
      h3 {
        margin: var(--sp-2) 0 var(--sp-2);
        color: var(--c-text-3);
        font-size: 0.625rem;
        &:first-child {
          margin-top: 0;
        }
      }
    }
    @keyframes pop {
      from {
        transform: translateX(6px);
        opacity: 0;
      }
    }
    .tools {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
    }
    .tool {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.4rem;
      height: 2.1rem;
      padding: 0 0.5rem;
      border: 1px solid var(--c-line);
      border-radius: var(--r-2);
      background: var(--c-raised);
      color: var(--c-text-2);
      font-size: var(--t-xs);
      text-align: left;
      cursor: pointer;
      &:hover {
        color: var(--c-text-1);
        border-color: var(--c-line-strong);
      }
      &.on {
        border-color: var(--c-accent-line);
        background: var(--c-accent-soft);
        color: var(--c-accent-strong);
      }
      kbd {
        font: 500 0.5625rem var(--f-mono);
        color: var(--c-text-3);
      }
    }
    .foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: var(--sp-3);
      font-size: 0.6875rem;
      .dim {
        color: var(--c-text-3);
      }
    }
    .link {
      border: 0;
      background: none;
      color: var(--c-accent-strong);
      font-size: 0.6875rem;
      cursor: pointer;
      &:disabled {
        color: var(--c-text-3);
        cursor: default;
      }
    }
    .seg {
      display: flex;
      border: 1px solid var(--c-line);
      border-radius: var(--r-2);
      overflow: hidden;
      button {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        height: 1.9rem;
        border: 0;
        background: none;
        color: var(--c-text-2);
        font-size: var(--t-xs);
        cursor: pointer;
        &[aria-checked='true'] {
          background: var(--c-accent-soft);
          color: var(--c-accent-strong);
        }
      }
    }
    .checks {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      margin-top: var(--sp-2);
      label {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        min-height: 1.45rem;
        font-size: var(--t-xs);
        color: var(--c-text-2);
        cursor: pointer;
        input {
          accent-color: var(--c-accent);
          margin: 0;
        }
      }
    }
  `,
})
export class MapToolbar {
  protected readonly store = inject(OpsStore);
  protected readonly map = inject(MapService);
  protected readonly icons = { Scan, Navigation, View, Boxes, Compass, Map, Satellite, Mountain, Building, Ruler, Layers, Waypoints };
  protected readonly tools = TOOLS;
  protected readonly layers = LAYERS;
  protected readonly open = signal<'tools' | 'layers' | null>(null);
  protected readonly bearing = computed(() => String(Math.round((this.map.bearing() + 360) % 360)).padStart(3, '0'));
  protected readonly free = computed<CameraMode>(() => (this.store.viewDim() === '2D' ? 'FREE_2D' : 'FREE_3D'));
  protected readonly isFree = computed(() => this.store.cameraMode() === 'FREE_2D' || this.store.cameraMode() === 'FREE_3D');

  protected toggle(p: 'tools' | 'layers'): void {
    this.open.set(this.open() === p ? null : p);
  }

  protected cam(mode: CameraMode): void {
    if ((mode === 'FOLLOW_VEHICLE' || mode === 'TACTICAL') && this.store.viewDim() === '2D') this.store.viewDim.set('3D');
    this.store.cameraMode.set(mode);
  }

  protected use(t: ToolKind): void {
    this.open.set(null);
    void this.map.useTool(t);
  }

  protected onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (this.store.cameraMode() === 'SENSOR_POV') return;
    const k = e.key.toUpperCase();
    const tool = TOOLS.find((t) => t.key === k);
    if (tool && e.shiftKey) {
      e.preventDefault();
      this.use(tool.id);
    } else if (k === 'L' && !e.shiftKey) this.toggle('layers');
  }
}

export { TOOLS };
