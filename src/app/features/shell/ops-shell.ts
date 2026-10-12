import { ChangeDetectionStrategy, Component, computed, effect, inject, isDevMode } from '@angular/core';
import { SensorStore } from '../../core/state/sensor.store';
import { EventFeedStore } from '../../core/state/event-feed.store';
import { OpsStore } from '../../core/state/ops-store';
import { SimHost } from '../../core/state/sim-host.service';
import { MapHost } from '../../map/map-host.component';
import { Icon } from '../../shared/ui/icon';
import { PanelLeft } from '../../shared/ui/icons';
import { AssetPanel } from '../asset/asset-panel';
import { EventStrip } from '../events/event-strip';
import { FleetPanel } from '../fleet/fleet-panel';
import { MapFooter } from '../map-chrome/map-footer';
import { MapToolbar } from '../map-chrome/map-toolbar';
import { CommandBar } from './command-bar';
import { PovHud } from '../pov/pov-hud';
import { SensorFxDefs } from '../sensor/sensor-fx-defs';
import { SensorPanel } from '../sensor/sensor-panel';
import { ClusterCard } from '../map-chrome/cluster-card';
import { DemoPanel } from '../demo/demo-panel';
import { TrackPanel } from '../track/track-panel';
import { ToolHint } from '../map-chrome/tool-hint';
import { Shortcuts } from './shortcuts';
import { StoryService } from '../demo/story.service';
import { AutopilotOverlay } from '../autopilot/autopilot-overlay';
import { AutopilotService } from '../autopilot/autopilot.service';
import { RoleService } from '../../core/state/role.service';
import { RecommendationCard } from '../alerts/recommendation-card';
import { AlertCenter } from '../alerts/alert-center';
import { SystemHealthPopover } from '../alerts/system-health';
import { AlertStore } from '../../core/state/alert.store';

/**
 * Operational workspace. Map is full-bleed; panels float over it (map stays ≥70% of the view).
 * Whole app is locked to the viewport — no page scroll at any size.
 */
@Component({
  selector: 'app-ops-shell',
  imports: [MapHost, CommandBar, FleetPanel, AssetPanel, SensorPanel, MapToolbar, MapFooter, EventStrip, Icon, PovHud, SensorFxDefs, ClusterCard, DemoPanel, RecommendationCard, AlertCenter, SystemHealthPopover, TrackPanel, ToolHint, Shortcuts, AutopilotOverlay],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.left-collapsed]': 'store.leftCollapsed()',
    '[class.right-open]': 'rightOpen()',
    '[class.pov]': "store.cameraMode() === 'SENSOR_POV'",
    '[class.loading]': '!store.mapReady()',
  },
  template: `
    <a class="skip" href="#ops-map" (click)="focusMap($event)">Skip to map</a>
    <app-sensor-fx-defs />
    <app-command-bar />
    <app-shortcuts />
    <app-autopilot-overlay />
    <main class="stage" id="ops-map" tabindex="-1" aria-label="Operations">
      <app-map-host />
      <div class="vignette" aria-hidden="true"></div>

      @if (store.leftCollapsed()) {
        <button type="button" class="rail" (click)="store.leftCollapsed.set(false)" aria-label="Open fleet panel">
          <ui-icon [icon]="icons.PanelLeft" [size]="18" />
          <span class="caps">Fleet</span>
        </button>
      } @else {
        <aside class="panel left" aria-label="Fleet and missions">
          <app-fleet-panel />
        </aside>
      }

      <aside class="panel right" aria-label="Context" [attr.aria-hidden]="!rightOpen()">
        <nav class="rtabs" role="tablist" aria-label="Context panel">
          <button type="button" role="tab" [attr.aria-selected]="store.rightPanel() !== 'SENSOR'" (click)="store.rightPanel.set('ASSET')">
            {{ store.selectedTrackId() ? 'Track' : 'Asset' }}
          </button>
          <button type="button" role="tab" [attr.aria-selected]="store.rightPanel() === 'SENSOR'" (click)="store.rightPanel.set('SENSOR')">
            Sensor
            @if (sensors.feeds().length) {
              <span class="count mono">{{ sensors.feeds().length }}</span>
            }
          </button>
        </nav>
        <div class="rbody">
          @if (store.rightPanel() === 'SENSOR') {
            <app-sensor-panel />
          } @else if (store.selectedTrackId()) {
            <app-track-panel />
          } @else {
            <app-asset-panel />
          }
        </div>
      </aside>

      @if (store.cameraMode() === 'SENSOR_POV' && sensors.pov()) {
        <app-pov-hud />
      }

      <app-map-toolbar class="toolbar" />
      <app-event-strip class="feed" />
      <app-map-footer class="footer" />
      <app-cluster-card />
      <app-recommendation-card />
      <app-tool-hint />
      <app-alert-center />
      <app-system-health />
      <app-demo-panel />

      @if (!store.mapReady()) {
        <div class="boot" role="status">
          <span class="boot-bar"><i></i></span>
          <span class="caps">Initializing operational picture</span>
        </div>
      }
    </main>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .skip {
      position: absolute;
      left: var(--sp-2);
      top: -3rem;
      z-index: var(--z-demo);
      padding: 0.4rem 0.7rem;
      border-radius: var(--r-2);
      background: var(--c-accent);
      color: #fff;
      font-size: var(--t-xs);
      &:focus {
        top: var(--sp-2);
      }
    }
    .stage {
      position: absolute;
      top: var(--bar-h);
      left: 0;
      right: 0;
      bottom: 0;
      overflow: hidden;
    }
    .vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: var(--z-chrome);
      background:
        linear-gradient(to bottom, rgba(7, 9, 13, 0.45), transparent 9%),
        linear-gradient(to top, rgba(7, 9, 13, 0.4), transparent 12%);
    }
    .panel {
      position: absolute;
      top: var(--inset);
      bottom: var(--inset);
      z-index: var(--z-panel);
      background: var(--c-panel);
      border: 1px solid var(--c-line);
      border-radius: var(--r-3);
      overflow: hidden;
      backdrop-filter: blur(6px);
    }
    .left {
      left: var(--inset);
      width: var(--panel-l-w);
      animation: in-left var(--m-slow) var(--ease-out);
    }
    .right {
      right: var(--inset);
      width: var(--panel-r-w);
      display: flex;
      flex-direction: column;
      transform: translateX(calc(100% + var(--inset) * 2));
      transition: transform var(--m-slow) var(--ease);
    }
    .rtabs {
      display: flex;
      gap: var(--sp-4);
      height: 2.1rem;
      padding: 0 var(--sp-4);
      border-bottom: 1px solid var(--c-line);
      background: var(--c-graphite);
      flex: none;
      button {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.35rem;
        border: 0;
        background: none;
        padding: 0;
        color: var(--c-text-3);
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        cursor: pointer;
        &[aria-selected='true'] {
          color: var(--c-text-1);
          &::after {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            bottom: -1px;
            height: 2px;
            background: var(--c-accent);
          }
        }
      }
      .count {
        padding: 0 0.3rem;
        border-radius: 2px;
        background: var(--c-accent-soft);
        color: var(--c-accent-strong);
        font-size: 0.625rem;
      }
    }
    .rbody {
      flex: 1;
      min-height: 0;
    }
    /* Sensor POV: the image takes the stage; panels recede. */
    :host(.pov) .left,
    :host(.pov) .rail,
    :host(.pov) .right,
    :host(.pov) .toolbar,
    :host(.pov) .feed,
    :host(.pov) .footer,
    :host(.pov) .vignette {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
    :host(.pov) .right,
    :host(.pov.right-open) .right {
      transform: translateX(calc(100% + var(--inset) * 2));
      visibility: hidden;
    }
    .left,
    .rail,
    .toolbar,
    .feed,
    .footer,
    .vignette {
      transition: opacity var(--m-slow) var(--ease), transform var(--m-slow) var(--ease);
    }
    :host(.right-open) .right {
      transform: none;
    }
    .rail {
      position: absolute;
      top: var(--inset);
      left: var(--inset);
      z-index: var(--z-panel);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-2);
      padding: var(--sp-3) 0;
      width: 2.75rem;
      border: 1px solid var(--c-line);
      border-radius: var(--r-3);
      background: var(--c-panel);
      color: var(--c-text-2);
      cursor: pointer;
      .caps {
        writing-mode: vertical-rl;
        font-size: 0.625rem;
      }
      &:hover {
        color: var(--c-text-1);
      }
    }
    .toolbar {
      position: absolute;
      top: var(--inset);
      right: var(--inset);
      z-index: var(--z-toolbar);
      transition: transform var(--m-slow) var(--ease);
    }
    :host(.right-open) .toolbar {
      transform: translateX(calc(-1 * (var(--panel-r-w) + var(--inset))));
    }
    .feed {
      position: absolute;
      bottom: var(--inset);
      left: calc(var(--panel-l-w) + var(--inset) * 2);
      right: calc(var(--inset) * 2 + 3.5rem);
      z-index: var(--z-panel);
      max-width: 46rem;
      transition: left var(--m-slow) var(--ease), right var(--m-slow) var(--ease);
    }
    :host(.left-collapsed) .feed {
      left: calc(2.75rem + var(--inset) * 2);
    }
    :host(.right-open) .feed {
      right: calc(var(--panel-r-w) + var(--inset) * 2);
    }
    .footer {
      position: absolute;
      bottom: calc(var(--inset) + 2px);
      right: calc(var(--inset) + 3.75rem);
      z-index: var(--z-chrome);
      transition: transform var(--m-slow) var(--ease);
    }
    :host(.right-open) .footer {
      transform: translateX(calc(-1 * (var(--panel-r-w) + var(--inset) - 3.5rem)));
      opacity: 0;
    }
    .boot {
      position: absolute;
      inset: 0;
      z-index: var(--z-modal);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--sp-3);
      background: var(--c-app);
      color: var(--c-text-3);
    }
    .boot-bar {
      position: relative;
      width: 12rem;
      height: 2px;
      background: var(--c-line);
      overflow: hidden;
      i {
        position: absolute;
        inset: 0;
        width: 40%;
        background: var(--c-accent);
        animation: slide 1.1s var(--ease) infinite;
      }
    }
    @keyframes slide {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(250%);
      }
    }
    @keyframes in-left {
      from {
        transform: translateX(-12px);
        opacity: 0;
      }
    }
    @media (max-width: 1279px) {
      :host {
        --panel-l-w: 17.5rem;
        --panel-r-w: 20rem;
      }
    }
  `,
})
export class OpsShell {
  protected readonly store = inject(OpsStore);
  protected readonly sensors = inject(SensorStore);
  protected readonly icons = { PanelLeft };
  protected readonly rightOpen = computed(
    () => !!this.store.selectedId() || !!this.store.selectedTrackId() || (this.store.rightPanel() === 'SENSOR' && this.sensors.feeds().length > 0),
  );

  protected focusMap(e: Event): void {
    e.preventDefault();
    (document.querySelector('.maplibregl-canvas') as HTMLElement | null)?.focus();
  }

  private readonly autopilot = inject(AutopilotService);

  constructor() {
    inject(RoleService);
    // ?autoplay → scripted 2-minute operator session (video capture), once the map is up.
    if (new URLSearchParams(location.search).has('autoplay')) {
      const stop = effect(() => {
        if (!this.store.mapReady()) return;
        stop.destroy();
        setTimeout(() => void this.autopilot.run(), 2500);
      });
    }
    // Feed + alert stores must subscribe before the engine emits its first events.
    inject(EventFeedStore);
    inject(AlertStore);
    const sim = inject(SimHost);
    sim.start(sim.scenarioId(), sim.fleetSize());
    if (isDevMode()) (globalThis as Record<string, unknown>)['__suuarm'] = { sim, store: this.store, sensors: this.sensors, story: inject(StoryService), autopilot: this.autopilot };
  }
}
