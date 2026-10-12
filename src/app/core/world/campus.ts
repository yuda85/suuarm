import { Ring, Vec2, Vec3 } from '../domain/geometry';
import { Prism } from '../sensor/sensor-geometry';
import { Rng } from '../sim/rng';

export type BuildingKind = 'TARGET' | 'LAB' | 'PARKING' | 'UTILITY' | 'PAVILION';

export interface CampusBuilding {
  id: string;
  name: string;
  kind: BuildingKind;
  /** Counter-clockwise footprint (local metres). */
  ring: Ring;
  top: number;
  floor: number;
}

export interface Wall {
  index: number;
  a: Vec3;
  b: Vec3;
  len: number;
  /** Outward unit normal (x east, y north). */
  normal: { x: number; y: number };
  /** Compass name of the facade (by outward normal). */
  name: 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';
}

export interface Car {
  x: number;
  y: number;
  heading: number;
  /** Engine recently run (thermal signature). */
  hot: boolean;
}

export interface Campus {
  id: string;
  name: string;
  rotation: number;
  plot: Ring;
  buildings: CampusBuilding[];
  hvac: Prism[];
  lots: Ring[];
  cars: Car[];
  target: CampusBuilding;
}

const ROT = 12;

function rotRect(cx: number, cy: number, w: number, h: number, rotDeg = ROT): Ring {
  const a = (rotDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // CCW order: BL, BR, TR, TL
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

function rotPoint(x: number, y: number, rotDeg = ROT): Vec2 {
  const a = (rotDeg * Math.PI) / 180;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
}

/** Al Reem research campus: deterministic, data-only (no rendering concerns). */
export function buildCampus(seed = 7): Campus {
  const rng = new Rng(seed);
  const at = (x: number, y: number) => rotPoint(x, y);
  const b = (id: string, name: string, kind: BuildingKind, x: number, y: number, w: number, h: number, top: number, floor = 3.8): CampusBuilding => {
    const c = at(x, y);
    return { id, name, kind, ring: rotRect(c.x, c.y, w, h), top, floor };
  };
  const buildings: CampusBuilding[] = [
    b('B1', 'Research Centre', 'TARGET', -18, 8, 66, 36, 38),
    b('B2', 'Laboratory Block', 'LAB', 92, 58, 44, 26, 18.5),
    b('B3', 'Parking Structure', 'PARKING', 86, -64, 54, 32, 9.5, 3.1),
    b('B4', 'Utility Plant', 'UTILITY', -128, -82, 22, 16, 8, 4),
    b('B5', 'Visitor Pavilion', 'PAVILION', -138, 72, 20, 20, 6.5, 6.5),
  ];
  const target = buildings[0];

  // Rooftop plant: the thermal story (exhausts run hot).
  const hvac: Prism[] = [];
  const unit = (id: string, x: number, y: number, w: number, h: number, base: number, tall: number) => {
    const c = at(x, y);
    hvac.push({ id, ring: rotRect(c.x, c.y, w, h), base, top: base + tall });
  };
  unit('H1', -36, 14, 7, 4.5, 38, 2.6);
  unit('H2', -24, 14, 7, 4.5, 38, 2.6);
  unit('H3', 0, 2, 5, 5, 38, 3.4);
  unit('H4', 14, 12, 4, 8, 38, 2.2);
  unit('H5', 88, 60, 8, 5, 18.5, 2.4);
  unit('H6', 100, 54, 4, 4, 18.5, 3);

  const lots = [rotRect(at(-108, -10).x, at(-108, -10).y, 54, 44), rotRect(at(-40, -60).x, at(-40, -60).y, 70, 22)];
  const cars: Car[] = [];
  const lotCars = (cx: number, cy: number, cols: number, rows: number, dx: number, dy: number, fill: number) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rng.next() > fill) continue;
        const p = at(cx + (c - (cols - 1) / 2) * dx, cy + (r - (rows - 1) / 2) * dy);
        cars.push({ x: p.x, y: p.y, heading: 90 - ROT + (r % 2 ? 180 : 0), hot: rng.next() < 0.3 });
      }
    }
  };
  lotCars(-108, -10, 9, 4, 5.4, 10, 0.72);
  lotCars(-40, -60, 12, 2, 5.4, 9, 0.6);

  return {
    id: 'reem-campus',
    name: 'Al Reem Research Campus',
    rotation: ROT,
    plot: rotRect(0, 0, 440, 320),
    buildings,
    hvac,
    lots,
    cars,
    target,
  };
}

export function campusPrisms(c: Campus): Prism[] {
  return [...c.buildings.map((b) => ({ id: b.id, ring: b.ring, base: 0, top: b.top })), ...c.hvac];
}

/** Facade walls of a CCW footprint, named by outward normal. */
export function wallsOf(b: CampusBuilding): Wall[] {
  const r = b.ring;
  return r.map((a, i) => {
    const bb = r[(i + 1) % r.length];
    const dx = bb.x - a.x;
    const dy = bb.y - a.y;
    const len = Math.hypot(dx, dy);
    const normal = { x: dy / len, y: -dx / len };
    const brg = ((Math.atan2(normal.x, normal.y) * 180) / Math.PI + 360) % 360;
    const name = brg >= 315 || brg < 45 ? 'NORTH' : brg < 135 ? 'EAST' : brg < 225 ? 'SOUTH' : 'WEST';
    return { index: i, a: { x: a.x, y: a.y, z: 0 }, b: { x: bb.x, y: bb.y, z: 0 }, len, normal, name };
  });
}
