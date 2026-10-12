/** Local ENU meters relative to scenario origin. x = east, y = north, z = up (AGL unless noted). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Vec2 = Pick<Vec3, 'x' | 'y'>;

export type LngLat = [lng: number, lat: number];

/** Polygon ring in local meters (closed implicitly). */
export type Ring = Vec2[];

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const DEG = Math.PI / 180;

export function wrap360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Signed shortest angular difference b - a, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return wrap360(a + angleDiff(a, b) * t);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Compass bearing (deg, cw from north) from a to b. */
export function bearingTo(a: Vec2, b: Vec2): number {
  return wrap360(Math.atan2(b.x - a.x, b.y - a.y) / DEG);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function pointInRing(p: Vec2, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
