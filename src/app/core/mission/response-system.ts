import { angleDiff, bearingTo, clamp, DEG, dist2, dist3, Vec3, wrap360 } from '../domain/geometry';
import { Mission, Sector, Task } from '../domain/mission';
import { Recommendation, Track, TrackSpawn } from '../domain/ops';
import { Vehicle } from '../domain/vehicle';
import { GuidanceCmd } from '../sim/kinematics';
import { MissionHost, MissionSystem } from './mission-system';

/** Escort box relative to the track (forward, right, up) in metres. */
const SLOTS: { fwd: number; right: number; up: number; name: string }[] = [
  { fwd: -170, right: 0, up: 20, name: 'Trail' },
  { fwd: -40, right: -160, up: 0, name: 'Left wing' },
  { fwd: -40, right: 160, up: 0, name: 'Right wing' },
  { fwd: 90, right: 0, up: 55, name: 'High lead' },
];
const MONITOR_TICKS = 160;

/**
 * Aerial-response scenario logic on the same core: a track appears, the simulation classifies it,
 * SuuarmOS proposes a response group, the operator approves, assets form an observation/escort box
 * around the track until it leaves the protected zone. Purely C2 visualisation — no engagement logic.
 */
export class ResponseSystem {
  readonly tracks: Track[] = [];
  version = 0;

  constructor(
    private readonly host: MissionHost,
    private readonly missions: MissionSystem,
    private readonly zone: { center: Vec3; radius: number; name: string } | null,
  ) {
    missions.onGroupApproved = (rec) => this.approved(rec);
  }

  spawn(s: TrackSpawn): Track {
    const t: Track = {
      id: s.id,
      pos: { ...s.pos },
      heading: s.heading,
      speed: s.speed,
      climb: 0,
      cls: 'UNKNOWN',
      cooperative: false,
      confidence: 0.2,
      status: 'DETECTED',
      createdTick: this.host.tick,
      statusTick: this.host.tick,
      history: [{ ...s.pos }],
      missionId: null,
      monitoredTicks: 0,
    };
    this.tracks.push(t);
    this.host.raise('TRACK_DETECTED', 'WARNING', `New aerial track ${t.id}`, `Non-cooperative contact · ${Math.round(t.pos.z)} m · ${Math.round(t.speed * 1.944)} kt`, {
      kind: 'track',
      id: t.id,
    });
    this.version++;
    return t;
  }

  trackOf(id: string): Track | undefined {
    return this.tracks.find((t) => t.id === id);
  }

  step(): void {
    for (const t of this.tracks) {
      if (t.status === 'RESOLVED') continue;
      this.fly(t);
      this.classify(t);
      this.monitor(t);
    }
  }

  // ─────────────────────────────── track behaviour (scripted, deterministic)

  private fly(t: Track): void {
    const dt = 0.1;
    const z = this.zone;
    let desired = t.heading;
    if (z) {
      const d = dist2(t.pos, z.center);
      if (t.status === 'DEPARTING') desired = bearingTo(z.center, t.pos) + 8;
      else if (d > z.radius * 0.45) desired = bearingTo(t.pos, z.center);
      else desired = bearingTo(z.center, t.pos) + 95; // loiter inside the zone
    }
    const turn = clamp(angleDiff(t.heading, desired), -6 * dt, 6 * dt);
    t.heading = wrap360(t.heading + turn);
    const targetSpeed = t.status === 'DEPARTING' ? 19 : t.status === 'MONITORED' ? 11 : 14;
    t.speed += clamp(targetSpeed - t.speed, -1.2 * dt, 1.2 * dt);
    t.pos.x += Math.sin(t.heading * DEG) * t.speed * dt;
    t.pos.y += Math.cos(t.heading * DEG) * t.speed * dt;
    if ((this.host.tick - t.createdTick) % 10 === 0) {
      t.history.push({ ...t.pos });
      if (t.history.length > 90) t.history.shift();
      this.version++;
    }
  }

  private classify(t: Track): void {
    const age = this.host.tick - t.statusTick;
    if (t.status === 'DETECTED' && age > 25) {
      t.status = 'CLASSIFYING';
      t.statusTick = this.host.tick;
      this.host.emit('INFO', `${t.id} classification in progress · fusing radar + EO`, { kind: 'track', id: t.id });
      this.version++;
    } else if (t.status === 'CLASSIFYING') {
      t.confidence = Math.min(0.82, t.confidence + 0.012);
      if (age > 55) {
        t.status = 'CLASSIFIED';
        t.cls = 'SMALL UAS';
        t.statusTick = this.host.tick;
        this.host.emit('WARNING', `${t.id} classified · SMALL UAS · non-cooperative (${Math.round(t.confidence * 100)}%)`, { kind: 'track', id: t.id });
        this.version++;
        this.planResponse(t);
      }
    }
  }

  private monitor(t: Track): void {
    const m = t.missionId ? this.missions.missions.find((x) => x.id === t.missionId) : undefined;
    if (!m || m.status !== 'ACTIVE') return;
    const tasks = m.taskIds.map((id) => this.missions.tasks.get(id)!);
    let onStation = 0;
    for (const task of tasks) {
      const v = task.vehicleId ? this.host.byId.get(task.vehicleId) : undefined;
      if (!v || v.taskId !== task.id) continue;
      const slot = this.slotPoint(t, tasks.indexOf(task));
      const d = dist3(v.pos, slot);
      if (d < 120) {
        onStation++;
        if (task.state === 'ASSIGNED') {
          task.state = 'ACTIVE';
          v.phase = 'ON_TASK';
          this.host.emit('INFO', `${v.id} on station · ${SLOTS[tasks.indexOf(task) % SLOTS.length].name.toLowerCase()} of ${t.id}`, { kind: 'vehicle', id: v.id });
          this.version++;
        }
      }
      task.progress = clamp(1 - d / 2500, 0, 1);
    }
    const sector = this.missions.sectors.get(m.sectorIds[0]);
    if (onStation >= Math.min(3, tasks.length) && (t.status === 'CLASSIFIED' || t.status === 'MONITORED')) {
      if (t.status === 'CLASSIFIED') {
        t.status = 'MONITORED';
        t.statusTick = this.host.tick;
        if (sector) sector.state = 'ACTIVE';
        this.host.emit('INFO', `${t.id} under observation · ${onStation} assets in escort formation`, { kind: 'track', id: t.id });
        this.version++;
      }
      t.monitoredTicks++;
      t.confidence = Math.min(0.97, t.confidence + 0.0006);
      if (t.monitoredTicks > MONITOR_TICKS) {
        t.status = 'DEPARTING';
        t.statusTick = this.host.tick;
        this.host.emit('INFO', `${t.id} identified · turning away from protected airspace under escort`, { kind: 'track', id: t.id });
        this.version++;
      }
    }
    if (t.status === 'DEPARTING' && this.zone && dist2(t.pos, this.zone.center) > this.zone.radius + 650) {
      this.resolve(t, m);
    }
    const station = tasks.length ? onStation / tasks.length : 0;
    m.progress =
      t.status === 'RESOLVED'
        ? 1
        : 0.15 + 0.35 * station + 0.3 * Math.min(1, t.monitoredTicks / MONITOR_TICKS) + (t.status === 'DEPARTING' ? 0.15 : 0);
    if (sector) sector.scanned = Math.round(m.progress * sector.total);
  }

  private resolve(t: Track, m: Mission): void {
    t.status = 'RESOLVED';
    t.statusTick = this.host.tick;
    m.status = 'COMPLETE';
    m.progress = 1;
    m.completedTick = this.host.tick;
    for (const id of m.taskIds) {
      const task = this.missions.tasks.get(id)!;
      task.state = 'COMPLETE';
      const v = task.vehicleId ? this.host.byId.get(task.vehicleId) : undefined;
      if (v && v.taskId === task.id) this.missions.releaseVehicle(v, true);
    }
    const s = this.missions.sectors.get(m.sectorIds[0]);
    if (s) {
      s.state = 'SCANNED';
      s.scanned = s.total;
    }
    this.host.setSwarm('READY');
    this.host.raise('TASK_REASSIGNED', 'INFO', `TRACK RESOLVED · ${t.id}`, 'Contact clear of protected airspace · response group returning to READY', { kind: 'track', id: t.id });
    this.missions.version++;
    this.version++;
  }

  // ─────────────────────────────── response planning

  private planResponse(t: Track): void {
    // Meeting point: where the track will be when the group can be there (two fixed-point iterations).
    const ahead = (sec: number): Vec3 => ({
      x: t.pos.x + Math.sin(t.heading * DEG) * t.speed * sec,
      y: t.pos.y + Math.cos(t.heading * DEG) * t.speed * sec,
      z: t.pos.z,
    });
    const rank = (p: Vec3) =>
      this.missions
        .candidates(['EO', 'THERMAL'], p)
        .map((c) => ({ ...c, tti: dist2(c.vehicle.pos, p) / c.vehicle.platform.maxSpeed + 12 }))
        .sort((a, b) => a.tti - (a.vehicle.capability === 'RESPONSE' ? 25 : 0) - (b.tti - (b.vehicle.capability === 'RESPONSE' ? 25 : 0)));
    let meet = ahead(40);
    let pool = rank(meet);
    for (let k = 0; k < 2 && pool.length; k++) {
      meet = ahead(Math.max(...pool.slice(0, 4).map((c) => c.tti)));
      pool = rank(meet);
    }
    const group = pool.slice(0, 4);
    if (!group.length) {
      this.host.raise('MISSION_DELAYED', 'WARNING', 'No response assets available', `${t.id} unobserved`, { kind: 'track', id: t.id });
      return;
    }
    const ring = Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return { x: meet.x + Math.sin(a) * 320, y: meet.y + Math.cos(a) * 320 };
    });
    const id = this.missions.nextId();
    const sector: Sector = {
      id: `${id}-Z`,
      missionId: id,
      index: 0,
      name: 'RESPONSE ZONE',
      code: 'Z',
      kind: 'ZONE',
      state: 'ASSIGNED',
      ring,
      z: meet.z,
      total: 100,
      scanned: 0,
      requiredSensors: ['EO', 'THERMAL'],
    };
    const tasks: Task[] = group.map((c, i) => ({
      id: `${id}-T${i}`,
      missionId: id,
      sectorId: sector.id,
      name: `${SLOTS[i].name} · escort ${t.id}`,
      state: 'ASSIGNED',
      vehicleId: c.vehicle.id,
      capability: [c.vehicle.capability],
      route: { id: `${id}-R${i}`, waypoints: [{ x: meet.x, y: meet.y, z: meet.z + SLOTS[i].up }], loop: false },
      workStart: 0,
      progress: 0,
      rationale: c.rationale,
      assignedTick: this.host.tick,
    }));
    const mission: Mission = {
      id,
      code: id,
      intent: { type: 'AERIAL_RESPONSE', name: `Airspace Response · ${t.id}`, area: ring, priority: 'CRITICAL', requiredSensors: ['EO', 'THERMAL'] },
      status: 'PLANNED',
      sectorIds: [sector.id],
      taskIds: tasks.map((x) => x.id),
      field: null,
      stats: {
        evaluated: this.host.vehicles.filter((v) => v.opState !== 'OFFLINE').length,
        capable: pool.length,
        sectors: 1,
        assigned: group.length,
        routeKm: group.reduce((a, c) => a + dist2(c.vehicle.pos, meet), 0) / 1000,
        etaMin: Math.max(...group.map((c) => c.tti)) / 60,
      },
      createdTick: this.host.tick,
      startedTick: null,
      completedTick: null,
      progress: 0,
    };
    this.missions.register(mission, [sector], tasks);
    t.missionId = id;
    const eta = Math.round(Math.max(...group.map((c) => c.tti)));
    const platforms = [...new Set(group.map((c) => c.vehicle.platform.name))].join(' / ');
    const rec: Recommendation = {
      id: this.missions.nextRecId(),
      kind: 'RESPONSE_GROUP',
      title: `Dispatch response group to ${t.id}`,
      subject: t.id,
      missionId: id,
      taskId: null,
      fromId: null,
      toIds: group.map((c) => c.vehicle.id),
      rationale: [
        `${group.length} × ${platforms} · in position in ~${eta} s`,
        `EO + THERMAL identification payloads`,
        `Escort box at 160 m standoff · observe and report only`,
        `${t.id} · ${t.cls} · non-cooperative (${Math.round(t.confidence * 100)}%)`,
      ],
      alternatives: pool.slice(4, 6).map((c) => c.vehicle.id),
      confidence: 0.9,
      createdTick: this.host.tick,
      status: 'PENDING',
      decidedBy: null,
      focus: { kind: 'track', id: t.id },
    };
    this.missions.recommendations.unshift(rec);
    this.host.emit('INFO', `SuuarmOS evaluated ${pool.length} capable assets · recommends ${group.map((c) => c.vehicle.id).join(', ')}`, { kind: 'track', id: t.id });
    this.missions.version++;
    if (this.missions.autonomy === 'AUTONOMOUS') this.missions.approve(rec.id, 'AUTONOMY');
  }

  private approved(rec: Recommendation): void {
    if (!rec.missionId) return;
    this.missions.start(rec.missionId);
  }

  // ─────────────────────────────── formation guidance

  slotPoint(t: Track, i: number): Vec3 {
    const s = SLOTS[i % SLOTS.length];
    const h = t.heading * DEG;
    const fx = Math.sin(h);
    const fy = Math.cos(h);
    return { x: t.pos.x + fx * s.fwd + fy * s.right, y: t.pos.y + fy * s.fwd - fx * s.right, z: Math.max(40, t.pos.z + s.up) };
  }

  /** Guidance override for response-group aircraft: hold the escort slot, sensor locked on the track. */
  guidance(v: Vehicle): GuidanceCmd | null {
    if (!v.taskId || (v.phase !== 'TRANSIT' && v.phase !== 'ON_TASK')) return null;
    const task = this.missions.tasks.get(v.taskId);
    if (!task) return null;
    const m = this.missions.missions.find((x) => x.id === task.missionId);
    if (!m || m.intent.type !== 'AERIAL_RESPONSE' || m.status !== 'ACTIVE') return null;
    const t = this.tracks.find((x) => x.missionId === m.id);
    if (!t) return null;
    const i = m.taskIds.indexOf(task.id);
    const slot = this.slotPoint(t, i);
    const lead = { x: slot.x + Math.sin(t.heading * DEG) * t.speed * 2.5, y: slot.y + Math.cos(t.heading * DEG) * t.speed * 2.5, z: slot.z };
    const d = dist2(v.pos, lead);
    // Gimbal lock on the contact.
    const az = bearingTo(v.pos, t.pos);
    v.gimbal.targetPan = ((az - v.heading + 540) % 360) - 180;
    v.gimbal.targetTilt = clamp(-Math.atan2(v.pos.z - t.pos.z, Math.max(1, dist2(v.pos, t.pos))) / DEG, -90, 0);
    return {
      target: lead,
      speed: clamp(t.speed + d * 0.08, 4, v.platform.maxSpeed),
      arrive: false,
      yaw: d < 150 ? t.heading : undefined,
    };
  }
}
