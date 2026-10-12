import { DEG, pointInRing, Ring, Vec3 } from '../domain/geometry';
import { Payload, vfovFrom } from '../domain/sensor';

/** Extruded footprint (building) usable as a ray-cast surface. z in meters AGL. */
export interface Prism {
  id: string;
  ring: Ring;
  base: number;
  top: number;
}

export interface SensorRayHit {
  p: Vec3;
  t: number;
  surface: string; // 'ground' | `${prismId}:wall:${i}` | `${prismId}:roof` | 'sky'
}

export interface SensorSolution {
  origin: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  azimuth: number;
  elevation: number;
  hfov: number;
  vfov: number;
  range: number;
  /** Boresight hit. */
  target: SensorRayHit;
  /** Frustum edge samples, clockwise from top-left (TL→TR→BR→BL), `perEdge` samples per edge. */
  edge: SensorRayHit[];
  corners: SensorRayHit[];
  perEdge: number;
}

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => v3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
};
const cross = (a: Vec3, b: Vec3): Vec3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/** Boresight basis from absolute azimuth (cw from north) + elevation (deg, negative = down). */
export function sensorBasis(azimuth: number, elevation: number): { f: Vec3; r: Vec3; u: Vec3 } {
  const a = azimuth * DEG;
  const e = elevation * DEG;
  const f = v3(Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e));
  const r = norm(v3(Math.cos(a), -Math.sin(a), 0));
  const u = cross(r, f);
  return { f, r, u };
}

/** Nearest intersection of a ray with ground plane (z=0) and prisms, capped at `range`. */
export function castRay(o: Vec3, d: Vec3, prisms: readonly Prism[], range: number): SensorRayHit {
  let best: SensorRayHit = { p: add(o, d, range), t: range, surface: 'sky' };
  if (d.z < -1e-6) {
    const t = -o.z / d.z;
    if (t > 0 && t < best.t) best = { p: add(o, d, t), t, surface: 'ground' };
  }
  for (const pr of prisms) {
    const n = pr.ring.length;
    // Walls
    for (let i = 0; i < n; i++) {
      const a = pr.ring[i];
      const b = pr.ring[(i + 1) % n];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      // Solve o + d t = a + e s (2D), then check z.
      const den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-9) continue;
      const ax = a.x - o.x;
      const ay = a.y - o.y;
      const t = (ax * ey - ay * ex) / den;
      if (t <= 0.01 || t >= best.t) continue;
      const s = (ax * d.y - ay * d.x) / den;
      if (s < 0 || s > 1) continue;
      const z = o.z + d.z * t;
      if (z < pr.base || z > pr.top) continue;
      best = { p: v3(o.x + d.x * t, o.y + d.y * t, z), t, surface: `${pr.id}:wall:${i}` };
    }
    // Roof
    if (Math.abs(d.z) > 1e-9) {
      const t = (pr.top - o.z) / d.z;
      if (t > 0.01 && t < best.t) {
        const p = add(o, d, t);
        if (pointInRing(p, pr.ring)) best = { p, t, surface: `${pr.id}:roof` };
      }
    }
  }
  return best;
}

/**
 * Full sensor solution: pose + gimbal → frustum rays → hits on terrain plane / buildings.
 * Frustum edges are sampled so footprints wrap correctly over facades and roofs.
 */
export function solveSensor(
  origin: Vec3,
  heading: number,
  gimbalPan: number,
  gimbalTilt: number,
  payload: Pick<Payload, 'hfov' | 'fovMode' | 'aspect' | 'rangeM'>,
  prisms: readonly Prism[],
  perEdge = 6,
): SensorSolution {
  const azimuth = (heading + gimbalPan + 360) % 360;
  const elevation = gimbalTilt;
  const hfov = payload.hfov[payload.fovMode];
  const vfov = vfovFrom(hfov, payload.aspect);
  const { f, r, u } = sensorBasis(azimuth, elevation);
  const th = Math.tan((hfov / 2) * DEG);
  const tv = Math.tan((vfov / 2) * DEG);
  const range = payload.rangeM;
  const ray = (sx: number, sy: number) => norm(add(add(f, r, sx * th), u, sy * tv));

  const edge: SensorRayHit[] = [];
  const corners: SensorRayHit[] = [];
  // TL(-1,+1) → TR(+1,+1) → BR(+1,-1) → BL(-1,-1)
  const cs: [number, number][] = [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = cs[k];
    const [bx, by] = cs[(k + 1) % 4];
    for (let i = 0; i < perEdge; i++) {
      const t = i / perEdge;
      const hit = castRay(origin, ray(ax + (bx - ax) * t, ay + (by - ay) * t), prisms, range);
      edge.push(hit);
      if (i === 0) corners.push(hit);
    }
  }
  const target = castRay(origin, f, prisms, range);
  return { origin, forward: f, right: r, up: u, azimuth, elevation, hfov, vfov, range, target, edge, corners, perEdge };
}
