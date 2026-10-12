import { Ring, Vec2, Vec3 } from '../domain/geometry';
import { FacadeGrid, MissionIntent, Sector, Task } from '../domain/mission';
import { Waypoint } from '../domain/vehicle';
import { CampusBuilding, wallsOf } from '../world/campus';
import { coverageLanes, ringCentroid } from './polygon';

const FACADE_STANDOFF = 20;
const FACADE_SPEED = 2.4;

export interface BuildingPlan {
  sectors: Sector[];
  tasks: Task[];
  groundRing: Ring;
  footprint: Ring;
}

const grid = (cols: number, rows: number): FacadeGrid => ({ cols, rows, cells: new Uint8Array(cols * rows) });

function offsetRect(ring: Ring, d: number): Ring {
  const c = ringCentroid(ring);
  // Footprints are rectangles: push each corner out along both adjacent edge normals.
  return ring.map((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length];
    const next = ring[(i + 1) % ring.length];
    const n1 = norm({ x: p.y - prev.y, y: -(p.x - prev.x) });
    const n2 = norm({ x: next.y - p.y, y: -(next.x - p.x) });
    const q = { x: p.x + (n1.x + n2.x) * d, y: p.y + (n1.y + n2.y) * d };
    void c;
    return q;
  });
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function bearingOf(v: Vec2): number {
  return ((Math.atan2(v.x, v.y) * 180) / Math.PI + 360) % 360;
}

/**
 * Divide a building into scan sectors (roof, four facades, surrounding ground) and generate
 * two tasks per sector: facade serpentines at standoff with the gimbal locked onto the wall,
 * nadir roof lawnmowers, and an outward-looking perimeter loop for the surroundings.
 */
export function planBuilding(missionId: string, intent: MissionIntent, b: CampusBuilding, now: number): BuildingPlan {
  const walls = wallsOf(b);
  const top = b.top;
  const safeZ = top + 16;
  const sectors: Sector[] = [];
  const tasks: Task[] = [];
  const order: ('ROOF' | 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'GROUND')[] = ['ROOF', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'GROUND'];
  const r0 = b.ring[0];
  const e0 = { x: b.ring[1].x - r0.x, y: b.ring[1].y - r0.y };
  const e3 = { x: b.ring[3].x - r0.x, y: b.ring[3].y - r0.y };
  const l0 = Math.hypot(e0.x, e0.y);
  const l3 = Math.hypot(e3.x, e3.y);
  const groundRing = offsetRect(b.ring, 46);

  const mk = (i: number, kind: Sector['kind'], name: string, code: string, ring: Ring, extra: Partial<Sector>): Sector => ({
    id: `${missionId}-${code}`,
    missionId,
    index: i,
    name,
    code,
    kind,
    state: 'UNASSIGNED',
    ring,
    total: 0,
    scanned: 0,
    requiredSensors: intent.requiredSensors,
    ...extra,
  });
  const task = (s: Sector, k: number, name: string, waypoints: Waypoint[], slice: [number, number], workStart: number): Task => ({
    id: `${s.id}-T${k}`,
    missionId,
    sectorId: s.id,
    name,
    state: 'UNASSIGNED',
    vehicleId: null,
    capability: [],
    route: { id: `${s.id}-R${k}`, waypoints, loop: false },
    workStart,
    progress: 0,
    rationale: [],
    assignedTick: now,
    slice,
  });

  order.forEach((key, i) => {
    if (key === 'ROOF') {
      const cols = Math.max(4, Math.round(l0 / 6));
      const rows = Math.max(3, Math.round(l3 / 6));
      const s = mk(i, 'ROOF', 'ROOF', 'R', b.ring, { z: top, facade: grid(cols, rows) });
      s.total = cols * rows;
      sectors.push(s);
      const z = top + 22;
      for (let k = 0; k < 2; k++) {
        const u0 = k * 0.5;
        const u1 = u0 + 0.5;
        const half: Ring = [
          { x: r0.x + e0.x * u0, y: r0.y + e0.y * u0 },
          { x: r0.x + e0.x * u1, y: r0.y + e0.y * u1 },
          { x: r0.x + e0.x * u1 + e3.x, y: r0.y + e0.y * u1 + e3.y },
          { x: r0.x + e0.x * u0 + e3.x, y: r0.y + e0.y * u0 + e3.y },
        ];
        const lanes = coverageLanes(half, 13, 3);
        // Cruise-speed entry leg above the roof, then slow nadir survey lanes.
        const wps: Waypoint[] = [{ x: lanes[0].x, y: lanes[0].y, z }, ...lanes.map((p) => ({ x: p.x, y: p.y, z, speed: 5, tilt: -90 }))];
        tasks.push(task(s, k, `Roof scan ${k ? 'east' : 'west'} half`, wps, [u0, u1], 1));
      }
      return;
    }
    if (key === 'GROUND') {
      const s = mk(i, 'GROUND', 'SURROUNDING AREA', 'G', groundRing, {});
      sectors.push(s);
      const c = ringCentroid(b.ring);
      const loop = offsetRect(b.ring, 26);
      for (let k = 0; k < 2; k++) {
        const z = k ? 30 : 24;
        const start = k ? 2 : 0;
        const pts = [...loop.slice(start), ...loop.slice(0, start), loop[start]];
        const ordered = k ? [...pts].reverse() : pts;
        const wps: Waypoint[] = [];
        const first = ordered[0];
        const out0 = norm({ x: first.x - c.x, y: first.y - c.y });
        wps.push({ x: first.x + out0.x * 30, y: first.y + out0.y * 30, z: safeZ });
        for (let j = 0; j < ordered.length; j++) {
          const p = ordered[j];
          const q = ordered[(j + 1) % ordered.length];
          for (const t of [0, 0.5]) {
            const x = p.x + (q.x - p.x) * t;
            const y = p.y + (q.y - p.y) * t;
            if (j === ordered.length - 1 && t > 0) break;
            const o = norm({ x: x - c.x, y: y - c.y });
            wps.push({ x, y, z, speed: 5, look: { x: x + o.x * 38, y: y + o.y * 38, z: 0 } });
          }
        }
        tasks.push(task(s, k, `Perimeter sweep ${k ? 'B' : 'A'}`, wps, [0, 1], 1));
      }
      return;
    }
    const w = walls.find((x) => x.name === key)!;
    const cols = Math.max(4, Math.round(w.len / 5));
    const rows = Math.max(3, Math.round(top / b.floor));
    const s = mk(i, 'FACADE', `${key} FACADE`, key[0], [w.a, w.b], {
      wall: { a: w.a, b: w.b, z0: 0, z1: top, normal: w.normal },
      facade: grid(cols, rows),
    });
    s.total = cols * rows;
    sectors.push(s);
    const dir = { x: (w.b.x - w.a.x) / w.len, y: (w.b.y - w.a.y) / w.len };
    const yaw = bearingOf({ x: -w.normal.x, y: -w.normal.y });
    const passes: number[] = [];
    for (let z = top - 4; z > 4; z -= 7.5) passes.push(z);
    for (let k = 0; k < 2; k++) {
      const u0 = k * 0.5 + 0.04;
      const u1 = k * 0.5 + 0.46;
      const at = (u: number, d: number, z: number): Vec3 => ({
        x: w.a.x + dir.x * w.len * u + w.normal.x * d,
        y: w.a.y + dir.y * w.len * u + w.normal.y * d,
        z,
      });
      const lock = { ax: w.a.x, ay: w.a.y, bx: w.b.x, by: w.b.y };
      const wps: Waypoint[] = [];
      const entry = at(k ? u1 : u0, FACADE_STANDOFF + 26, safeZ);
      wps.push({ ...entry, yaw });
      passes.forEach((z, j) => {
        const fwd = (j + k) % 2 === 0;
        const ua = fwd ? u0 : u1;
        const ub = fwd ? u1 : u0;
        wps.push({ ...at(ua, FACADE_STANDOFF, z), speed: FACADE_SPEED, yaw, facade: lock });
        wps.push({ ...at(ub, FACADE_STANDOFF, z), speed: FACADE_SPEED, yaw, facade: lock });
      });
      const exit = wps[wps.length - 1];
      wps.push({ x: exit.x + w.normal.x * 30, y: exit.y + w.normal.y * 30, z: safeZ });
      tasks.push(task(s, k, `${key[0]}${key.slice(1).toLowerCase()} facade ${k ? 'B' : 'A'}`, wps, [k * 0.5, k * 0.5 + 0.5], 1));
    }
  });
  return { sectors, tasks, groundRing, footprint: b.ring };
}

/** Facade-local (u, v) in [0,1) for a point on wall `s.wall`. */
export function facadeUV(s: Sector, p: Vec3): [number, number] | null {
  const w = s.wall;
  if (!w) return null;
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const l2 = dx * dx + dy * dy;
  const u = ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / l2;
  const v = (p.z - w.z0) / (w.z1 - w.z0);
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
  return [u, v];
}

/** Roof-local (u, v) using footprint edges 0→1 and 0→3. */
export function roofUV(ring: Ring, p: Vec2): [number, number] | null {
  const r0 = ring[0];
  const e0 = { x: ring[1].x - r0.x, y: ring[1].y - r0.y };
  const e3 = { x: ring[3].x - r0.x, y: ring[3].y - r0.y };
  const u = ((p.x - r0.x) * e0.x + (p.y - r0.y) * e0.y) / (e0.x * e0.x + e0.y * e0.y);
  const v = ((p.x - r0.x) * e3.x + (p.y - r0.y) * e3.y) / (e3.x * e3.x + e3.y * e3.y);
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
  return [u, v];
}
