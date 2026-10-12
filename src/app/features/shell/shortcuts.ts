import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AlertStore } from '../../core/state/alert.store';
import { OpsStore } from '../../core/state/ops-store';
import { RoleService } from '../../core/state/role.service';
import { SensorStore } from '../../core/state/sensor.store';
import { MapService } from '../../map/map.service';

const KEYS: { k: string; d: string }[] = [
  { k: '?', d: 'Show / hide shortcuts' },
  { k: '2 · 3', d: '2D / 3D map' },
  { k: 'F', d: 'Follow selected UAV' },
  { k: 'T', d: 'Tactical view' },
  { k: 'S', d: 'Open sensor of selected UAV' },
  { k: 'V', d: 'Enter / exit Sensor POV' },
  { k: '[ · ]', d: 'Previous / next active UAV' },
  { k: 'H', d: 'Zoom to fleet' },
  { k: 'L', d: 'Layers & basemap' },
  { k: 'Shift + M A R P C G', d: 'Distance · Area · Radius · POI · Coordinates · Geofence' },
  { k: 'Enter · Backspace', d: 'Approve / reject recommendation' },
  { k: 'Esc', d: 'Leave POV / follow · cancel tool · clear selection' },
  { k: 'B', d: 'Presentation mode' },
  { k: 'Ctrl + Shift + D', d: 'Presenter panel & story director' },
  { k: '← ↑ → ↓ · wheel', d: 'In POV: slew gimbal · zoom FOV' },
];

/** Global keyboard handling + shortcut reference overlay. */
@Component({
  selector: 'app-shortcuts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:keydown)': 'onKey($event)' },
  template: `
    @if (open()) {
      <div class="scrim" (click)="open.set(false)"></div>
      <section class="sheet" role="dialog" aria-label="Keyboard shortcuts">
        <header>
          <h2 class="caps">Keyboard</h2>
          <button type="button" (click)="open.set(false)">Close</button>
        </header>
        <dl>
          @for (x of keys; track x.k) {
            <div><dt><kbd>{{ x.k }}</kbd></dt><dd>{{ x.d }}</dd></div>
          }
        </dl>
      </section>
    }
  `,
  styles: `
    .scrim {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal);
      background: var(--c-scrim);
    }
    .sheet {
      position: fixed;
      left: 50%;
      top: 50%;
      z-index: var(--z-modal);
      width: min(34rem, 92vw);
      transform: translate(-50%, -50%);
      padding: var(--sp-4);
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-3);
      background: var(--c-panel-solid);
      box-shadow: var(--shadow-pop);
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--sp-3);
      h2 {
        margin: 0;
        color: var(--c-text-2);
      }
      button {
        border: 1px solid var(--c-line-strong);
        border-radius: var(--r-1);
        background: var(--c-raised);
        color: var(--c-text-1);
        padding: 0.2rem 0.6rem;
        cursor: pointer;
      }
    }
    dl {
      margin: 0;
      div {
        display: grid;
        grid-template-columns: 10rem 1fr;
        align-items: center;
        padding: 0.32rem 0;
        border-bottom: 1px solid var(--c-line-soft);
        font-size: var(--t-xs);
      }
      dd {
        margin: 0;
        color: var(--c-text-2);
      }
    }
    kbd {
      padding: 0.1rem 0.4rem;
      border: 1px solid var(--c-line-strong);
      border-bottom-width: 2px;
      border-radius: var(--r-1);
      background: var(--c-raised);
      font: 500 0.6875rem var(--f-mono);
      color: var(--c-text-1);
    }
  `,
})
export class Shortcuts {
  private readonly ops = inject(OpsStore);
  private readonly sensors = inject(SensorStore);
  private readonly map = inject(MapService);
  private readonly alerts = inject(AlertStore);
  private readonly roles = inject(RoleService);
  protected readonly keys = KEYS;
  readonly open = signal(false);

  protected onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const pov = this.ops.cameraMode() === 'SENSOR_POV';
    if (e.key === '?') {
      this.open.set(!this.open());
      return;
    }
    if (e.key === 'Escape') {
      if (this.open()) return this.open.set(false);
      if (this.map.drawing()) return; // draw tool handles its own Esc
      if (pov) return; // POV HUD handles its own Esc
      if (this.alerts.centerOpen() || this.alerts.healthOpen()) {
        this.alerts.centerOpen.set(false);
        this.alerts.healthOpen.set(false);
        return;
      }
      if (this.ops.cameraMode() === 'FOLLOW_VEHICLE' || this.ops.cameraMode() === 'TACTICAL') {
        this.ops.cameraMode.set(this.ops.viewDim() === '2D' ? 'FREE_2D' : 'FREE_3D');
        return;
      }
      this.ops.select(null);
      this.ops.selectTrack(null);
      return;
    }
    if (pov || e.shiftKey) return;
    const sel = this.ops.selectedId();
    switch (e.key.toLowerCase()) {
      case '2':
        this.ops.viewDim.set('2D');
        break;
      case '3':
        this.ops.viewDim.set('3D');
        break;
      case 'f':
        if (sel) {
          this.ops.viewDim.set('3D');
          this.ops.cameraMode.set(this.ops.cameraMode() === 'FOLLOW_VEHICLE' ? 'FREE_3D' : 'FOLLOW_VEHICLE');
        }
        break;
      case 't':
        this.ops.viewDim.set('3D');
        this.ops.cameraMode.set('TACTICAL');
        break;
      case 's':
        if (sel) this.sensors.openSensor(sel);
        break;
      case 'v':
        if (sel) this.sensors.enterPov(sel);
        break;
      case 'h':
        this.map.zoomToFleet();
        break;
      case 'b':
        this.roles.presentation.set(!this.roles.presentation());
        break;
      case '[':
      case ']':
        this.cycle(e.key === ']' ? 1 : -1);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  private cycle(dir: number): void {
    const vs = this.ops.vehicles().filter((v) => v.opState === 'ACTIVE' && v.pos.z > 2);
    if (!vs.length) return;
    const i = vs.findIndex((v) => v.id === this.ops.selectedId());
    const next = vs[(i + dir + vs.length) % vs.length];
    this.ops.select(next.id);
    if (this.ops.cameraMode() !== 'FOLLOW_VEHICLE') this.map.focusVehicle(next.id);
  }
}
