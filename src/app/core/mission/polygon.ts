import { Ring, Vec2 } from '../domain/geometry';

export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x + r[i].x) * (r[j].y - r[i].y);
  return Math.abs(a / 2);
}

export function ringCentroid(r: Ring): Vec2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j].x * r[i].y - r[i].x * r[j].y;
    cx += (r[j].x + r[i].x) * f;
    cy += (r[j].y + r[i].y) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = r.length || 1;
    return { x: r.reduce((s, p) => s + p.x, 0) / n, y: r.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function rotate(p: Vec2, ang: number, o: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const x = p.x - o.x;
  const y = p.y - o.y;
  return { x: o.x + x * c - y * s, y: o.y + x * s + y * c };
}

/** Angle (rad) of the polygon's longest edge — the natural sweep axis. */
export function principalAngle(r: Ring): number {
  let best = 0;
  let ang = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > best) {
      best = l;
      ang = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  return ang;
}

export function bounds(r: Ring): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of r) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

/** Sutherland–Hodgman clip of `r` to the half-plane x ≥ x0 (keepGreater) or x ≤ x0. */
function clipX(r: Ring, x0: number, keepGreater: boolean): Ring {
  const out: Ring = [];
  const inside = (p: Vec2) => (keepGreater ? p.x >= x0 : p.x <= x0);
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (x0 - a.x) / (b.x - a.x);
      out.push({ x: x0, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

export function clipToXRange(r: Ring, x0: number, x1: number): Ring {
  return clipX(clipX(r, x0, true), x1, false);
}

/** X-extent where the horizontal line y crosses the polygon (min/max of crossings). */
export function scanline(r: Ring, y: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  if (xs.length < 2) return null;
  return [Math.min(...xs), Math.max(...xs)];
}

/** Boustrophedon lanes covering polygon `r`, lanes parallel to its long axis, `spacing` apart. */
export function coverageLanes(r: Ring, spacing: number, inset = 6): Vec2[] {
  const ang = principalAngle(r);
  const c = ringCentroid(r);
  const rr = r.map((p) => rotate(p, -ang, c));
  const b = bounds(rr);
  const pts: Vec2[] = [];
  const n = Math.max(1, Math.ceil((b.maxY - b.minY) / spacing));
  const step = (b.maxY - b.minY) / n;
  for (let j = 0; j < n; j++) {
    const y = b.minY + step * (j + 0.5);
    const s = scanline(rr, y);
    if (!s || s[1] - s[0] < inset * 2 + 2) continue;
    const [x0, x1] = [s[0] + inset, s[1] - inset];
    const lane = j % 2 === 0 ? [x0, x1] : [x1, x0];
    for (const x of lane) pts.push(rotate({ x, y }, ang, c));
  }
  return pts;
}

/** Split polygon into k slices along its long axis (equal width). */
export function sliceRing(r: Ring, k: number): Ring[] {
  const ang = principalAngle(r);
  const c = ringCentroid(r);
  const rr = r.map((p) => rotate(p, -ang, c));
  const b = bounds(rr);
  const w = (b.maxX - b.minX) / k;
  const out: Ring[] = [];
  for (let i = 0; i < k; i++) {
    const part = clipToXRange(rr, b.minX + i * w, b.minX + (i + 1) * w);
    if (part.length >= 3) out.push(part.map((p) => rotate(p, ang, c)));
  }
  return out;
}

export function pointInQuad(p: Vec2, q: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cr !== 0) {
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}
