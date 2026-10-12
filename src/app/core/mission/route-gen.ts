import { Vec3 } from '../domain/geometry';
import { Route, Waypoint } from '../domain/vehicle';

/** Closed circular route (n points), clockwise from north. */
export function ringRoute(cx: number, cy: number, r: number, z: number, n: number, id: string, speed?: number, startIndex = 0): Route {
  const pts: Waypoint[] = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.sin(a) * r, y: cy + Math.cos(a) * r, z, speed };
  });
  const k = ((startIndex % n) + n) % n;
  return { id, waypoints: [...pts.slice(k), ...pts.slice(0, k)], loop: true };
}

/** Racetrack between a and b offset by `width` to the right. */
export function racetrackRoute(a: Vec3, b: Vec3, width: number, id: string, speed?: number): Route {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (dy / len) * width;
  const ny = (-dx / len) * width;
  return {
    id,
    loop: true,
    waypoints: [
      { x: a.x, y: a.y, z: a.z, speed },
      { x: b.x, y: b.y, z: b.z, speed },
      { x: b.x + nx, y: b.y + ny, z: b.z, speed },
      { x: a.x + nx, y: a.y + ny, z: a.z, speed },
    ],
  };
}

/** Boustrophedon ("lawnmower") coverage over an axis-aligned box rotated by `rot` degrees. */
export function lawnmowerRoute(
  cx: number,
  cy: number,
  w: number,
  h: number,
  rot: number,
  spacing: number,
  z: number,
  id: string,
  loop = true,
  speed?: number,
): Route {
  const lanes = Math.max(2, Math.round(w / spacing));
  const c = Math.cos((rot * Math.PI) / 180);
  const s = Math.sin((rot * Math.PI) / 180);
  const pts: Waypoint[] = [];
  for (let i = 0; i <= lanes; i++) {
    const u = -w / 2 + (w * i) / lanes;
    const v0 = i % 2 === 0 ? -h / 2 : h / 2;
    const v1 = -v0;
    for (const v of [v0, v1]) pts.push({ x: cx + u * c + v * s, y: cy - u * s + v * c, z, speed, look: undefined });
  }
  return { id, waypoints: pts, loop };
}

/** Station-keeping hover/loiter point (relays). */
export function stationRoute(p: Vec3, id: string, r = 25): Route {
  return ringRoute(p.x, p.y, r, p.z, 6, id, 3);
}
