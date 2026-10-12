import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { dist2 } from '../../core/domain/geometry';
import { OpsStore } from '../../core/state/ops-store';
import { SimHost } from '../../core/state/sim-host.service';
import { tickClock } from '../../core/state/clock';
import { formatLatLng, LocalFrame } from '../../core/world/geo';
import { Icon } from '../../shared/ui/icon';
import { Radar, X } from '../../shared/ui/icons';

const STAGES = ['DETECTED', 'CLASSIFYING', 'CLASSIFIED', 'MONITORED', 'DEPARTING', 'RESOLVED'] as const;

/** Contact details for an aerial track: classification, kinematics, response status. */
@Component({
  selector: 'app-track-panel',
  imports: [Icon, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (t(); as t) {
      <header class="head">
        <span class="glyph" [attr.data-s]="t.status"><ui-icon [icon]="icons.Radar" [size]="18" /></span>
        <div class="title">
          <h2 class="mono">{{ t.id }}</h2>
          <div class="sub">{{ t.status === 'DETECTED' ? 'UNKNOWN' : t.cls }} · {{ t.cooperative ? 'cooperative' : 'non-cooperative' }} · first seen {{ seen() }}</div>
        </div>
        <button type="button" class="close" aria-label="Close track" (click)="ops.selectTrack(null)"><ui-icon [icon]="icons.X" [size]="16" /></button>
      </header>
      <ol class="stages">
        @for (s of stages; track s; let i = $index) {
          <li [class.done]="i < stageIndex()" [class.cur]="i === stageIndex()">{{ s }}</li>
        }
      </ol>
      <section>
        <h3 class="caps">Classification</h3>
        <div class="conf">
          <span class="mono big">{{ t.confidence * 100 | number: '1.0-0' }}<small>%</small></span>
          <span class="bar"><i [style.transform]="'scaleX(' + t.confidence + ')'"></i></span>
        </div>
        <p class="note">Simulated sensor fusion (radar + EO). Visualisation of the C2 workflow only.</p>
      </section>
      <section class="grid">
        <div><label>Altitude</label><span class="mono">{{ t.pos.z | number: '1.0-0' }} m</span></div>
        <div><label>Speed</label><span class="mono">{{ t.speed * 1.944 | number: '1.0-0' }} kt</span></div>
        <div><label>Heading</label><span class="mono">{{ t.heading | number: '3.0-0' }}°</span></div>
        <div><label>To protected site</label><span class="mono">{{ range() | number: '1.0-0' }} m</span></div>
        <div class="wide"><label>Position</label><span class="mono">{{ ll() }}</span></div>
      </section>
      <section>
        <h3 class="caps">Response</h3>
        @if (group().length) {
          <ul class="group">
            @for (g of group(); track g.id) {
              <li><span class="mono">{{ g.id }}</span><span>{{ g.role }}</span><span class="st" [attr.data-on]="g.on">{{ g.on ? 'ON STATION' : 'INBOUND' }}</span></li>
            }
          </ul>
        } @else {
          <p class="note">{{ t.status === 'CLASSIFIED' ? 'Awaiting operator approval of the recommended group.' : 'Evaluating response assets…' }}</p>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      padding: var(--sp-3) var(--sp-2) var(--sp-3) var(--sp-4);
      border-bottom: 1px solid var(--c-line);
    }
    .glyph {
      display: grid;
      place-items: center;
      width: 2.2rem;
      height: 2.2rem;
      border-radius: var(--r-2);
      background: var(--s-warning-soft);
      color: var(--s-warning);
      &[data-s='DEPARTING'] {
        background: var(--s-ready-soft);
        color: var(--s-ready);
      }
      &[data-s='RESOLVED'] {
        background: var(--c-raised);
        color: var(--c-text-3);
      }
    }
    .title {
      flex: 1;
      h2 {
        margin: 0;
        font-size: var(--t-xl);
        font-weight: 500;
      }
      .sub {
        color: var(--c-text-3);
        font-size: var(--t-xs);
      }
    }
    .close {
      align-self: flex-start;
      display: grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      border: 0;
      background: none;
      color: var(--c-text-3);
      cursor: pointer;
    }
    .stages {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 2px;
      margin: 0;
      padding: var(--sp-3) var(--sp-4) 0;
      list-style: none;
      li {
        padding-top: 0.35rem;
        border-top: 3px solid var(--c-raised-2);
        color: var(--c-text-3);
        font-size: 0.5rem;
        letter-spacing: 0.04em;
        &.done {
          border-color: var(--s-ready);
          color: var(--c-text-2);
        }
        &.cur {
          border-color: var(--s-warning);
          color: var(--s-warning);
        }
      }
    }
    section {
      padding: var(--sp-3) var(--sp-4);
      border-bottom: 1px solid var(--c-line-soft);
    }
    h3 {
      margin: 0 0 var(--sp-2);
      color: var(--c-text-3);
      font-size: 0.625rem;
    }
    .conf {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: var(--sp-3);
      .big {
        font-size: var(--t-2xl);
        small {
          color: var(--c-text-3);
          font-size: var(--t-xs);
        }
      }
      .bar {
        position: relative;
        height: 4px;
        background: var(--c-raised-2);
        i {
          position: absolute;
          inset: 0;
          background: var(--s-warning);
          transform-origin: left;
          transition: transform var(--m-slow) var(--ease);
        }
      }
    }
    .note {
      margin: var(--sp-2) 0 0;
      color: var(--c-text-3);
      font-size: 0.6875rem;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--sp-2) var(--sp-3);
      label {
        display: block;
        color: var(--c-text-3);
        font-size: 0.6875rem;
      }
      .wide {
        grid-column: 1 / -1;
      }
    }
    .group {
      list-style: none;
      margin: 0;
      padding: 0;
      li {
        display: grid;
        grid-template-columns: 4.5rem 1fr auto;
        align-items: center;
        height: 1.6rem;
        border-bottom: 1px solid var(--c-line-soft);
        font-size: var(--t-xs);
        color: var(--c-text-2);
      }
      .st {
        font-size: 0.5625rem;
        letter-spacing: 0.06em;
        color: var(--c-accent-strong);
        &[data-on='true'] {
          color: var(--s-active);
        }
      }
    }
  `,
})
export class TrackPanel {
  protected readonly ops = inject(OpsStore);
  private readonly sim = inject(SimHost);
  protected readonly icons = { X, Radar };
  protected readonly stages = STAGES;
  protected readonly t = computed(
    () => {
      this.sim.uiTick();
      const id = this.ops.selectedTrackId();
      return id ? (this.sim.engine.response.trackOf(id) ?? null) : null;
    },
    { equal: () => false },
  );
  protected readonly stageIndex = computed(() => STAGES.indexOf(this.t()?.status ?? 'DETECTED'));
  protected readonly seen = computed(() => (this.t() ? tickClock(this.sim.startedAtMs, this.t()!.createdTick) : ''));
  protected readonly range = computed(() => {
    const t = this.t();
    const z = this.sim.engine.scenario.protectedZone;
    return t && z ? dist2(t.pos, z.center) : 0;
  });
  protected readonly ll = computed(() => {
    const t = this.t();
    if (!t) return '';
    const o = this.sim.engine.scenario.origin;
    const ll = new LocalFrame(o[0], o[1]).toLngLat(t.pos.x, t.pos.y);
    return formatLatLng(ll[0], ll[1]);
  });
  protected readonly group = computed(() => {
    const t = this.t();
    const e = this.sim.engine;
    const m = t?.missionId ? e.missions.missions.find((x) => x.id === t.missionId) : undefined;
    if (!m || m.status === 'PLANNED') return [];
    return m.taskIds.map((id) => {
      const task = e.missions.tasks.get(id)!;
      return { id: task.vehicleId ?? '—', role: task.name.split('·')[0].trim(), on: task.state === 'ACTIVE' || task.state === 'COMPLETE' };
    });
  });
}
