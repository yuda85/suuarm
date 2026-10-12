import { angleDiff, clamp, DEG, Vec3, wrap360 } from '../domain/geometry';
import { Vehicle } from '../domain/vehicle';

const G = 9.81;

export interface GuidanceCmd {
  target: Vec3;
  speed: number;
  /** Decelerate to stop at target (multirotor). */
  arrive: boolean;
  /** Desired heading for multirotors (otherwise along velocity). */
  yaw?: number;
  /** Max descent rate override (landing). */
  maxDescent?: number;
}

/**
 * Advances one vehicle by dt using rate-limited dynamics.
 * Multirotors: 2D accel-limited velocity steering, yaw independent of track.
 * Wing-borne VTOL: coordinated turns, bank = atan(v·ω/g), speed ≥ stall margin.
 */
export function stepKinematics(v: Vehicle, cmd: GuidanceCmd, dt: number): void {
  if (v.wingMode) stepFixedWing(v, cmd, dt);
  else stepMultirotor(v, cmd, dt);
  stepVertical(v, cmd, dt);
}

function stepMultirotor(v: Vehicle, cmd: GuidanceCmd, dt: number): void {
  const p = v.platform;
  const dx = cmd.target.x - v.pos.x;
  const dy = cmd.target.y - v.pos.y;
  const d = Math.hypot(dx, dy);
  const amax = p.maxAccel;

  let vd = Math.min(cmd.speed, p.maxSpeed);
  if (cmd.arrive) vd = Math.min(vd, Math.sqrt(2 * amax * 0.7 * d));
  const ux = d > 1e-3 ? dx / d : 0;
  const uy = d > 1e-3 ? dy / d : 0;

  let dvx = ux * vd - v.vel.x;
  let dvy = uy * vd - v.vel.y;
  const dvm = Math.hypot(dvx, dvy);
  const lim = amax * dt;
  if (dvm > lim) {
    dvx *= lim / dvm;
    dvy *= lim / dvm;
  }
  v.vel.x += dvx;
  v.vel.y += dvy;
  v.pos.x += v.vel.x * dt;
  v.pos.y += v.vel.y * dt;
  v.speed = Math.hypot(v.vel.x, v.vel.y);

  // Yaw: explicit (e.g. facing a facade) or along track when moving.
  const desiredYaw = cmd.yaw ?? (v.speed > 1.2 ? wrap360(Math.atan2(v.vel.x, v.vel.y) / DEG) : v.heading);
  const err = angleDiff(v.heading, desiredYaw);
  const rateCmd = clamp(err * 1.6, -p.maxTurnRate, p.maxTurnRate);
  v.turnRate += clamp(rateCmd - v.turnRate, -240 * dt, 240 * dt);
  v.heading = wrap360(v.heading + v.turnRate * dt);

  // Attitude from body-frame velocity + acceleration (tilt into motion).
  const h = v.heading * DEG;
  const fx = Math.sin(h);
  const fy = Math.cos(h);
  const ax = dvx / dt;
  const ay = dvy / dt;
  const vF = v.vel.x * fx + v.vel.y * fy;
  const vR = v.vel.x * fy - v.vel.y * fx;
  const aF = ax * fx + ay * fy;
  const aR = ax * fy - ay * fx;
  const pitchT = clamp(-(vF * 0.75 + aF * 2.0), -24, 24);
  const rollT = clamp(vR * 0.75 + aR * 2.0, -24, 24);
  const k = Math.min(1, dt * 5);
  v.pitch += (pitchT - v.pitch) * k;
  v.roll += (rollT - v.roll) * k;
}

function stepFixedWing(v: Vehicle, cmd: GuidanceCmd, dt: number): void {
  const p = v.platform;
  const brg = wrap360(Math.atan2(cmd.target.x - v.pos.x, cmd.target.y - v.pos.y) / DEG);
  const err = angleDiff(v.heading, brg);
  const rateCmd = clamp(err * 0.9, -p.maxTurnRate, p.maxTurnRate);
  v.turnRate += clamp(rateCmd - v.turnRate, -14 * dt, 14 * dt);
  v.heading = wrap360(v.heading + v.turnRate * dt);

  const sCmd = clamp(cmd.speed, p.minSpeed, p.maxSpeed);
  v.speed += clamp(sCmd - v.speed, -p.maxAccel * dt, p.maxAccel * dt);
  const h = v.heading * DEG;
  v.vel.x = Math.sin(h) * v.speed;
  v.vel.y = Math.cos(h) * v.speed;
  v.pos.x += v.vel.x * dt;
  v.pos.y += v.vel.y * dt;

  const bank = Math.atan((v.speed * v.turnRate * DEG) / G) / DEG;
  const k = Math.min(1, dt * 3);
  v.roll += (clamp(bank, -38, 38) - v.roll) * k;
  v.pitch += (clamp(Math.atan2(v.climb, Math.max(v.speed, 1)) / DEG, -15, 15) - v.pitch) * k;
}

function stepVertical(v: Vehicle, cmd: GuidanceCmd, dt: number): void {
  const p = v.platform;
  const dz = cmd.target.z - v.pos.z;
  const maxDown = cmd.maxDescent ?? p.maxClimb;
  const climbCmd = clamp(dz * 0.7, -maxDown, p.maxClimb);
  v.climb += clamp(climbCmd - v.climb, -2.2 * dt, 2.2 * dt);
  v.pos.z = Math.max(0, v.pos.z + v.climb * dt);
  if (v.pos.z === 0 && v.climb < 0) v.climb = 0;
}

/** Target point for a smooth orbit (fixed-wing loiter). */
export function orbitTarget(v: Vehicle, center: Vec3, radius: number): Vec3 {
  const ang = Math.atan2(v.pos.x - center.x, v.pos.y - center.y);
  const lead = (28 * DEG * 90) / Math.max(radius, 60);
  const a = ang + lead; // clockwise orbit
  return { x: center.x + Math.sin(a) * radius, y: center.y + Math.cos(a) * radius, z: center.z };
}
