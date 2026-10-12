import { inject, Injectable, signal } from '@angular/core';
import { easeInOutCubic } from '../../core/domain/geometry';
import { AlertStore } from '../../core/state/alert.store';
import { MissionStore } from '../../core/state/mission.store';
import { OpsStore } from '../../core/state/ops-store';
import { RoleService } from '../../core/state/role.service';
import { SensorStore } from '../../core/state/sensor.store';
import { SimHost } from '../../core/state/sim-host.service';
import { MapService } from '../../map/map.service';

export interface Caption {
  kicker: string;
  text: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const CAMPUS: [number, number] = [54.4146, 24.4954];

/**
 * Autopilot: a ~2 minute scripted operator session for video capture. A visible cursor moves to the
 * real controls and clicks them; the system responds exactly as it would to a person. Deterministic
 * seed + scripted inputs ⇒ every take is the same.
 */
@Injectable({ providedIn: 'root' })
export class AutopilotService {
  private readonly sim = inject(SimHost);
  private readonly ops = inject(OpsStore);
  private readonly sensors = inject(SensorStore);
  private readonly missions = inject(MissionStore);
  private readonly alerts = inject(AlertStore);
  private readonly map = inject(MapService);
  private readonly roles = inject(RoleService);

  readonly running = signal(false);
  readonly cursor = signal({ x: -100, y: -100, visible: false, down: false });
  readonly ripple = signal<{ x: number; y: number; id: number } | null>(null);
  readonly caption = signal<Caption | null>(null);
  readonly card = signal<'title' | 'end' | null>(null);
  readonly timelapse = signal<number | null>(null);
  private cancelled = false;
  private rippleSeq = 0;
  private captionSeq = 0;

  stop(): void {
    this.cancelled = true;
    this.running.set(false);
    this.clearCaption();
    this.card.set(null);
    this.timelapse.set(null);
    this.cursor.set({ ...this.cursor(), visible: false });
    this.sim.speed.set(1);
  }

  // ───────────────────────────── primitives

  private async wait(ms: number): Promise<void> {
    await sleep(ms);
    if (this.cancelled) throw new Error('autopilot-cancelled');
  }

  /** Clear first, then set on the next task, so the caption re-mounts and its entry animation replays. */
  private say(kicker: string, text: string): void {
    const seq = ++this.captionSeq;
    this.caption.set(null);
    setTimeout(() => seq === this.captionSeq && this.caption.set({ kicker, text }), 30);
  }

  private clearCaption(): void {
    this.captionSeq++;
    this.caption.set(null);
  }

  /** Hand the camera back from FOLLOW / POV and wait for the release blend, so a following flyTo isn't overridden. */
  private async releaseCamera(): Promise<void> {
    // Keep the selection until the release ends so the controller pulls back from the aircraft.
    this.ops.cameraMode.set('FREE_3D');
    const t0 = performance.now();
    await this.wait(60);
    while (this.map.camera?.isDriving && performance.now() - t0 < 8000) await this.wait(80);
    this.ops.select(null);
  }

  /** Clear the fleet search the way an operator would leave it after a drill-down. */
  private clearSearch(): void {
    const e = this.el('app-fleet-panel .search input') as HTMLInputElement | null;
    if (!e || !e.value) return;
    e.value = '';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.blur();
  }

  private el(selector: string, text?: string): HTMLElement | null {
    const all = [...document.querySelectorAll<HTMLElement>(selector)];
    const hit = text ? all.find((e) => e.textContent?.replace(/\s+/g, ' ').trim().toLowerCase().includes(text.toLowerCase())) : all[0];
    return hit ?? null;
  }

  /** Move the operator cursor smoothly to a point. */
  private async moveTo(x: number, y: number, ms?: number): Promise<void> {
    const c = this.cursor();
    const from = c.visible ? { x: c.x, y: c.y } : { x: innerWidth * 0.62, y: innerHeight * 0.66 };
    const d = Math.hypot(x - from.x, y - from.y);
    const dur = ms ?? Math.min(1100, 380 + d * 0.75);
    const t0 = performance.now();
    // Slight arc so the motion reads as a hand, not a robot.
    const bend = Math.min(60, d * 0.08);
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        if (this.cancelled) return resolve();
        const t = Math.min(1, (now - t0) / dur);
        const u = easeInOutCubic(t);
        const arc = Math.sin(Math.PI * u) * bend;
        this.cursor.set({ x: from.x + (x - from.x) * u, y: from.y + (y - from.y) * u - arc, visible: true, down: false });
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  private async moveToEl(selector: string, text?: string, dx = 0, dy = 0): Promise<HTMLElement | null> {
    const e = this.el(selector, text);
    if (!e) {
      console.warn('[autopilot] target not found:', selector, text ?? '');
      return null;
    }
    const r = e.getBoundingClientRect();
    await this.moveTo(r.left + r.width / 2 + dx, r.top + r.height / 2 + dy);
    return e;
  }

  private async press(): Promise<void> {
    const c = this.cursor();
    this.cursor.set({ ...c, down: true });
    this.ripple.set(null);
    const id = ++this.rippleSeq;
    setTimeout(() => this.rippleSeq === id && this.ripple.set({ x: c.x, y: c.y, id }), 16);
    await this.wait(140);
    this.cursor.set({ ...this.cursor(), down: false });
  }

  /** Move to a control and click it for real. */
  private async click(selector: string, text?: string, pause = 280): Promise<boolean> {
    const e = await this.moveToEl(selector, text);
    if (!e) return false;
    await this.wait(pause);
    await this.press();
    e.click();
    return true;
  }

  private async type(selector: string, value: string): Promise<void> {
    const e = this.el(selector) as HTMLInputElement | null;
    if (!e) return;
    e.focus();
    for (let i = 1; i <= value.length; i++) {
      e.value = value.slice(0, i);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      await this.wait(110);
    }
  }

  /** Screen position of a vehicle (uses the live deck viewport so altitude is respected). */
  private vehicleScreen(id: string): { x: number; y: number } | null {
    const rv = this.map.loop?.frame.vehicles.find((v) => v.id === id);
    const map = this.map.engine?.map;
    if (!rv || !map) return null;
    const rect = map.getCanvas().getBoundingClientRect();
    const deck = (this.map.engine!.overlay as unknown as { _deck?: { getViewports(): { project(p: number[]): number[] }[] } })._deck;
    const vp = deck?.getViewports()[0];
    const p = vp ? vp.project([rv.position[0], rv.position[1], rv.position[2]]) : (() => {
      const q = map.project([rv.position[0], rv.position[1]]);
      return [q.x, q.y];
    })();
    return { x: rect.left + p[0], y: rect.top + p[1] };
  }

  private fly(center: [number, number], zoom: number, pitch: number, bearing: number, duration = 2200): void {
    this.map.engine?.map.flyTo({ center, zoom, pitch, bearing, duration, essential: true });
  }

  private sliceDone(id: string): number {
    const e = this.sim.engine;
    const v = e.byId.get(id);
    const t = v?.taskId ? e.missions.tasks.get(v.taskId) : undefined;
    const s = t ? e.missions.sectors.get(t.sectorId) : undefined;
    if (!t || !s?.facade) return t ? 0 : 1;
    const g = s.facade;
    const [u0, u1] = t.slice ?? [0, 1];
    let n = 0;
    let d = 0;
    for (let r = 0; r < g.rows; r++)
      for (let c = Math.floor(u0 * g.cols); c < Math.ceil(u1 * g.cols); c++) {
        n++;
        d += g.cells[r * g.cols + c];
      }
    return n ? d / n : 1;
  }

  // ───────────────────────────── the session

  async run(): Promise<void> {
    if (this.running()) return;
    this.cancelled = false;
    this.running.set(true);
    try {
      await this.script();
    } catch (e) {
      if ((e as Error).message !== 'autopilot-cancelled') console.error(e);
    } finally {
      this.running.set(false);
      this.clearCaption();
      this.timelapse.set(null);
      this.cursor.set({ ...this.cursor(), visible: false });
      this.sim.speed.set(1);
    }
  }

  private async script(): Promise<void> {
    // ── 0:00 Title
    this.roles.role.set('OPERATOR');
    this.sim.speed.set(1);
    this.sim.start('building-scan', 50);
    this.ops.viewDim.set('2D');
    this.ops.leftCollapsed.set(false);
    this.ops.leftTab.set('FLEET');
    this.ops.select(null);
    this.ops.layers.set({ ...this.ops.layers(), links: false, labels: true });
    this.card.set('title');
    this.fly([54.4205, 24.4962], 14.9, 0, 0, 10);
    await this.wait(3600);
    this.card.set(null);
    this.say('Building Scan · Al Reem, Abu Dhabi', 'Swarm READY — 50 assets available across Ops Base Alpha');
    await this.wait(3200);

    // ── 3D
    this.say('Operational picture', 'Switch to 3D: terrain, structures, altitude and heading');
    await this.click('app-map-toolbar .dim button', '3D');
    await this.wait(250);
    this.fly(CAMPUS, 16.5, 60, -38, 2600);
    await this.wait(3400);

    // ── Intent
    this.say('Mission intent', 'The operator defines the outcome — not flight paths');
    await this.click('.swarm-toggle');
    await this.wait(900);
    await this.moveToEl('app-mission-panel select', undefined);
    await this.wait(700);
    await this.click('app-mission-panel .seg button', 'HIGH');
    await this.wait(400);
    await this.moveToEl('app-mission-panel .chips');
    await this.wait(600);
    this.say('SuuarmOS plans', 'Evaluate fleet · divide the building · allocate 12 assets · generate routes');
    await this.click('app-mission-panel button', 'Generate plan');
    this.fly([54.4162, 24.4956], 16.1, 58, -50, 2600);
    await this.wait(4200);

    // ── Start
    this.say('Execute', 'START MISSION — swarm READY → ACTIVE');
    await this.click('.swarm-toggle', 'START MISSION', 400);
    await this.wait(1800);
    this.cursor.set({ ...this.cursor(), visible: false });

    // ── Time-lapse approach
    this.say('Autonomous execution', 'Assets launch and route to roof, facades and perimeter');
    this.sim.speed.set(8);
    this.timelapse.set(8);
    this.fly([54.4178, 24.4958], 15.7, 56, -62, 3000);
    await this.wait(9000);
    this.sim.fastForward(1200, (e) => e.byId.get('UAV-021')?.phase === 'ON_TASK');
    this.sim.speed.set(1);
    this.timelapse.set(null);
    this.fly(CAMPUS, 16.9, 62, -60, 2000);
    await this.wait(2200);

    // ── Select + follow UAV-021
    this.say('Drill down', 'Find UAV-021 in the fleet');
    await this.click('app-fleet-panel .tabs button', 'Fleet');
    await this.wait(300);
    await this.moveToEl('app-fleet-panel .search input');
    await this.press();
    await this.type('app-fleet-panel .search input', '021');
    await this.wait(500);
    await this.click('app-fleet-panel .row', 'UAV-021');
    await this.wait(900);
    this.say('Follow', 'Camera follows UAV-021 on the east facade');
    await this.click('app-map-toolbar .tb', 'Follow');
    await this.wait(2600);

    // ── Sensor geometry
    const cam = this.map.camera;
    if (cam) {
      cam.follow.bearingOffset = 64;
      cam.follow.distance = 46;
      cam.follow.height = 16;
    }
    this.say('Sensor', 'Open the payload — its cone and footprint land on the facade');
    await this.click('app-asset-panel .act', 'Sensor');
    await this.wait(3800);

    // ── POV
    this.say('Sensor POV', 'Step into the payload — the map becomes the camera view');
    await this.click('app-sensor-panel .btn', 'Sensor POV');
    await this.wait(4600);
    this.say('Thermal', 'Same geometry in thermal — hot rooftop plant, cool glazing');
    await this.click('app-pov-hud .bar .seg button', 'THERMAL');
    await this.wait(4200);
    await this.click('app-pov-hud .bar .seg button', 'EO');
    await this.wait(1800);
    this.say('Back to the picture', 'Return to the tactical map');
    await this.click('app-pov-hud .b.primary');
    if (cam) {
      cam.follow.bearingOffset = 0;
      cam.follow.distance = 26;
      cam.follow.height = 9;
    }
    await this.wait(2200);
    await this.releaseCamera();
    this.clearSearch();
    while (this.sensors.feeds().length) this.sensors.closeFeed(0);
    this.fly(CAMPUS, 16.7, 58, -40, 1800);
    await this.wait(2200);

    // ── Failure
    const victim = ['UAV-007', 'UAV-003', 'UAV-029', 'UAV-030', 'UAV-033', 'UAV-001'].find(
      (id) => this.sim.engine.byId.get(id)?.taskId && this.sliceDone(id) < 0.75,
    ) ?? 'UAV-007';
    this.sim.dispatch({ type: 'LINK_LOST', vehicleId: victim });
    this.say('Resilience', `${victim} C2 link lost — its task is released`);
    await this.wait(1600);
    const p = this.vehicleScreen(victim);
    if (p) await this.moveTo(p.x, p.y);
    await this.wait(1800);
    const rec = this.alerts.pending()[0];
    this.say('Supervised autonomy', `SuuarmOS evaluates the fleet and recommends ${rec?.toIds[0] ?? 'a replacement'}`);
    await this.moveToEl('app-recommendation-card .why');
    await this.wait(2200);
    await this.click('app-recommendation-card .btn.primary', undefined, 500);
    const to = rec?.toIds[0] ?? 'UAV-031';
    this.say('Approved', `${to} READY → ACTIVE — new route, the mission continues`);
    await this.wait(1200);
    this.ops.select(to);
    this.ops.cameraMode.set('FOLLOW_VEHICLE');
    await this.wait(4200);

    // ── Scale
    await this.releaseCamera();
    this.say('Fleet at scale', 'Zoom out — clusters summarise state, exceptions stand out');
    await this.wait(900);
    this.fly([54.405, 24.47], 12.2, 45, -12, 3200);
    await this.wait(4800);

    // ── Second scenario
    this.say('Same core, different mission', 'Switch scenario: Airspace Response');
    await this.click('app-command-bar .scenario');
    await this.wait(700);
    await this.click('app-command-bar .menu button', 'Airspace Response');
    await this.wait(400);
    this.sim.fastForward(210, (e) => e.response.tracks.some((t) => t.status === 'CLASSIFIED'));
    this.ops.selectTrack('T-0417');
    this.fly([54.383, 24.524], 14.6, 55, 30, 2400);
    await this.wait(2600);
    this.say('Track classified', 'Non-cooperative small UAS — SuuarmOS proposes a response group');
    await this.moveToEl('app-recommendation-card .chips');
    await this.wait(1800);
    await this.click('app-recommendation-card .btn.primary', undefined, 400);
    this.say('Coordinated response', 'Assets READY → ACTIVE — escort formation, observe and report');
    this.sim.speed.set(3);
    this.timelapse.set(3);
    await this.wait(1500);
    this.cursor.set({ ...this.cursor(), visible: false });
    await this.wait(7500);
    this.sim.fastForward(1500, (e) => e.response.tracks.every((t) => t.status === 'RESOLVED'));
    this.sim.speed.set(1);
    this.timelapse.set(null);
    this.say('Resolved', 'TRACK RESOLVED — response group returns to READY');
    await this.wait(3200);

    // ── End card
    this.clearCaption();
    this.card.set('end');
    await this.wait(5200);
    this.card.set(null);
  }
}
