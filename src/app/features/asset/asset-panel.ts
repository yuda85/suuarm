import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { taskLabel } from '../../core/domain/tasking';
import { CAPABILITY_LABEL, displayState, Vehicle } from '../../core/domain/vehicle';
import { OpsStore } from '../../core/state/ops-store';
import { SimHost } from '../../core/state/sim-host.service';
import { LocalFrame, formatLatLng } from '../../core/world/geo';
import { MapService } from '../../map/map.service';
import { AirframeGlyph } from '../../shared/ui/airframe-glyph';
import { Icon } from '../../shared/ui/icon';
import { Crosshair, Focus, House, Navigation, Pause, Play, ScanEye, Video, View, X } from '../../shared/ui/icons';
import { SensorStore } from '../../core/state/sensor.store';
import { Meter, StatusChip } from '../../shared/ui/status-chip';

@Component({
  selector: 'app-asset-panel',
  imports: [StatusChip, Meter, AirframeGlyph, Icon, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (v(); as v) {
      <header class="head">
        <ui-airframe [cls]="v.platform.airframe" [capability]="v.capability" [size]="34" />
        <div class="title">
          <div class="row1">
            <h2 class="mono">{{ v.id }}</h2>
            <ui-status [state]="state()!" />
          </div>
          <div class="sub">{{ v.callsign }} · {{ v.platform.name }} · {{ capLabel()[v.capability] }}</div>
        </div>
        <button type="button" class="close" aria-label="Close asset panel" (click)="store.select(null)">
          <ui-icon [icon]="icons.X" [size]="16" />
        </button>
      </header>

      <div class="actions" role="toolbar" aria-label="Asset actions">
        <button type="button" class="act" [class.on]="store.cameraMode() === 'FOLLOW_VEHICLE'" (click)="follow()">
          <ui-icon [icon]="icons.Navigation" [size]="15" /> Follow
        </button>
        <button type="button" class="act" [class.on]="store.cameraMode() === 'TACTICAL'" (click)="tactical()">
          <ui-icon [icon]="icons.View" [size]="15" /> Tactical
        </button>
        <button type="button" class="act" [disabled]="!sensorOk()" (click)="openSensor()"><ui-icon [icon]="icons.Video" [size]="15" /> Sensor</button>
        <button type="button" class="act" [class.on]="store.cameraMode() === 'SENSOR_POV'" [disabled]="!sensorOk() || !v.pos.z" (click)="pov()">
          <ui-icon [icon]="icons.ScanEye" [size]="15" /> POV
        </button>
        @if (v.opState === 'HOLD') {
          <button type="button" class="act" (click)="cmd('RESUME')"><ui-icon [icon]="icons.Play" [size]="15" /> Resume</button>
        } @else {
          <button type="button" class="act" [disabled]="v.phase === 'PARKED' || v.opState === 'OFFLINE'" (click)="cmd('HOLD')">
            <ui-icon [icon]="icons.Pause" [size]="15" /> Hold
          </button>
        }
        <button type="button" class="act" [disabled]="v.phase === 'PARKED' || v.opState === 'OFFLINE' || v.phase === 'RTB'" (click)="cmd('RTB')">
          <ui-icon [icon]="icons.House" [size]="15" /> Return
        </button>
      </div>

      <div class="body">
        <section>
          <h3 class="caps">Mission</h3>
          <dl class="grid">
            <div><dt>Assigned</dt><dd>{{ missionLabel() }}</dd></div>
            <div><dt>Task</dt><dd>{{ taskLabel() }}</dd></div>
            <div><dt>Phase</dt><dd class="mono">{{ v.phase }}</dd></div>
            <div><dt>Hub</dt><dd>{{ hubName() }}</dd></div>
          </dl>
        </section>

        <section>
          <h3 class="caps">Flight</h3>
          <div class="flight">
            <div class="big"><span class="mono">{{ v.pos.z | number: '1.0-0' }}</span><small>m AGL</small><label>Altitude</label></div>
            <div class="big"><span class="mono">{{ v.speed * 1.944 | number: '1.0-0' }}</span><small>kt</small><label>Ground speed</label></div>
            <div class="big">
              <span class="mono">{{ hdg() }}</span><small>°</small><label>Heading</label>
              <span class="hdg-arrow" [style.transform]="'rotate(' + v.heading + 'deg)'" aria-hidden="true"></span>
            </div>
          </div>
          <div class="coord mono">{{ coords() }}</div>
        </section>

        <section class="two">
          <div>
            <h3 class="caps">Power</h3>
            <div class="meter-row">
              <span class="mono val">{{ v.battery * 100 | number: '1.0-0' }}%</span>
              <ui-meter [value]="v.battery" [warnBelow]="0.25" [critBelow]="0.12" />
            </div>
            <dl class="grid tight"><div><dt>Endurance</dt><dd class="mono">{{ endurance() }} min</dd></div></dl>
          </div>
          <div>
            <h3 class="caps">Communications</h3>
            <div class="meter-row">
              <span class="mono val">{{ v.link.quality * 100 | number: '1.0-0' }}%</span>
              <ui-meter [value]="v.link.quality" [warnBelow]="0.35" [critBelow]="0.12" />
            </div>
            <dl class="grid tight">
              <div><dt>Latency</dt><dd class="mono">{{ v.link.latencyMs }} ms</dd></div>
              <div><dt>Network</dt><dd [attr.data-state]="v.link.state">{{ v.link.state }} · {{ v.link.via }}</dd></div>
            </dl>
          </div>
        </section>

        <section class="two">
          <div>
            <h3 class="caps">Navigation</h3>
            <dl class="grid tight">
              <div><dt>Solution</dt><dd>{{ v.nav.state }}</dd></div>
              <div><dt>Position quality</dt><dd class="mono">± {{ v.nav.hAccM | number: '1.2-2' }} m</dd></div>
            </dl>
          </div>
          <div>
            <h3 class="caps">Compute</h3>
            <dl class="grid tight">
              <div><dt>Mission computer</dt><dd [attr.data-state]="v.compute.health">{{ v.compute.health }}</dd></div>
              <div><dt>Temp · Load</dt><dd class="mono">{{ v.compute.tempC | number: '1.0-0' }}°C · {{ v.compute.load * 100 | number: '1.0-0' }}%</dd></div>
            </dl>
          </div>
        </section>

        <section>
          <h3 class="caps">Payload</h3>
          <ul class="payloads">
            @for (p of v.payloads; track p.id) {
              <li [class.active]="p.id === v.activePayloadId">
                <span class="ptype mono">{{ p.type }}</span>
                <span class="pmodel">{{ p.model }}</span>
                <span class="pstat" [attr.data-state]="p.status">{{ p.status }}</span>
              </li>
            }
          </ul>
        </section>
      </div>
    } @else {
      <div class="none">
        <ui-icon [icon]="icons.Crosshair" [size]="22" />
        <p class="caps">No asset selected</p>
        <p>Select a vehicle on the map or in the fleet list.</p>
      </div>
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
      gap: var(--sp-3);
      padding: var(--sp-3) var(--sp-2) var(--sp-3) var(--sp-4);
      border-bottom: 1px solid var(--c-line);
      ui-airframe {
        color: var(--c-text-1);
      }
    }
    .title {
      flex: 1;
      min-width: 0;
    }
    .row1 {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
    }
    h2 {
      margin: 0;
      font-size: var(--t-xl);
      font-weight: 500;
      letter-spacing: 0.02em;
    }
    .sub {
      color: var(--c-text-3);
      font-size: var(--t-xs);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .close {
      align-self: flex-start;
      display: grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      border: 0;
      border-radius: var(--r-1);
      background: none;
      color: var(--c-text-3);
      cursor: pointer;
      &:hover {
        background: var(--c-raised);
        color: var(--c-text-1);
      }
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 1px;
      border-bottom: 1px solid var(--c-line);
      background: var(--c-line);
    }
    .act {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      padding: 0.45rem 0 0.4rem;
      border: 0;
      background: var(--c-panel-solid);
      color: var(--c-text-2);
      font-size: 0.6875rem;
      font-weight: 500;
      letter-spacing: 0.04em;
      cursor: pointer;
      transition: background var(--m-fast), color var(--m-fast);
      &:hover:not(:disabled) {
        background: var(--c-raised);
        color: var(--c-text-1);
      }
      &.on {
        color: var(--c-accent-strong);
        background: var(--c-accent-soft);
        box-shadow: inset 0 -2px 0 var(--c-accent);
      }
      &:disabled {
        opacity: 0.38;
        cursor: not-allowed;
      }
    }
    .body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    section {
      padding: var(--sp-3) var(--sp-4);
      border-bottom: 1px solid var(--c-line-soft);
    }
    section.two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--sp-4);
    }
    h3 {
      margin: 0 0 var(--sp-2);
      color: var(--c-text-3);
      font-size: 0.625rem;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--sp-2) var(--sp-3);
      margin: 0;
      &.tight {
        grid-template-columns: 1fr;
        gap: 0.3rem;
        margin-top: var(--sp-2);
      }
      dt {
        font-size: 0.6875rem;
        color: var(--c-text-3);
      }
      dd {
        margin: 0;
        font-size: var(--t-sm);
        color: var(--c-text-1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
    [data-state='DEGRADED'] {
      color: var(--s-warning) !important;
    }
    [data-state='LOST'],
    [data-state='FAULT'],
    [data-state='OFFLINE'] {
      color: var(--s-critical) !important;
    }
    .flight {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--sp-3);
    }
    .big {
      position: relative;
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: baseline;
      column-gap: 0.25rem;
      span {
        font-size: var(--t-2xl);
        font-weight: 400;
        line-height: 1.1;
      }
      small {
        color: var(--c-text-3);
        font-size: var(--t-xs);
      }
      label {
        grid-column: 1 / -1;
        color: var(--c-text-3);
        font-size: 0.6875rem;
      }
    }
    .hdg-arrow {
      position: absolute;
      right: 0.2rem;
      top: 0.4rem;
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-bottom: 12px solid var(--c-accent);
      transition: transform var(--m-slow) linear;
    }
    .coord {
      margin-top: var(--sp-2);
      font-size: var(--t-xs);
      color: var(--c-text-2);
    }
    .meter-row {
      display: grid;
      grid-template-columns: 3rem 1fr;
      align-items: center;
      gap: var(--sp-2);
      .val {
        font-size: var(--t-lg);
      }
    }
    .payloads {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      li {
        display: grid;
        grid-template-columns: 4.5rem 1fr auto;
        align-items: center;
        padding: 0.3rem 0.5rem;
        border-radius: var(--r-1);
        background: var(--c-raised);
        font-size: var(--t-xs);
        &.active {
          box-shadow: inset 2px 0 0 var(--c-accent);
        }
      }
      .ptype {
        font-weight: 600;
      }
      .pmodel {
        color: var(--c-text-3);
      }
      .pstat {
        font-size: 0.625rem;
        letter-spacing: 0.06em;
        color: var(--s-active);
      }
    }
    .none {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--sp-1);
      padding: var(--sp-6);
      color: var(--c-text-3);
      text-align: center;
      p {
        margin: 0;
      }
    }
  `,
})
export class AssetPanel {
  protected readonly store = inject(OpsStore);
  private readonly sim = inject(SimHost);
  private readonly map = inject(MapService);
  protected readonly icons = { X, Navigation, View, Focus, Pause, Play, House, Crosshair, Video, ScanEye };
  private readonly sensors = inject(SensorStore);
  protected readonly sensorOk = computed(() => {
    const v = this.v();
    return !!v && v.opState !== 'OFFLINE' && v.payloads.some((p) => p.status !== 'FAULT');
  });
  protected readonly v = this.store.selected;
  protected readonly capLabel = computed(() => CAPABILITY_LABEL);
  protected readonly state = computed(() => {
    const v = this.v();
    return v ? displayState(v) : null;
  });
  private readonly geo = computed(() => {
    this.sim.generation();
    const o = this.sim.engine.scenario.origin;
    return new LocalFrame(o[0], o[1]);
  });
  protected readonly coords = computed(() => {
    const v = this.v();
    if (!v) return '';
    const ll = this.geo().toLngLat(v.pos.x, v.pos.y);
    return formatLatLng(ll[0], ll[1]);
  });
  protected readonly hdg = computed(() => String(Math.round(this.v()?.heading ?? 0) % 360).padStart(3, '0'));
  protected readonly endurance = computed(() => {
    const v = this.v();
    return v ? this.sim.engine.enduranceMin(v) : 0;
  });
  protected readonly hubName = computed(() => {
    const v = this.v();
    return v ? this.sim.engine.hubName(v.hubId) : '';
  });
  protected readonly missionLabel = computed(() => {
    const v = this.v();
    if (!v) return '';
    const m = v.missionId ? this.sim.engine.missions.missions.find((x) => x.id === v.missionId) : undefined;
    if (m) return `${m.code} · ${m.intent.name}`;
    if (v.route?.id.startsWith('bg-')) return 'Standing tasking';
    return '—';
  });
  protected readonly taskLabel = computed(() => {
    const v = this.v();
    return v ? taskLabel(v, (x) => (x.taskId ? (this.sim.engine.missions.tasks.get(x.taskId)?.name ?? null) : null)) : '';
  });

  protected follow(): void {
    this.store.cameraMode.set(this.store.cameraMode() === 'FOLLOW_VEHICLE' ? 'FREE_3D' : 'FOLLOW_VEHICLE');
    if (this.store.viewDim() === '2D') this.store.viewDim.set('3D');
  }

  protected tactical(): void {
    this.store.cameraMode.set('TACTICAL');
    if (this.store.viewDim() === '2D') this.store.viewDim.set('3D');
  }

  protected focus(): void {
    const v = this.v();
    if (!v) return;
    if (this.store.cameraMode() !== 'FREE_3D' && this.store.cameraMode() !== 'FREE_2D') {
      this.store.cameraMode.set(this.store.viewDim() === '2D' ? 'FREE_2D' : 'FREE_3D');
    }
    setTimeout(() => this.map.focusVehicle(v.id), 0);
  }

  protected openSensor(): void {
    const v = this.v();
    if (v) this.sensors.openSensor(v.id);
  }

  protected pov(): void {
    const v = this.v();
    if (!v) return;
    if (this.store.cameraMode() === 'SENSOR_POV') this.sensors.exitPov('FREE_3D');
    else this.sensors.enterPov(v.id);
  }

  protected cmd(type: 'HOLD' | 'RESUME' | 'RTB'): void {
    const v: Vehicle | null = this.v();
    if (v) this.sim.dispatch({ type, vehicleId: v.id });
  }
}
