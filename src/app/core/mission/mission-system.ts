import { dist2, pointInRing, Vec2, Vec3 } from '../domain/geometry';
import { AlertKind, AutonomyMode, FocusRef, Recommendation, Severity, SwarmMode } from '../domain/ops';
import { GroundField, Mission, MissionIntent, PlanStats, Priority, Sector, Task } from '../domain/mission';
import { SensorType } from '../domain/sensor';
import { Route, Vehicle, Waypoint } from '../domain/vehicle';
import { Prism, solveSensor } from '../sensor/sensor-geometry';
import { bounds, coverageLanes, pointInQuad, ringArea, ringCentroid, sliceRing } from './polygon';
import { Campus } from '../world/campus';
import { facadeUV, planBuilding, roofUV } from './building-planner';
import { castRay, sensorBasis } from '../sensor/sensor-geometry';

/** What the mission system needs from the simulation (keeps it independent and testable). */
export interface MissionHost {
  readonly tick: number;
  readonly vehicles: Vehicle[];
  readonly byId: Map<string, Vehicle>;
  readonly prisms: Prism[];
  readonly campus: Campus | null;
  readonly hubs: { id: string; pos: Vec3 }[];
  readonly cruiseAlt: number;
  emit(severity: Severity, text: string, focus: FocusRef | null): void;
  raise(kind: AlertKind, severity: Severity, title: string, detail: string, focus: FocusRef | null): void;
  launch(v: Vehicle, route: Route, delayTicks: number): void;
  sendHome(v: Vehicle, msg: string | null): void;
  setSwarm(mode: SwarmMode): void;
}

export interface Candidate {
  vehicle: Vehicle;
  cost: number;
  distM: number;
  etaS: number;
  rationale: string[];
}

const SECTORS_BY_PRIORITY: Record<Priority, number> = { LOW: 2, NORMAL: 3, HIGH: 5, CRITICAL: 7 };
const SECTOR_CODES = 'ABCDEFGHIJKL';

/**
 * Mission engine: converts operator intent into fleet tasking.
 *   evaluate fleet → select capable assets → divide area → allocate tasks → generate routes → present plan
 * then executes it: tracks task/sector state, sensor coverage and mission progress.
 */
export class MissionSystem {
  readonly missions: Mission[] = [];
  readonly sectors = new Map<string, Sector>();
  readonly tasks = new Map<string, Task>();
  /** Bumps on any state/coverage change (render memo key). */
  version = 0;
  readonly recommendations: Recommendation[] = [];
  autonomy: AutonomyMode = 'SUPERVISED';
  /** Hook for group recommendations (aerial response). */
  onGroupApproved: (rec: Recommendation) => void = () => {};
  private seq = 0;
  private recSeq = 0;

  nextId(): string {
    return `M-${String(++this.seq).padStart(2, '0')}`;
  }

  nextRecId(): string {
    return `REC-${++this.recSeq}`;
  }

  /** Register an externally planned mission (e.g. response group) with the shared mission core. */
  register(m: Mission, sectors: Sector[], tasks: Task[]): void {
    for (const x of this.missions) if (x.status === 'PLANNED') this.discard(x);
    this.missions.push(m);
    for (const s of sectors) this.sectors.set(s.id, s);
    for (const t of tasks) this.tasks.set(t.id, t);
    this.version++;
  }
  private milestones = new Map<string, number>();

  constructor(private readonly host: MissionHost) {}

  get active(): Mission | undefined {
    return this.missions.find((m) => m.status === 'ACTIVE');
  }

  get planned(): Mission | undefined {
    return this.missions.find((m) => m.status === 'PLANNED');
  }

  missionOf(v: Vehicle): Mission | undefined {
    return v.missionId ? this.missions.find((m) => m.id === v.missionId) : undefined;
  }

  // ───────────────────────────────────────── candidate evaluation

  /** Capable, available assets ranked for work near `near` (lower cost = better). */
  candidates(required: SensorType[], near: Vec2, exclude: Set<string> = new Set()): Candidate[] {
    const out: Candidate[] = [];
    for (const v of this.host.vehicles) {
      if (exclude.has(v.id) || v.missionId) continue;
      if (v.opState !== 'READY' || v.phase !== 'PARKED') continue;
      if (!required.every((t) => v.payloads.some((p) => p.type === t && p.status !== 'FAULT'))) continue;
      if (v.battery < 0.45 || v.link.quality < 0.5) continue;
      const d = dist2(v.pos, near);
      if (d > 9000) continue;
      const eta = d / v.platform.cruiseSpeed + 12;
      let cost = eta + (1 - v.battery) * 400;
      if (v.capability === 'ISR' || v.capability === 'THERMAL') cost -= 15;
      if (v.capability === 'MAPPING' && required.length === 1) cost -= 25;
      out.push({
        vehicle: v,
        cost,
        distM: d,
        etaS: eta,
        rationale: [
          `${(d / 1000).toFixed(2)} km · ETA ${Math.round(eta)} s`,
          `Battery ${Math.round(v.battery * 100)}% · ${Math.round(v.battery / v.drainPerSec / 60)} min`,
          `${v.payloads.map((p) => p.type).join(' + ')} payload`,
          `Link ${Math.round(v.link.quality * 100)}%`,
        ],
      });
    }
    return out.sort((a, b) => a.cost - b.cost);
  }

  // ───────────────────────────────────────── planning

  plan(intent: MissionIntent): Mission | null {
    if (intent.area.length < 3) return null;
    for (const m of this.missions) if (m.status === 'PLANNED') this.discard(m);

    const id = this.nextId();
    const centroid = ringCentroid(intent.area);
    const evaluated = this.host.vehicles.filter((v) => v.opState !== 'OFFLINE').length;
    const pool = this.candidates(intent.requiredSensors, centroid);

    if (intent.type === 'BUILDING_SCAN') return this.planBuildingScan(intent, id, evaluated, pool);

    const area = ringArea(intent.area);
    const k = Math.max(1, Math.min(SECTORS_BY_PRIORITY[intent.priority], Math.floor(area / 9000) || 1, Math.max(1, pool.length)));
    const rings = sliceRing(intent.area, k);
    const alt = intent.altitude ?? this.host.cruiseAlt;
    const hfov = Math.min(...intent.requiredSensors.map((t) => (t === 'THERMAL' ? 50 : t === 'IR' ? 48 : 62)), 62);
    const swath = 2 * alt * Math.tan(((hfov / 2) * Math.PI) / 180);
    const spacing = Math.max(18, swath * 0.7);

    const mission: Mission = {
      id,
      code: id,
      intent,
      status: 'PLANNED',
      sectorIds: [],
      taskIds: [],
      field: null,
      stats: { evaluated, capable: pool.length, sectors: rings.length, assigned: 0, routeKm: 0, etaMin: 0 },
      createdTick: this.host.tick,
      startedTick: null,
      completedTick: null,
      progress: 0,
    };

    const sectors: Sector[] = rings.map((ring, i) => ({
      id: `${id}-S${SECTOR_CODES[i]}`,
      missionId: id,
      index: i,
      name: `SECTOR ${SECTOR_CODES[i]}`,
      code: SECTOR_CODES[i],
      kind: 'AREA',
      state: 'UNASSIGNED',
      ring,
      total: 0,
      scanned: 0,
      requiredSensors: intent.requiredSensors,
    }));

    const tasks: Task[] = sectors.map((s) => {
      const lanes = coverageLanes(s.ring, spacing);
      const waypoints: Waypoint[] = [{ x: lanes[0].x, y: lanes[0].y, z: alt }, ...lanes.map((p) => ({ x: p.x, y: p.y, z: alt, speed: 8, tilt: -90 }))];
      return {
        id: `${s.id}-T`,
        missionId: id,
        sectorId: s.id,
        name: `Survey ${s.name.toLowerCase().replace('sector', 'sector')}`,
        state: 'UNASSIGNED',
        vehicleId: null,
        capability: [],
        route: { id: `${s.id}-route`, waypoints, loop: false },
        workStart: 1,
        progress: 0,
        rationale: [],
        assignedTick: this.host.tick,
      };
    });

    this.allocate(tasks, sectors, pool);
    mission.field = this.buildField(intent.area, sectors);
    mission.sectorIds = sectors.map((s) => s.id);
    mission.taskIds = tasks.map((t) => t.id);
    mission.stats = this.stats(mission, tasks, pool.length, evaluated);

    this.missions.push(mission);
    for (const s of sectors) this.sectors.set(s.id, s);
    for (const t of tasks) this.tasks.set(t.id, t);
    this.version++;
    this.host.emit(
      'INFO',
      `${mission.code} ${intent.name} planned · ${sectors.length} sectors · ${mission.stats.assigned} assets`,
      { kind: 'mission', id },
    );
    return mission;
  }

  private planBuildingScan(intent: MissionIntent, id: string, evaluated: number, pool: Candidate[]): Mission | null {
    const campus = this.host.campus;
    if (!campus) return null;
    const b = campus.buildings.find((x) => x.id === intent.targetBuildingId) ?? campus.target;
    const plan = planBuilding(id, intent, b, this.host.tick);
    const sectorOf = new Map(plan.sectors.map((s) => [s.id, s]));
    this.allocate(plan.tasks, plan.tasks.map((t) => sectorOf.get(t.sectorId)!), pool);
    const mission: Mission = {
      id,
      code: id,
      intent: { ...intent, area: plan.groundRing, targetBuildingId: b.id },
      status: 'PLANNED',
      sectorIds: plan.sectors.map((s) => s.id),
      taskIds: plan.tasks.map((t) => t.id),
      field: null,
      stats: { evaluated, capable: pool.length, sectors: plan.sectors.length, assigned: 0, routeKm: 0, etaMin: 0 },
      createdTick: this.host.tick,
      startedTick: null,
      completedTick: null,
      progress: 0,
    };
    const ground = plan.sectors.find((s) => s.kind === 'GROUND')!;
    mission.field = this.buildField(plan.groundRing, [ground], plan.footprint, ground.index);
    mission.stats = this.stats(mission, plan.tasks, pool.length, evaluated);
    this.missions.push(mission);
    for (const s of plan.sectors) this.sectors.set(s.id, s);
    for (const t of plan.tasks) this.tasks.set(t.id, t);
    this.version++;
    this.host.emit('INFO', `${mission.code} ${intent.name} planned · ${b.name} divided into ${plan.sectors.length} sectors`, { kind: 'mission', id });
    this.host.emit('INFO', `${mission.stats.assigned} capable assets selected (${intent.requiredSensors.join(' + ')})`, { kind: 'mission', id });
    return mission;
  }

  /** Greedy global assignment over the (task × candidate) cost matrix. */
  allocate(tasks: Task[], sectors: Sector[], pool: Candidate[]): void {
    const pairs: { t: Task; s: Sector; c: Candidate; cost: number }[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const sec = sectors[i];
      const cen = sec.wall
        ? { x: (sec.wall.a.x + sec.wall.b.x) / 2 + sec.wall.normal.x * 20, y: (sec.wall.a.y + sec.wall.b.y) / 2 + sec.wall.normal.y * 20 }
        : ringCentroid(sec.ring);
      for (const c of pool) {
        const d = dist2(c.vehicle.pos, cen);
        pairs.push({ t: tasks[i], s: sectors[i], c, cost: c.cost + d / c.vehicle.platform.cruiseSpeed });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const usedV = new Set<string>();
    for (const p of pairs) {
      if (p.t.vehicleId || usedV.has(p.c.vehicle.id)) continue;
      p.t.vehicleId = p.c.vehicle.id;
      p.t.state = 'ASSIGNED';
      p.t.capability = [p.c.vehicle.capability];
      p.t.rationale = p.c.rationale;
      p.t.assignedTick = this.host.tick;
      p.s.state = 'ASSIGNED';
      usedV.add(p.c.vehicle.id);
    }
  }

  private stats(m: Mission, tasks: Task[], capable: number, evaluated: number): PlanStats {
    let km = 0;
    let eta = 0;
    for (const t of tasks) {
      const v = t.vehicleId ? this.host.byId.get(t.vehicleId) : undefined;
      let d = 0;
      let prev: Vec2 = v?.pos ?? t.route.waypoints[0];
      for (const w of t.route.waypoints) {
        d += dist2(prev, w);
        prev = w;
      }
      km += d / 1000;
      if (v) eta = Math.max(eta, d / Math.min(9, v.platform.cruiseSpeed) / 60);
    }
    return { evaluated, capable, sectors: tasks.length, assigned: tasks.filter((t) => t.vehicleId).length, routeKm: km, etaMin: eta };
  }

  private buildField(area: Vec2[], sectors: Sector[], hole: Vec2[] | null = null, fixedIndex: number | null = null): GroundField {
    const cell = 12;
    const b = bounds(area);
    const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cell));
    const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / cell));
    const sector = new Int16Array(cols * rows).fill(-1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = { x: b.minX + (c + 0.5) * cell, y: b.minY + (r + 0.5) * cell };
        if (!pointInRing(p, area)) continue;
        if (hole && pointInRing(p, hole)) continue;
        if (fixedIndex !== null) {
          sector[r * cols + c] = fixedIndex;
          sectors[0].total++;
          continue;
        }
        const si = sectors.findIndex((s) => pointInRing(p, s.ring));
        const idx = si >= 0 ? si : nearestSector(p, sectors);
        sector[r * cols + c] = idx;
        sectors[idx].total++;
      }
    }
    return { cell, x0: b.minX, y0: b.minY, cols, rows, sector, scanned: new Uint8Array(cols * rows) };
  }

  private discard(m: Mission): void {
    m.status = 'ABORTED';
    for (const id of m.taskIds) this.tasks.delete(id);
    for (const id of m.sectorIds) this.sectors.delete(id);
    this.missions.splice(this.missions.indexOf(m), 1);
    this.version++;
  }

  // ───────────────────────────────────────── execution

  start(missionId: string): boolean {
    const m = this.missions.find((x) => x.id === missionId && x.status === 'PLANNED');
    if (!m) return false;
    m.status = 'ACTIVE';
    m.startedTick = this.host.tick;
    let i = 0;
    for (const tid of m.taskIds) {
      const t = this.tasks.get(tid)!;
      const v = t.vehicleId ? this.host.byId.get(t.vehicleId) : undefined;
      if (!v) continue;
      v.missionId = m.id;
      v.taskId = t.id;
      this.host.launch(v, t.route, i * 8);
      i++;
    }
    this.host.setSwarm('ACTIVE');
    this.host.emit('INFO', `${m.code} ${m.intent.name} started`, { kind: 'mission', id: m.id });
    this.host.emit('INFO', `${i} assets assigned · launching from pads`, { kind: 'mission', id: m.id });
    this.version++;
    return true;
  }

  abort(missionId: string): void {
    const m = this.missions.find((x) => x.id === missionId);
    if (!m) return;
    if (m.status === 'PLANNED') {
      this.discard(m);
      return;
    }
    m.status = 'ABORTED';
    for (const tid of m.taskIds) {
      const t = this.tasks.get(tid);
      const v = t?.vehicleId ? this.host.byId.get(t.vehicleId) : undefined;
      if (v) this.releaseVehicle(v, true);
    }
    this.host.emit('WARNING', `${m.code} aborted by operator · assets returning`, { kind: 'mission', id: m.id });
    this.version++;
  }

  releaseVehicle(v: Vehicle, rtb: boolean): void {
    v.missionId = null;
    v.taskId = null;
    if (rtb) this.host.sendHome(v, null);
  }

  step(): void {
    const m = this.active;
    if (!m || m.intent.type === 'AERIAL_RESPONSE') return;
    this.checkDelays(m);
    const scanEvery = 2;
    for (const tid of m.taskIds) {
      const t = this.tasks.get(tid)!;
      const s = this.sectors.get(t.sectorId)!;
      const v = t.vehicleId ? this.host.byId.get(t.vehicleId) : undefined;
      if (!v || v.taskId !== t.id) continue;

      if (t.state === 'ASSIGNED' && v.route === t.route && v.routeIndex > t.workStart && (v.phase === 'TRANSIT' || v.phase === 'ON_TASK')) {
        t.state = 'ACTIVE';
        if (s.state !== 'SCANNED') s.state = 'ACTIVE';
        this.host.emit('INFO', `${v.id} entered ${s.name}`, { kind: 'vehicle', id: v.id });
        this.version++;
      }
      if (t.state === 'ACTIVE') {
        if (v.phase === 'TRANSIT') v.phase = 'ON_TASK';
        if (this.host.tick % scanEvery === 0) this.scan(m, v);
        const n = t.route.waypoints.length;
        t.progress = n ? Math.min(1, v.routeIndex / n) : 1;
        if (v.phase === 'HOLD' && v.opState === 'ACTIVE' && v.route === t.route && v.routeIndex >= t.route.waypoints.length - 1) this.completeTask(m, t, s, v);
      }
    }
    this.updateProgress(m);
  }

  private sliceCoverage(s: Sector, t: Task): number {
    if (!s.facade) return s.total ? s.scanned / s.total : 0;
    const g = s.facade;
    const [u0, u1] = t.slice ?? [0, 1];
    const c0 = Math.floor(u0 * g.cols);
    const c1 = Math.ceil(u1 * g.cols);
    let n = 0;
    let d = 0;
    for (let r = 0; r < g.rows; r++) {
      for (let c = c0; c < c1; c++) {
        n++;
        d += g.cells[r * g.cols + c];
      }
    }
    return n ? d / n : 1;
  }

  private completeTask(m: Mission, t: Task, s: Sector, v: Vehicle, release = true): void {
    t.state = 'COMPLETE';
    t.progress = 1;
    // Passes are planned with overlap: close out residual edge cells of this task's slice.
    const siblings = m.taskIds.map((id) => this.tasks.get(id)!).filter((x) => x.sectorId === s.id);
    const sectorDone = siblings.every((x) => x.state === 'COMPLETE');
    if (s.facade) {
      const g = s.facade;
      const [u0, u1] = t.slice ?? [0, 1];
      const c0 = Math.floor(u0 * g.cols);
      const c1 = Math.ceil(u1 * g.cols);
      for (let r = 0; r < g.rows; r++) {
        for (let c = c0; c < c1; c++) {
          const i = r * g.cols + c;
          if (!g.cells[i]) {
            g.cells[i] = 1;
            s.scanned++;
          }
        }
      }
    } else if (sectorDone && m.field) {
      const f = m.field;
      for (let i = 0; i < f.sector.length; i++) {
        if (f.sector[i] === s.index && !f.scanned[i]) {
          f.scanned[i] = 1;
          s.scanned++;
        }
      }
    }
    if (sectorDone) s.state = 'SCANNED';
    this.host.emit('INFO', sectorDone ? `${s.name} complete` : `${t.name} complete${release ? ` · ${v.id} returning` : ''}`, { kind: 'sector', id: s.id });
    if (release) this.releaseVehicle(v, true);
    this.version++;
  }

  private scan(m: Mission, v: Vehicle): void {
    if (m.intent.type === 'BUILDING_SCAN') return this.scanBuilding(m, v);
    const f = m.field;
    const p = v.payloads.find((x) => x.id === v.activePayloadId) ?? v.payloads[0];
    if (!f || !p || p.status === 'FAULT' || v.opState === 'OFFLINE') return;
    const sol = solveSensor(v.pos, v.heading, v.gimbal.pan, v.gimbal.tilt, p, this.host.prisms, 1);
    if (sol.corners.some((c) => c.surface !== 'ground')) return;
    const q = sol.corners.map((c) => ({ x: c.p.x, y: c.p.y }));
    const b = bounds(q);
    const c0 = Math.max(0, Math.floor((b.minX - f.x0) / f.cell));
    const c1 = Math.min(f.cols - 1, Math.floor((b.maxX - f.x0) / f.cell));
    const r0 = Math.max(0, Math.floor((b.minY - f.y0) / f.cell));
    const r1 = Math.min(f.rows - 1, Math.floor((b.maxY - f.y0) / f.cell));
    let changed = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * f.cols + c;
        const si = f.sector[i];
        if (si < 0 || f.scanned[i]) continue;
        if (!pointInQuad({ x: f.x0 + (c + 0.5) * f.cell, y: f.y0 + (r + 0.5) * f.cell }, q)) continue;
        f.scanned[i] = 1;
        const s = this.sectors.get(m.sectorIds[si]);
        if (s) s.scanned++;
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  /** Ray-grid through the sensor frustum; every hit marks the facade / roof / ground cell it lands on. */
  private scanBuilding(m: Mission, v: Vehicle): void {
    const p = v.payloads.find((x) => x.id === v.activePayloadId) ?? v.payloads[0];
    if (!p || p.status === 'FAULT' || v.opState === 'OFFLINE' || v.health.linkLost) return;
    const bid = m.intent.targetBuildingId!;
    const az = (v.heading + v.gimbal.pan + 360) % 360;
    const { f, r, u } = sensorBasis(az, v.gimbal.tilt);
    const hfov = p.hfov[p.fovMode];
    const th = Math.tan(((hfov / 2) * Math.PI) / 180);
    const tv = th / p.aspect;
    const origin = { x: v.pos.x, y: v.pos.y, z: Math.max(0.5, v.pos.z - 0.35) };
    const sectors = m.sectorIds.map((id) => this.sectors.get(id)!);
    const roof = sectors.find((s) => s.kind === 'ROOF');
    const ground = sectors.find((s) => s.kind === 'GROUND');
    let changed = false;
    const NX = 9;
    const NY = 6;
    for (let iy = 0; iy < NY; iy++) {
      for (let ix = 0; ix < NX; ix++) {
        const sx = -1 + (2 * (ix + 0.5)) / NX;
        const sy = -1 + (2 * (iy + 0.5)) / NY;
        const d = { x: f.x + r.x * sx * th + u.x * sy * tv, y: f.y + r.y * sx * th + u.y * sy * tv, z: f.z + r.z * sx * th + u.z * sy * tv };
        const l = Math.hypot(d.x, d.y, d.z);
        d.x /= l;
        d.y /= l;
        d.z /= l;
        const hit = castRay(origin, d, this.host.prisms, Math.min(p.rangeM, 140));
        if (hit.surface === 'sky') continue;
        if (hit.surface === 'ground') {
          const fld = m.field;
          if (!fld || !ground) continue;
          const c = Math.floor((hit.p.x - fld.x0) / fld.cell);
          const rr = Math.floor((hit.p.y - fld.y0) / fld.cell);
          if (c < 0 || rr < 0 || c >= fld.cols || rr >= fld.rows) continue;
          const i = rr * fld.cols + c;
          if (fld.sector[i] < 0 || fld.scanned[i]) continue;
          fld.scanned[i] = 1;
          ground.scanned++;
          changed = true;
          continue;
        }
        if (!hit.surface.startsWith(bid + ':')) continue;
        let s: Sector | undefined;
        let uv: [number, number] | null = null;
        if (hit.surface.endsWith(':roof')) {
          s = roof;
          uv = s ? roofUV(s.ring, hit.p) : null;
        } else {
          s = sectors.find((x) => x.wall && facadeUV(x, hit.p) && Math.abs(distToWall(x, hit.p)) < 0.6);
          uv = s ? facadeUV(s, hit.p) : null;
        }
        if (!s?.facade || !uv) continue;
        const g = s.facade;
        const i = Math.min(g.rows - 1, Math.floor(uv[1] * g.rows)) * g.cols + Math.min(g.cols - 1, Math.floor(uv[0] * g.cols));
        if (g.cells[i]) continue;
        g.cells[i] = 1;
        s.scanned++;
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  // ───────────────────────────────────────── resilience

  /** A vehicle can no longer work its task: release the task and propose a replacement. */
  releaseVehicleTask(v: Vehicle, reason: string): void {
    const t = v.taskId ? this.tasks.get(v.taskId) : undefined;
    if (!t || t.state === 'COMPLETE') {
      v.missionId = null;
      v.taskId = null;
      return;
    }
    const m = this.missions.find((x) => x.id === t.missionId);
    if (!m || m.status !== 'ACTIVE') return;
    const s = this.sectors.get(t.sectorId)!;
    // Nothing left to hand over: close the task instead of proposing a pointless reassignment.
    if (this.sliceCoverage(s, t) >= 0.95) {
      v.missionId = null;
      v.taskId = null;
      t.vehicleId = null;
      this.completeTask(m, t, s, v, false);
      return;
    }
    t.resumeIndex = v.route === t.route ? v.routeIndex : t.workStart;
    t.previousVehicleId = v.id;
    t.vehicleId = null;
    t.state = 'UNASSIGNED';
    t.releasedTick = this.host.tick;
    t.delayedAlerted = false;
    v.missionId = null;
    v.taskId = null;
    const siblingsActive = m.taskIds.some((id) => id !== t.id && this.tasks.get(id)!.sectorId === s.id && this.tasks.get(id)!.state === 'ACTIVE');
    if (s.state !== 'SCANNED' && !siblingsActive) s.state = 'UNASSIGNED';
    this.host.emit('WARNING', `Task released · ${t.name} (${reason})`, { kind: 'sector', id: s.id });
    this.version++;
    this.recommend(t);
  }

  private recommend(t: Task, exclude: Set<string> = new Set()): Recommendation | null {
    const m = this.missions.find((x) => x.id === t.missionId)!;
    const s = this.sectors.get(t.sectorId)!;
    const busy = new Set(
      m.taskIds
        .map((id) => this.tasks.get(id)!.vehicleId)
        .filter((x): x is string => !!x),
    );
    for (const e of exclude) busy.add(e);
    if (t.previousVehicleId) busy.add(t.previousVehicleId);
    const near = s.wall
      ? { x: (s.wall.a.x + s.wall.b.x) / 2 + s.wall.normal.x * 20, y: (s.wall.a.y + s.wall.b.y) / 2 + s.wall.normal.y * 20 }
      : ringCentroid(s.ring);
    const pool = this.candidates(s.requiredSensors, near, busy);
    for (const r of this.recommendations) if (r.taskId === t.id && r.status === 'PENDING') r.status = 'SUPERSEDED';
    if (!pool.length) {
      this.host.raise('MISSION_DELAYED', 'WARNING', `${m.code} delayed`, `No capable asset available for ${t.name}`, { kind: 'sector', id: s.id });
      return null;
    }
    const best = pool[0];
    const rec: Recommendation = {
      id: this.nextRecId(),
      kind: 'REASSIGN',
      title: `Reassign ${titleCase(t.name)}`,
      subject: t.name,
      missionId: m.id,
      taskId: t.id,
      fromId: t.previousVehicleId ?? null,
      toIds: [best.vehicle.id],
      rationale: [...best.rationale, `Resume at pass ${Math.max(1, (t.resumeIndex ?? 1) - t.workStart)} · ${Math.round(((s.scanned / Math.max(1, s.total)) * 100))}% of sector done`],
      alternatives: pool.slice(1, 3).map((c) => c.vehicle.id),
      confidence: Math.max(0.55, Math.min(0.97, 0.98 - best.cost / 900)),
      createdTick: this.host.tick,
      status: 'PENDING',
      decidedBy: null,
      focus: { kind: 'vehicle', id: best.vehicle.id },
    };
    this.recommendations.unshift(rec);
    if (this.recommendations.length > 40) this.recommendations.pop();
    this.host.emit('INFO', `SuuarmOS recommends ${best.vehicle.id} for ${t.name}`, { kind: 'vehicle', id: best.vehicle.id });
    this.version++;
    if (this.autonomy === 'AUTONOMOUS') this.approve(rec.id, 'AUTONOMY');
    return rec;
  }

  approve(recId: string, by: 'OPERATOR' | 'AUTONOMY' = 'OPERATOR'): boolean {
    const rec = this.recommendations.find((r) => r.id === recId);
    if (!rec || rec.status !== 'PENDING') return false;
    if (rec.kind === 'RESPONSE_GROUP') {
      rec.status = 'APPROVED';
      rec.decidedBy = by;
      this.host.emit('INFO', `${by === 'AUTONOMY' ? 'Autonomy' : 'Operator'} approved response group ${rec.toIds.join(', ')}`, rec.focus);
      this.onGroupApproved(rec);
      this.version++;
      return true;
    }
    const t = rec.taskId ? this.tasks.get(rec.taskId) : undefined;
    const v = this.host.byId.get(rec.toIds[0]);
    if (!t || !v || t.state !== 'UNASSIGNED' || v.missionId || v.opState === 'OFFLINE') {
      rec.status = 'SUPERSEDED';
      if (t && t.state === 'UNASSIGNED') this.recommend(t, new Set(rec.toIds));
      return false;
    }
    rec.status = 'APPROVED';
    rec.decidedBy = by;
    const wps = t.route.waypoints;
    const from = Math.min(wps.length - 1, Math.max(1, (t.resumeIndex ?? 1) - 1));
    t.route = { id: `${t.route.id}-r${(t.reassignments ?? 0) + 1}`, waypoints: [wps[0], ...wps.slice(from)], loop: false };
    t.workStart = Math.min(t.workStart, 1);
    t.reassignments = (t.reassignments ?? 0) + 1;
    t.vehicleId = v.id;
    t.state = 'ASSIGNED';
    t.assignedTick = this.host.tick;
    t.rationale = rec.rationale;
    const s = this.sectors.get(t.sectorId)!;
    if (s.state === 'UNASSIGNED') s.state = 'ASSIGNED';
    v.missionId = t.missionId;
    v.taskId = t.id;
    this.host.launch(v, t.route, 0);
    this.host.raise(
      'TASK_REASSIGNED',
      'INFO',
      'Task reassigned',
      `${titleCase(t.name)}: ${rec.fromId ?? '—'} → ${v.id}${by === 'AUTONOMY' ? ' (autonomous)' : ' (operator approved)'}`,
      { kind: 'vehicle', id: v.id },
    );
    this.host.emit('INFO', `${v.id} READY → ACTIVE · new route to ${s.name}`, { kind: 'vehicle', id: v.id });
    this.version++;
    return true;
  }

  reject(recId: string): void {
    const rec = this.recommendations.find((r) => r.id === recId);
    if (!rec || rec.status !== 'PENDING') return;
    rec.status = 'REJECTED';
    rec.decidedBy = 'OPERATOR';
    this.host.emit('INFO', `Operator rejected ${rec.toIds.join(', ')} for ${rec.subject}`, rec.focus);
    if (rec.kind === 'RESPONSE_GROUP') {
      const m = this.missions.find((x) => x.id === rec.missionId && x.status === 'PLANNED');
      if (m) this.discard(m);
      this.version++;
      return;
    }
    const t = rec.taskId ? this.tasks.get(rec.taskId) : undefined;
    if (t && t.state === 'UNASSIGNED') {
      const tried = new Set(this.recommendations.filter((r) => r.taskId === t.id).flatMap((r) => r.toIds));
      this.recommend(t, tried);
    }
    this.version++;
  }

  setAutonomy(mode: AutonomyMode): void {
    this.autonomy = mode;
    this.host.emit('INFO', `Autonomy level · ${mode === 'AUTONOMOUS' ? 'AUTONOMOUS reallocation' : 'SUPERVISED (operator approval)'}`, null);
    if (mode === 'AUTONOMOUS') for (const r of this.recommendations.filter((x) => x.status === 'PENDING')) this.approve(r.id, 'AUTONOMY');
  }

  /** Demo control: finish a sector instantly. */
  completeSector(sectorId?: string): void {
    const m = this.active;
    if (!m) return;
    const s = sectorId ? this.sectors.get(sectorId) : m.sectorIds.map((id) => this.sectors.get(id)!).find((x) => x.state !== 'SCANNED');
    if (!s) return;
    if (s.facade) {
      s.facade.cells.fill(1);
      s.scanned = s.total;
    } else if (m.field) {
      for (let i = 0; i < m.field.sector.length; i++) if (m.field.sector[i] === s.index) m.field.scanned[i] = 1;
      s.scanned = s.total;
    }
    for (const id of m.taskIds) {
      const t = this.tasks.get(id)!;
      if (t.sectorId !== s.id || t.state === 'COMPLETE') continue;
      t.state = 'COMPLETE';
      t.progress = 1;
      const v = t.vehicleId ? this.host.byId.get(t.vehicleId) : undefined;
      if (v && v.taskId === t.id) this.releaseVehicle(v, true);
    }
    this.version++;
  }

  completeMission(): void {
    const m = this.active;
    if (!m) return;
    for (const id of m.sectorIds) this.completeSector(id);
  }

  private checkDelays(m: Mission): void {
    for (const id of m.taskIds) {
      const t = this.tasks.get(id)!;
      if (t.state !== 'UNASSIGNED' || t.delayedAlerted || t.releasedTick === undefined) continue;
      if (this.host.tick - t.releasedTick < 450) continue;
      t.delayedAlerted = true;
      this.host.raise('MISSION_DELAYED', 'WARNING', `${m.code} delayed`, `${titleCase(t.name)} unassigned for ${Math.round((this.host.tick - t.releasedTick) / 10)} s`, { kind: 'sector', id: t.sectorId });
    }
  }

  private updateProgress(m: Mission): void {
    let total = 0;
    let done = 0;
    let allScanned = true;
    for (const sid of m.sectorIds) {
      const s = this.sectors.get(sid)!;
      total += s.total;
      done += s.scanned;
      if (s.state !== 'SCANNED') {
        if (s.total > 0 && s.scanned / s.total >= 0.985) {
          s.state = 'SCANNED';
          this.host.emit('INFO', `${s.name} complete`, { kind: 'sector', id: s.id });
          this.version++;
        } else allScanned = false;
      }
    }
    m.progress = total ? done / total : 0;
    const mark = Math.floor(m.progress * 4);
    if (mark > (this.milestones.get(m.id) ?? 0) && mark < 4) {
      this.milestones.set(m.id, mark);
      this.host.emit('INFO', `${m.code} ${m.intent.name} ${mark * 25}% complete`, { kind: 'mission', id: m.id });
    }
    if (allScanned) {
      m.status = 'COMPLETE';
      m.progress = 1;
      m.completedTick = this.host.tick;
      for (const tid of m.taskIds) {
        const t = this.tasks.get(tid)!;
        const v = t.vehicleId ? this.host.byId.get(t.vehicleId) : undefined;
        if (v && v.missionId === m.id) this.releaseVehicle(v, true);
      }
      this.host.setSwarm('READY');
      this.host.emit('INFO', `${m.code} ${m.intent.name} COMPLETE · fleet returning to READY`, { kind: 'mission', id: m.id });
      this.version++;
    }
  }
}

function nearestSector(p: Vec2, sectors: Sector[]): number {
  let best = 0;
  let bd = Infinity;
  sectors.forEach((s, i) => {
    const d = dist2(p, ringCentroid(s.ring));
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function distToWall(s: Sector, p: Vec3): number {
  const w = s.wall!;
  return (p.x - w.a.x) * w.normal.x + (p.y - w.a.y) * w.normal.y;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
