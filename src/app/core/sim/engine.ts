import { bearingTo, clamp, DEG, dist2, pointInRing, Vec3, wrap360 } from '../domain/geometry';
import { Alert, AlertKind, AutonomyMode, FocusRef, Geofence, Hub, OperationalEvent, Poi, Severity, SwarmMode, TrackSpawn } from '../domain/ops';
import { ResponseSystem } from '../mission/response-system';
import { FleetSize, ScenarioDefinition } from '../domain/scenario';
import { FovMode } from '../domain/sensor';
import { MissionIntent } from '../domain/mission';
import { MissionSystem } from '../mission/mission-system';
import { Route, Vehicle } from '../domain/vehicle';
import { Prism } from '../sensor/sensor-geometry';
import { buildFleet } from './fleet-factory';
import { GuidanceCmd, orbitTarget, stepKinematics } from './kinematics';
import { Rng } from './rng';

export const SIM_HZ = 10;
export const SIM_DT = 1 / SIM_HZ;
/** Pose stride in pose buffers: x, y, z, heading, pitch, roll, gimbalPan, gimbalTilt. */
export const POSE_STRIDE = 8;

export type SimCommand =
  | { type: 'SET_SWARM_MODE'; mode: SwarmMode }
  | { type: 'HOLD'; vehicleId: string }
  | { type: 'RESUME'; vehicleId: string }
  | { type: 'RTB'; vehicleId: string }
  | { type: 'LAUNCH'; vehicleId: string; route: Route; delayTicks?: number }
  | { type: 'FAIL_VEHICLE'; vehicleId: string }
  | { type: 'LINK_LOST'; vehicleId: string }
  | { type: 'LOW_BATTERY'; vehicleId: string }
  | { type: 'PAYLOAD_FAIL'; vehicleId: string }
  | { type: 'SET_GIMBAL'; vehicleId: string; pan: number; tilt: number }
  | { type: 'GIMBAL_AUTO'; vehicleId: string }
  | { type: 'SET_FOV'; vehicleId: string; payloadId: string; mode: FovMode }
  | { type: 'SET_PAYLOAD'; vehicleId: string; payloadId: string }
  | { type: 'PLAN_MISSION'; intent: MissionIntent }
  | { type: 'START_MISSION'; missionId?: string }
  | { type: 'ABORT_MISSION'; missionId?: string }
  | { type: 'APPROVE'; recommendationId: string }
  | { type: 'REJECT'; recommendationId: string }
  | { type: 'SET_AUTONOMY'; mode: AutonomyMode }
  | { type: 'NAV_DEGRADED'; vehicleId: string }
  | { type: 'COMPLETE_SECTOR' }
  | { type: 'COMPLETE_MISSION' }
  | { type: 'SPAWN_TRACK'; track?: TrackSpawn }
  | { type: 'ADD_GEOFENCE'; fence: Geofence }
  | { type: 'REMOVE_GEOFENCE'; id: string };

export interface SimInit {
  scenario: ScenarioDefinition;
  fleetSize: FleetSize;
  seed?: number;
}

/**
 * Deterministic, UI-independent simulation. Fixed 10 Hz step, seeded randomness,
 * operator commands applied on tick boundaries and logged ⇒ identical runs for identical inputs.
 */
export class SimulationEngine {
  readonly scenario: ScenarioDefinition;
  readonly fleetSize: FleetSize;
  readonly seed: number;
  readonly rng: Rng;
  private readonly commsRng: Rng;

  tick = 0;
  swarmMode: SwarmMode = 'READY';
  readonly vehicles: Vehicle[];
  readonly byId = new Map<string, Vehicle>();
  readonly hubs: Hub[];
  readonly geofences: Geofence[];
  private readonly fenceAlerts = new Set<string>();
  readonly pois: Poi[];
  readonly prisms: Prism[];

  readonly missions: MissionSystem;
  readonly response: ResponseSystem;
  private trackSeq = 416;
  readonly alerts: Alert[] = [];
  readonly events: OperationalEvent[] = [];
  /** Events produced during the most recent step (drained by host). */
  readonly newEvents: OperationalEvent[] = [];
  readonly newAlerts: Alert[] = [];
  private eventSeq = 0;
  private alertSeq = 0;

  prevPose: Float64Array;
  currPose: Float64Array;

  private readonly queue: SimCommand[] = [];
  readonly commandLog: { tick: number; cmd: SimCommand }[] = [];

  constructor(init: SimInit) {
    this.scenario = init.scenario;
    this.fleetSize = init.fleetSize;
    this.seed = init.seed ?? init.scenario.seed;
    this.rng = new Rng(this.seed);
    this.commsRng = this.rng.fork(7001);
    this.hubs = init.scenario.hubs;
    this.geofences = [...init.scenario.geofences];
    this.pois = init.scenario.pois;
    this.prisms = init.scenario.structures ?? [];
    this.vehicles = buildFleet(init.scenario, init.fleetSize, this.rng.fork(11));
    for (const v of this.vehicles) this.byId.set(v.id, v);
    const self = this;
    this.missions = new MissionSystem({
      get tick() {
        return self.tick;
      },
      vehicles: this.vehicles,
      byId: this.byId,
      prisms: this.prisms,
      campus: this.scenario.campus ?? null,
      hubs: this.hubs,
      cruiseAlt: this.scenario.cruiseAlt,
      emit: (s, t, f) => this.emit(s, t, f),
      raise: (k, s, t, d, f) => {
        this.raise(k, s, t, d, f);
      },
      launch: (v, r, d) => this.launch(v, r, d),
      sendHome: (v, m) => this.sendHome(v, m),
      setSwarm: (mode) => {
        if (this.swarmMode !== mode) {
          this.swarmMode = mode;
          this.emit('INFO', `SWARM ${mode}`, null);
        }
      },
    });
    this.response = new ResponseSystem(
      {
        get tick() {
          return self.tick;
        },
        vehicles: this.vehicles,
        byId: this.byId,
        prisms: this.prisms,
        campus: this.scenario.campus ?? null,
        hubs: this.hubs,
        cruiseAlt: this.scenario.cruiseAlt,
        emit: (s, t, f) => this.emit(s, t, f),
        raise: (k, s, t, d, f) => {
          this.raise(k, s, t, d, f);
        },
        launch: (v, r, d) => this.launch(v, r, d),
        sendHome: (v, m) => this.sendHome(v, m),
        setSwarm: (mode) => {
          if (this.swarmMode !== mode) {
            this.swarmMode = mode;
            this.emit('INFO', `SWARM ${mode}`, null);
          }
        },
      },
      this.missions,
      this.scenario.protectedZone ?? null,
    );
    this.prevPose = new Float64Array(this.vehicles.length * POSE_STRIDE);
    this.currPose = new Float64Array(this.vehicles.length * POSE_STRIDE);
    this.writePose(this.currPose);
    this.prevPose.set(this.currPose);
    this.emit('INFO', `${this.scenario.name} initialized · ${this.vehicles.length} assets online`, null);
  }

  get timeSec(): number {
    return this.tick * SIM_DT;
  }

  enqueue(cmd: SimCommand): void {
    this.queue.push(cmd);
  }

  step(): void {
    this.prevPose.set(this.currPose);
    this.newEvents.length = 0;
    this.newAlerts.length = 0;
    this.tick++;

    while (this.queue.length) {
      const cmd = this.queue.shift()!;
      this.commandLog.push({ tick: this.tick, cmd });
      this.apply(cmd);
    }

    for (const ev of this.scenario.script ?? []) {
      if (ev.atTick === this.tick && ev.spawnTrack) this.response.spawn(ev.spawnTrack);
    }
    this.response.step();
    for (const v of this.vehicles) this.stepVehicle(v);
    this.missions.step();
    if (this.tick % 5 === 0) this.updateComms();
    if (this.tick % 10 === 0) this.checkGeofences();
    this.writePose(this.currPose);
  }

  // ───────────────────────────────────────── commands

  private apply(cmd: SimCommand): void {
    switch (cmd.type) {
      case 'SET_SWARM_MODE':
        this.setSwarmMode(cmd.mode);
        break;
      case 'PLAN_MISSION':
        this.missions.plan(cmd.intent);
        break;
      case 'START_MISSION': {
        const id = cmd.missionId ?? this.missions.planned?.id;
        // Response groups start through their recommendation (keeps the approval record consistent).
        const rec = this.missions.recommendations.find((r) => r.missionId === id && r.status === 'PENDING');
        if (rec) this.missions.approve(rec.id, 'OPERATOR');
        else if (id) this.missions.start(id);
        break;
      }
      case 'APPROVE':
        this.missions.approve(cmd.recommendationId, 'OPERATOR');
        break;
      case 'REJECT':
        this.missions.reject(cmd.recommendationId);
        break;
      case 'SET_AUTONOMY':
        this.missions.setAutonomy(cmd.mode);
        break;
      case 'SPAWN_TRACK': {
        const z = this.scenario.protectedZone;
        const id = `T-${String(++this.trackSeq).padStart(4, '0')}`;
        const spawn = cmd.track ?? {
          id,
          pos: { x: (z?.center.x ?? 0) - 3000, y: (z?.center.y ?? 0) + 2300, z: 140 },
          heading: 128,
          speed: 14,
        };
        this.response.spawn({ ...spawn, id: cmd.track?.id ?? id });
        break;
      }
      case 'ADD_GEOFENCE':
        this.geofences.push(cmd.fence);
        this.emit('INFO', `Geofence ${cmd.fence.name} active · ${cmd.fence.kind} ${cmd.fence.floor}–${cmd.fence.ceiling} m`, null);
        break;
      case 'REMOVE_GEOFENCE': {
        const i = this.geofences.findIndex((g) => g.id === cmd.id);
        if (i >= 0) this.geofences.splice(i, 1);
        break;
      }
      case 'COMPLETE_SECTOR':
        this.missions.completeSector();
        break;
      case 'COMPLETE_MISSION':
        this.missions.completeMission();
        break;
      case 'NAV_DEGRADED': {
        const v = this.byId.get(cmd.vehicleId);
        if (v) {
          v.health.navDegraded = true;
          v.nav = { state: 'DEGRADED', hAccM: 4.8 };
          this.raise('NAV_DEGRADED', 'WARNING', `${v.id} navigation degraded`, 'GNSS multipath · RTK fix lost', vf(v));
        }
        break;
      }
      case 'ABORT_MISSION': {
        const id = cmd.missionId ?? this.missions.active?.id ?? this.missions.planned?.id;
        if (id) this.missions.abort(id);
        if (!this.missions.active) this.swarmMode = 'READY';
        break;
      }
      case 'HOLD': {
        const v = this.byId.get(cmd.vehicleId);
        if (v && v.phase !== 'PARKED' && v.opState !== 'OFFLINE') {
          v.opState = 'HOLD';
          v.phase = 'HOLD';
          v.holdPoint = { ...v.pos };
          this.emit('INFO', `${v.id} holding position`, vf(v));
        }
        break;
      }
      case 'RESUME': {
        const v = this.byId.get(cmd.vehicleId);
        if (v && v.opState === 'HOLD') {
          v.opState = v.route ? 'ACTIVE' : 'READY';
          v.phase = v.route ? 'TRANSIT' : 'HOLD';
          this.emit('INFO', `${v.id} resumed task`, vf(v));
        }
        break;
      }
      case 'RTB': {
        const v = this.byId.get(cmd.vehicleId);
        if (v) this.sendHome(v, `${v.id} returning to ${this.hubName(v.hubId)}`);
        break;
      }
      case 'LAUNCH': {
        const v = this.byId.get(cmd.vehicleId);
        if (v && v.opState !== 'OFFLINE') this.launch(v, cmd.route, cmd.delayTicks ?? 0);
        break;
      }
      case 'FAIL_VEHICLE': {
        const v = this.byId.get(cmd.vehicleId);
        if (v) {
          v.opState = 'OFFLINE';
          v.link.state = 'LOST';
          v.link.quality = 0;
          v.health.linkLost = true;
          this.raise('VEHICLE_OFFLINE', 'CRITICAL', `${v.id} offline`, 'Vehicle stopped reporting telemetry', vf(v));
          this.missions.releaseVehicleTask(v, 'vehicle offline');
        }
        break;
      }
      case 'LINK_LOST': {
        const v = this.byId.get(cmd.vehicleId);
        if (v) {
          v.health.linkLost = true;
          v.link.state = 'LOST';
          v.link.quality = 0;
          v.lostLinkTicks = 0;
          this.raise('LINK_LOST', 'CRITICAL', `${v.id} link lost`, `No C2 link via ${v.link.via} · lost-link procedure engaged`, vf(v));
          this.missions.releaseVehicleTask(v, 'link lost');
        }
        break;
      }
      case 'LOW_BATTERY': {
        const v = this.byId.get(cmd.vehicleId);
        if (v) v.battery = Math.min(v.battery, 0.2);
        break;
      }
      case 'PAYLOAD_FAIL': {
        const v = this.byId.get(cmd.vehicleId);
        if (v) {
          for (const p of v.payloads) p.status = 'FAULT';
          v.health.payloadFault = true;
          this.raise('PAYLOAD_OFFLINE', 'WARNING', `${v.id} payload fault`, `${v.payloads.map((p) => p.type).join(' + ')} offline`, vf(v));
          if (v.taskId) {
            this.missions.releaseVehicleTask(v, 'payload offline');
            this.sendHome(v, `${v.id} returning · payload unserviceable`);
          }
        }
        break;
      }
      case 'SET_GIMBAL': {
        const v = this.byId.get(cmd.vehicleId);
        if (v) {
          v.gimbal.mode = 'MANUAL';
          v.gimbal.targetPan = clamp(((cmd.pan + 540) % 360) - 180, -175, 175);
          v.gimbal.targetTilt = clamp(cmd.tilt, -90, 0);
        }
        break;
      }
      case 'GIMBAL_AUTO': {
        const v = this.byId.get(cmd.vehicleId);
        if (v) v.gimbal.mode = 'AUTO';
        break;
      }
      case 'SET_FOV': {
        const p = this.byId.get(cmd.vehicleId)?.payloads.find((x) => x.id === cmd.payloadId);
        if (p) p.fovMode = cmd.mode;
        break;
      }
      case 'SET_PAYLOAD': {
        const v = this.byId.get(cmd.vehicleId);
        if (v && v.payloads.some((p) => p.id === cmd.payloadId)) v.activePayloadId = cmd.payloadId;
        break;
      }
    }
  }

  /** Swarm ACTIVE = executing the primary mission (planned one, or the scenario's default intent). */
  private setSwarmMode(mode: SwarmMode): void {
    if (mode === this.swarmMode) return;
    if (mode === 'ACTIVE') {
      if (!this.missions.planned) this.missions.plan(this.scenario.defaultIntent());
      const id = this.missions.planned?.id;
      if (id) this.missions.start(id);
    } else {
      const m = this.missions.active;
      if (m) this.missions.abort(m.id);
      for (const v of this.vehicles) {
        if (v.launchAtTick !== null && v.phase === 'PARKED') {
          v.launchAtTick = null;
          v.opState = 'READY';
          v.route = null;
        }
        if ((v.opState === 'ACTIVE' || v.opState === 'HOLD') && !isBackground(v)) this.sendHome(v, null);
      }
      this.swarmMode = 'READY';
      this.emit('INFO', 'SWARM READY · primary tasking released, assets returning', null);
    }
  }

  launch(v: Vehicle, route: Route, delayTicks: number): void {
    v.dwellLeft = 0;
    v.route = route;
    v.routeIndex = 0;
    v.odometer = 0;
    v.opState = 'ACTIVE';
    if (v.phase === 'PARKED') {
      v.launchAtTick = this.tick + delayTicks;
      v.phase = 'PARKED';
    } else {
      v.phase = 'TRANSIT';
    }
  }

  sendHome(v: Vehicle, msg: string | null): void {
    if (v.opState === 'OFFLINE' || v.phase === 'PARKED') return;
    v.opState = 'RETURNING';
    v.phase = 'RTB';
    v.launchAtTick = null;
    if (msg) this.emit('INFO', msg, vf(v));
  }

  // ───────────────────────────────────────── per-vehicle step

  private stepVehicle(v: Vehicle): void {
    if (v.opState === 'OFFLINE') {
      // Uncontrolled: drift down slowly until ground (visual only, no crash physics).
      v.vel.x *= 0.96;
      v.vel.y *= 0.96;
      v.pos.x += v.vel.x * SIM_DT;
      v.pos.y += v.vel.y * SIM_DT;
      v.pos.z = Math.max(0, v.pos.z - 1.2 * SIM_DT);
      v.speed = Math.hypot(v.vel.x, v.vel.y);
      v.roll *= 0.98;
      v.pitch *= 0.98;
      return;
    }

    this.lostLinkProcedure(v);
    const override = this.response.guidance(v);
    const cmd = override ?? this.guidance(v);
    if (cmd) stepKinematics(v, cmd, SIM_DT);
    if (override) v.odometer += v.speed * SIM_DT;
    if (!override) this.stepGimbal(v);
    else this.slewGimbal(v);
    this.stepBattery(v);
    this.stepHealth(v);
  }

  private guidance(v: Vehicle): GuidanceCmd | null {
    const p = v.platform;
    const alt = this.scenario.cruiseAlt;
    switch (v.phase) {
      case 'PARKED': {
        if (v.launchAtTick !== null && this.tick >= v.launchAtTick) {
          v.launchAtTick = null;
          v.phase = 'TAKEOFF';
          this.emit('INFO', `${v.id} airborne`, vf(v));
        }
        v.speed = 0;
        return null;
      }
      case 'TAKEOFF': {
        const first = v.route?.waypoints[0];
        const climbTo = Math.max(first?.z ?? alt, 25);
        if (v.pos.z > climbTo - 2) {
          v.phase = 'TRANSIT';
        }
        return { target: { x: v.pad.x, y: v.pad.y, z: climbTo }, speed: 2, arrive: true, yaw: first ? bearingTo(v.pos, first) : v.heading };
      }
      case 'TRANSIT':
      case 'ON_TASK': {
        if (!v.route || v.route.waypoints.length === 0) {
          v.phase = 'HOLD';
          v.holdPoint = { ...v.pos };
          return null;
        }
        // VTOL transition to wing-borne once clear of the pad.
        if (p.airframe === 'VTOL' && !v.wingMode) {
          if (v.speed >= p.minSpeed * 0.95) {
            v.wingMode = true;
          } else {
            const fwd = { x: v.pos.x + Math.sin(v.heading * DEG) * 400, y: v.pos.y + Math.cos(v.heading * DEG) * 400, z: v.pos.z };
            const wp0 = v.route.waypoints[v.routeIndex];
            return { target: fwd, speed: p.minSpeed, arrive: false, yaw: bearingTo(v.pos, wp0) };
          }
        }
        const wp = v.route.waypoints[v.routeIndex];
        const d = dist2(v.pos, wp);
        const accept = v.wingMode ? 60 : 2.5;
        if (d < accept && Math.abs(wp.z - v.pos.z) < 6) {
          if (wp.dwell && v.dwellLeft <= 0 && !v.wingMode) v.dwellLeft = wp.dwell;
          if (v.dwellLeft > 0) {
            v.dwellLeft -= SIM_DT;
            return { target: wp, speed: 0, arrive: true, yaw: wp.look ? bearingTo(v.pos, wp.look) : v.heading };
          }
          v.routeIndex++;
          if (v.routeIndex >= v.route.waypoints.length) {
            if (v.route.loop) v.routeIndex = 0;
            else {
              v.phase = 'HOLD';
              v.holdPoint = { ...wp };
              return null;
            }
          }
        }
        const target = v.route.waypoints[v.routeIndex];
        v.odometer += v.speed * SIM_DT;
        return {
          target,
          speed: target.speed ?? p.cruiseSpeed,
          arrive: !v.wingMode && !v.route.loop && v.routeIndex === v.route.waypoints.length - 1,
          yaw: target.yaw ?? (target.look ? bearingTo(v.pos, target.look) : undefined),
        };
      }
      case 'HOLD': {
        const hp = v.holdPoint ?? v.pos;
        if (v.wingMode) return { target: orbitTarget(v, hp, 140), speed: p.cruiseSpeed * 0.85, arrive: false };
        return { target: hp, speed: 4, arrive: true };
      }
      case 'RTB': {
        const above = { x: v.pad.x, y: v.pad.y, z: Math.max(alt, 30) };
        const d = dist2(v.pos, v.pad);
        if (v.wingMode && d < 260) v.wingMode = false; // back-transition to hover
        if (!v.wingMode && d < 1.5) v.phase = 'LANDING';
        return { target: above, speed: v.wingMode ? p.cruiseSpeed : p.cruiseSpeed, arrive: !v.wingMode };
      }
      case 'LANDING': {
        if (v.pos.z <= 0.05) {
          v.phase = 'PARKED';
          v.opState = 'READY';
          v.route = null;
          v.routeIndex = 0;
          v.speed = 0;
          v.vel.x = v.vel.y = 0;
          v.pitch = v.roll = 0;
          v.pos.x = v.pad.x;
          v.pos.y = v.pad.y;
          v.lostLinkTicks = 0;
          this.emit('INFO', `${v.id} landed · ${this.hubName(v.hubId)}`, vf(v));
          return null;
        }
        return { target: { x: v.pad.x, y: v.pad.y, z: 0 }, speed: 1, arrive: true, maxDescent: v.pos.z > 8 ? 2.5 : 0.8 };
      }
    }
  }

  /** Pre-programmed lost-link behaviour: hold 3 s, then autonomous return to base. */
  private lostLinkProcedure(v: Vehicle): void {
    if (!v.health.linkLost) return;
    if (v.phase === 'PARKED') {
      v.health.linkLost = false;
      v.link.state = 'NOMINAL';
      v.link.quality = 0.95;
      return;
    }
    v.lostLinkTicks++;
    if (v.lostLinkTicks === 30 && v.phase !== 'RTB' && v.phase !== 'LANDING') {
      v.phase = 'HOLD';
      v.holdPoint = { ...v.pos };
    }
    if (v.lostLinkTicks === 60 && v.phase !== 'RTB' && v.phase !== 'LANDING') this.sendHome(v, `${v.id} lost-link procedure · returning autonomously`);
  }

  private slewGimbal(v: Vehicle): void {
    const g = v.gimbal;
    const rate = 70 * SIM_DT;
    g.pan += clamp(((g.targetPan - g.pan + 540) % 360) - 180, -rate, rate);
    g.tilt += clamp(g.targetTilt - g.tilt, -rate, rate);
  }

  private stepGimbal(v: Vehicle): void {
    const g = v.gimbal;
    if (g.mode === 'AUTO') {
      const wp = v.route?.waypoints[Math.min(v.routeIndex, (v.route?.waypoints.length ?? 1) - 1)];
      const look = wp?.look;
      const working = v.phase === 'TRANSIT' || v.phase === 'ON_TASK' || v.phase === 'HOLD';
      if (wp?.facade && working) {
        // Lock perpendicular onto the wall at the aircraft's height.
        const f = wp.facade;
        const dx = f.bx - f.ax;
        const dy = f.by - f.ay;
        const t = clamp(((v.pos.x - f.ax) * dx + (v.pos.y - f.ay) * dy) / (dx * dx + dy * dy), 0, 1);
        const lx = f.ax + dx * t;
        const ly = f.ay + dy * t;
        const az = bearingTo(v.pos, { x: lx, y: ly });
        g.targetPan = ((az - v.heading + 540) % 360) - 180;
        g.targetTilt = -4;
      } else if (wp?.tilt !== undefined && working) {
        g.targetPan = 0;
        g.targetTilt = wp.tilt;
      } else if (look && (v.phase === 'TRANSIT' || v.phase === 'ON_TASK' || v.phase === 'HOLD')) {
        const az = bearingTo(v.pos, look);
        const horiz = Math.max(1, dist2(v.pos, look));
        g.targetPan = ((az - v.heading + 540) % 360) - 180;
        g.targetTilt = clamp(-Math.atan2(v.pos.z - look.z, horiz) / DEG, -90, 0);
      } else if (v.phase === 'PARKED') {
        g.targetPan = 0;
        g.targetTilt = -10;
      } else {
        g.targetPan = 0;
        g.targetTilt = v.platform.airframe === 'VTOL' ? -35 : -28;
      }
    }
    const rate = 70 * SIM_DT;
    g.pan += clamp(((g.targetPan - g.pan + 540) % 360) - 180, -rate, rate);
    g.tilt += clamp(g.targetTilt - g.tilt, -rate, rate);
  }

  private stepBattery(v: Vehicle): void {
    if (v.phase === 'PARKED') {
      v.battery = Math.min(1, v.battery + SIM_DT / 1800);
      return;
    }
    const s = v.speed / v.platform.cruiseSpeed;
    const hoverPenalty = v.wingMode ? 0.7 : 1;
    v.battery = Math.max(0, v.battery - v.drainPerSec * SIM_DT * hoverPenalty * (0.75 + 0.35 * s * s) * 1.0);
    v.compute.load = clamp(0.35 + 0.25 * s + (this.commsRng.next() - 0.5) * 0.04, 0.1, 0.98);
    v.compute.tempC = clamp(v.compute.tempC + (40 + v.compute.load * 22 - v.compute.tempC) * 0.01, 30, 90);
  }

  private stepHealth(v: Vehicle): void {
    const h = v.health;
    if (!h.lowBattery && v.battery < 0.25) {
      h.lowBattery = true;
      this.raise('LOW_BATTERY', 'WARNING', `${v.id} low battery`, `${Math.round(v.battery * 100)}% · est. ${this.enduranceMin(v)} min`, vf(v));
    }
    if (!h.criticalBattery && v.battery < 0.12) {
      h.criticalBattery = true;
      this.raise('CRITICAL_BATTERY', 'CRITICAL', `${v.id} critical battery`, 'Automatic return initiated', vf(v));
      this.missions.releaseVehicleTask(v, 'critical battery');
      this.sendHome(v, null);
    }
    if (h.lowBattery && v.battery > 0.3) h.lowBattery = h.criticalBattery = false;
  }

  enduranceMin(v: Vehicle): number {
    const hp = v.wingMode ? 0.7 : 1;
    return Math.max(0, Math.round((v.battery / (v.drainPerSec * hp)) / 60));
  }

  private checkGeofences(): void {
    for (const g of this.geofences) {
      for (const v of this.vehicles) {
        if (!g.appliesToFleet || v.opState === 'OFFLINE' || v.pos.z < 2) continue;
        const key = `${g.id}|${v.id}`;
        const inside = v.pos.z >= g.floor && v.pos.z <= g.ceiling && pointInRing(v.pos, g.ring);
        if (inside && !this.fenceAlerts.has(key)) {
          this.fenceAlerts.add(key);
          this.raise('RESTRICTED_AREA', 'WARNING', `${v.id} inside ${g.name}`, `${g.kind} volume ${g.floor}–${g.ceiling} m · operator review required`, vf(v));
        } else if (!inside) this.fenceAlerts.delete(key);
      }
      for (const t of this.response.tracks) {
        if (t.status === 'RESOLVED') continue;
        const key = `${g.id}|${t.id}`;
        const inside = t.pos.z <= g.ceiling && pointInRing(t.pos, g.ring);
        if (inside && !this.fenceAlerts.has(key)) {
          this.fenceAlerts.add(key);
          this.raise('RESTRICTED_AREA', 'CRITICAL', `${t.id} entered ${g.name}`, 'Non-cooperative contact inside protected airspace', { kind: 'track', id: t.id });
        }
      }
    }
  }

  private updateComms(): void {
    const nodes: { id: string; pos: Vec3; range: number }[] = this.hubs.map((h) => ({ id: h.id, pos: { ...h.pos, z: 12 }, range: 7000 }));
    for (const v of this.vehicles) {
      if (v.capability === 'RELAY' && v.phase !== 'PARKED' && v.opState !== 'OFFLINE') nodes.push({ id: v.id, pos: v.pos, range: 4500 });
    }
    for (const v of this.vehicles) {
      if (v.opState === 'OFFLINE' || v.health.linkLost) continue;
      let best = 0;
      let via = v.link.via;
      for (const n of nodes) {
        if (n.id === v.id) continue;
        const d = Math.hypot(n.pos.x - v.pos.x, n.pos.y - v.pos.y, n.pos.z - v.pos.z);
        const q = clamp(1 - Math.pow(d / n.range, 2), 0, 1) * (v.phase === 'PARKED' ? 1 : 0.985);
        if (q > best) {
          best = q;
          via = n.id;
        }
      }
      const noise = (this.commsRng.next() - 0.5) * 0.04;
      v.link.quality = clamp(best + noise, 0, 1);
      v.link.via = via;
      v.link.latencyMs = Math.round(16 + (1 - v.link.quality) * 140 + this.commsRng.next() * 6);
      const degraded = v.link.quality < 0.35;
      v.link.state = degraded ? 'DEGRADED' : 'NOMINAL';
      if (degraded && !v.health.linkDegraded) {
        v.health.linkDegraded = true;
        this.raise('LINK_DEGRADED', 'WARNING', `${v.id} link degraded`, `Quality ${Math.round(v.link.quality * 100)}% via ${via}`, vf(v));
      } else if (!degraded && v.health.linkDegraded && v.link.quality > 0.45) {
        v.health.linkDegraded = false;
      }
    }
  }

  // ───────────────────────────────────────── events / alerts

  emit(severity: Severity, text: string, focus: FocusRef | null): void {
    const e: OperationalEvent = { id: ++this.eventSeq, tick: this.tick, severity, text, focus };
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    this.newEvents.push(e);
  }

  raise(kind: AlertKind, severity: Severity, title: string, detail: string, focus: FocusRef | null): Alert {
    const a: Alert = { id: `AL-${++this.alertSeq}`, kind, severity, title, detail, tick: this.tick, focus, acknowledged: false, active: true };
    this.alerts.unshift(a);
    if (this.alerts.length > 120) this.alerts.pop();
    this.newAlerts.push(a);
    this.emit(severity, title, focus);
    return a;
  }

  hubName(id: string): string {
    return this.hubs.find((h) => h.id === id)?.name ?? id;
  }

  // ───────────────────────────────────────── pose buffers

  private writePose(out: Float64Array): void {
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const o = i * POSE_STRIDE;
      out[o] = v.pos.x;
      out[o + 1] = v.pos.y;
      out[o + 2] = v.pos.z;
      out[o + 3] = wrap360(v.heading);
      out[o + 4] = v.pitch;
      out[o + 5] = v.roll;
      out[o + 6] = v.gimbal.pan;
      out[o + 7] = v.gimbal.tilt;
    }
  }

  /** Stable fingerprint of full dynamic state (determinism tests). */
  stateHash(): string {
    let h = 0;
    for (const v of this.vehicles) {
      const vals = [v.pos.x, v.pos.y, v.pos.z, v.heading, v.battery, v.link.quality];
      for (const x of vals) h = (Math.imul(h ^ Math.round(x * 1000), 16777619) + 1) >>> 0;
      h = (Math.imul(h ^ v.opState.length ^ v.phase.length, 16777619) + 7) >>> 0;
    }
    return h.toString(16);
  }
}

function vf(v: Vehicle): FocusRef {
  return { kind: 'vehicle', id: v.id };
}

function isBackground(v: Vehicle): boolean {
  return v.route?.id.startsWith('bg-') ?? false;
}
