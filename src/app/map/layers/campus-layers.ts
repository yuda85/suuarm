import type { Layer } from '@deck.gl/core';
import { PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { Ring, Vec3 } from '../../core/domain/geometry';
import { Sector } from '../../core/domain/mission';
import { SimulationEngine } from '../../core/sim/engine';
import { Campus, CampusBuilding, wallsOf } from '../../core/world/campus';
import { VEHICLE_FONT } from './vehicle-layers';

type P3 = [number, number, number];
type RGBA = [number, number, number, number];
export type CampusLook = 'TACTICAL' | 'EO' | 'THERMAL';

interface Body {
  b: CampusBuilding;
  polygon: P3[];
}
interface Quad {
  polygon: P3[];
  color: RGBA;
}

const PALETTE: Record<CampusLook, { target: RGBA; body: RGBA; parking: RGBA; window: RGBA; hvac: RGBA; lot: RGBA; carHot: RGBA; carCold: RGBA }> = {
  TACTICAL: {
    target: [58, 74, 98, 255],
    body: [38, 48, 62, 255],
    parking: [34, 42, 54, 255],
    window: [20, 28, 40, 255],
    hvac: [74, 86, 104, 255],
    lot: [17, 23, 31, 255],
    carHot: [70, 80, 94, 255],
    carCold: [70, 80, 94, 255],
  },
  EO: {
    target: [200, 194, 182, 255],
    body: [184, 178, 166, 255],
    parking: [150, 148, 142, 255],
    window: [58, 72, 86, 255],
    hvac: [156, 158, 160, 255],
    lot: [60, 62, 66, 255],
    carHot: [210, 210, 214, 255],
    carCold: [120, 30, 34, 255],
  },
  THERMAL: {
    target: [138, 138, 138, 255],
    body: [128, 128, 128, 255],
    parking: [150, 150, 150, 255],
    window: [70, 70, 70, 255],
    hvac: [255, 255, 255, 255],
    lot: [205, 205, 205, 255],
    carHot: [250, 250, 250, 255],
    carCold: [140, 140, 140, 255],
  },
};
const CAR_EO: RGBA[] = [
  [220, 220, 224, 255],
  [30, 32, 36, 255],
  [150, 154, 160, 255],
  [120, 30, 34, 255],
  [40, 60, 110, 255],
  [190, 186, 176, 255],
];

/**
 * The Building Scan world. Rendered in every view of the world (main map, sensor feeds, PIP) so
 * the operator sees the same geometry — and the same scan progress — from every vantage point.
 */
export function campusLayers(engine: SimulationEngine, campus: Campus, ground: number, toLL: (x: number, y: number) => [number, number], look: CampusLook): Layer[] {
  const pal = PALETTE[look];
  const P = (x: number, y: number, z: number): P3 => {
    const ll = toLL(x, y);
    return [ll[0], ll[1], ground + z];
  };
  const flat = (r: Ring, z: number): P3[] => r.map((p) => P(p.x, p.y, z));
  const suffix = look.toLowerCase();

  const bodies: Body[] = campus.buildings.map((b) => ({ b, polygon: flat(b.ring, 0) }));
  const windows: Quad[] = [];
  for (const b of campus.buildings) {
    if (b.kind === 'PAVILION') continue;
    for (const w of wallsOf(b)) {
      const floors = Math.floor(b.top / b.floor);
      const dir = { x: (w.b.x - w.a.x) / w.len, y: (w.b.y - w.a.y) / w.len };
      const off = 0.12;
      for (let k = 0; k < floors; k++) {
        const z0 = k * b.floor + (b.kind === 'PARKING' ? 1.1 : 1.0);
        const z1 = z0 + (b.kind === 'PARKING' ? 1.3 : 1.7);
        if (z1 > b.top - 0.4) continue;
        const u0 = 0.05;
        const u1 = 0.95;
        const at = (u: number, z: number): P3 =>
          P(w.a.x + dir.x * w.len * u + w.normal.x * off, w.a.y + dir.y * w.len * u + w.normal.y * off, z);
        windows.push({ polygon: [at(u0, z0), at(u1, z0), at(u1, z1), at(u0, z1)], color: pal.window });
      }
    }
  }
  const hvac: Body[] = campus.hvac.map((h) => ({ b: { id: h.id, name: '', kind: 'UTILITY', ring: h.ring, top: h.top - h.base, floor: 3 }, polygon: flat(h.ring, h.base) }));
  const cars = campus.cars.map((c, i) => {
    const a = (c.heading * Math.PI) / 180;
    const fx = Math.sin(a);
    const fy = Math.cos(a);
    const rx = fy;
    const ry = -fx;
    const L = 2.25;
    const W = 0.95;
    const ring: Ring = [
      { x: c.x - fx * L - rx * W, y: c.y - fy * L - ry * W },
      { x: c.x - fx * L + rx * W, y: c.y - fy * L + ry * W },
      { x: c.x + fx * L + rx * W, y: c.y + fy * L + ry * W },
      { x: c.x + fx * L - rx * W, y: c.y + fy * L - ry * W },
    ];
    const color = look === 'EO' ? CAR_EO[i % CAR_EO.length] : c.hot ? pal.carHot : pal.carCold;
    return { polygon: flat(ring, 0.15), color };
  });

  const layers: Layer[] = [
    new SolidPolygonLayer<P3[]>({
      id: `campus-lots-${suffix}`,
      data: campus.lots.map((r) => flat(r, 0.12)),
      getPolygon: (d) => d,
      getFillColor: pal.lot,
      parameters: { depthCompare: 'always' },
    }),
    new SolidPolygonLayer<Body>({
      id: `campus-bodies-${suffix}`,
      data: bodies,
      getPolygon: (d) => d.polygon,
      extruded: true,
      getElevation: (d) => d.b.top,
      getFillColor: (d) => (d.b.kind === 'TARGET' ? pal.target : d.b.kind === 'PARKING' ? pal.parking : pal.body),
      material: look === 'THERMAL' ? { ambient: 0.9, diffuse: 0.15, shininess: 0, specularColor: [0, 0, 0] } : { ambient: 0.5, diffuse: 0.55, shininess: 12, specularColor: [40, 44, 50] },
      pickable: look === 'TACTICAL',
    }),
    new SolidPolygonLayer<Quad>({
      id: `campus-windows-${suffix}`,
      data: windows,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.color,
      _full3d: true,
    }),
    new SolidPolygonLayer<Body>({
      id: `campus-hvac-${suffix}`,
      data: hvac,
      getPolygon: (d) => d.polygon,
      extruded: true,
      getElevation: (d) => d.b.top,
      getFillColor: pal.hvac,
      material: look === 'THERMAL' ? { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] } : undefined,
    }),
    new SolidPolygonLayer<{ polygon: P3[]; color: RGBA }>({
      id: `campus-cars-${suffix}`,
      data: cars,
      getPolygon: (d) => d.polygon,
      extruded: true,
      getElevation: 1.45,
      getFillColor: (d) => d.color,
      material: look === 'THERMAL' ? { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] } : undefined,
    }),
  ];

  if (look === 'TACTICAL') {
    const edges: { path: P3[]; target: boolean }[] = [];
    for (const b of campus.buildings) {
      const target = b.kind === 'TARGET';
      edges.push({ path: [...flat(b.ring, b.top + 0.05), P(b.ring[0].x, b.ring[0].y, b.top + 0.05)], target });
      for (const p of b.ring) edges.push({ path: [P(p.x, p.y, 0), P(p.x, p.y, b.top)], target });
    }
    layers.push(
      new PathLayer<{ path: P3[]; target: boolean }>({
        id: 'campus-edges',
        data: edges,
        getPath: (d) => d.path,
        getColor: (d) => (d.target ? [140, 176, 220, 210] : [96, 114, 138, 150]),
        getWidth: (d) => (d.target ? 1.4 : 1),
        widthUnits: 'pixels',
      }),
    );
  }

  layers.push(...coverageLayers(engine, campus, P, look));
  return layers;
}

/** Facade / roof scan cells — the building visibly fills in as the sensors sweep it. */
function coverageLayers(engine: SimulationEngine, campus: Campus, P: (x: number, y: number, z: number) => P3, look: CampusLook): Layer[] {
  if (look === 'THERMAL') return [];
  const sys = engine.missions;
  const m = [...sys.missions].reverse().find((x) => x.intent.type === 'BUILDING_SCAN' && (x.status !== 'COMPLETE' || engine.tick - (x.completedTick ?? 0) < 900));
  if (!m) return [];
  const sectors = m.sectorIds.map((id) => sys.sectors.get(id)!).filter((s) => s?.facade);
  const cells: Quad[] = [];
  const labels: { at: P3; text: string; s: Sector }[] = [];
  const eo = look === 'EO';
  for (const s of sectors) {
    const g = s.facade!;
    // In a sensor image the overlay is a light AR tint of what is already covered; on the map it is the full state.
    const scanned: RGBA = eo ? [31, 200, 216, 46] : [31, 200, 216, 150];
    const pending: RGBA = eo
      ? [0, 0, 0, 0]
      : s.state === 'ACTIVE'
        ? [31, 200, 216, 36]
        : s.state === 'ASSIGNED'
          ? [61, 139, 255, 42]
          : [134, 169, 211, 26];
    const pct = Math.round((s.scanned / Math.max(1, s.total)) * 100);
    if (s.kind === 'FACADE' && s.wall) {
      const w = s.wall;
      const dx = w.b.x - w.a.x;
      const dy = w.b.y - w.a.y;
      const off = 0.32;
      const gap = 0.16;
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const u0 = c / g.cols;
          const u1 = (c + 1) / g.cols;
          const z0 = w.z0 + ((w.z1 - w.z0) * r) / g.rows + gap;
          const z1 = w.z0 + ((w.z1 - w.z0) * (r + 1)) / g.rows - gap;
          const len = Math.hypot(dx, dy);
          const gu = gap / len;
          const at = (u: number, z: number): P3 => P(w.a.x + dx * u + w.normal.x * off, w.a.y + dy * u + w.normal.y * off, z);
          cells.push({
            polygon: [at(u0 + gu, z0), at(u1 - gu, z0), at(u1 - gu, z1), at(u0 + gu, z1)],
            color: g.cells[r * g.cols + c] ? scanned : pending,
          });
        }
      }
      if (look === 'TACTICAL') {
        labels.push({
          at: P((w.a.x + w.b.x) / 2 + w.normal.x * 7, (w.a.y + w.b.y) / 2 + w.normal.y * 7, w.z1 * 0.55),
          text: `${s.code} · ${s.state === 'SCANNED' ? 'COMPLETE' : pct + '%'}`,
          s,
        });
      }
    } else if (s.kind === 'ROOF') {
      const ring = s.ring;
      const r0 = ring[0];
      const e0 = { x: ring[1].x - r0.x, y: ring[1].y - r0.y };
      const e3 = { x: ring[3].x - r0.x, y: ring[3].y - r0.y };
      const z = (s.z ?? 0) + 0.3;
      const gu = 0.25 / Math.hypot(e0.x, e0.y);
      const gv = 0.25 / Math.hypot(e3.x, e3.y);
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const u0 = c / g.cols + gu;
          const u1 = (c + 1) / g.cols - gu;
          const v0 = r / g.rows + gv;
          const v1 = (r + 1) / g.rows - gv;
          const at = (u: number, v: number): P3 => P(r0.x + e0.x * u + e3.x * v, r0.y + e0.y * u + e3.y * v, z);
          cells.push({ polygon: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], color: g.cells[r * g.cols + c] ? scanned : pending });
        }
      }
      if (look === 'TACTICAL') {
        const c = { x: r0.x + (e0.x + e3.x) / 2, y: r0.y + (e0.y + e3.y) / 2 };
        labels.push({ at: P(c.x, c.y, z + 6), text: `R · ${s.state === 'SCANNED' ? 'COMPLETE' : pct + '%'}`, s });
      }
    }
  }
  void campus;
  return [
    new SolidPolygonLayer<Quad>({
      id: `campus-coverage-${look}`,
      data: cells,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.color,
      _full3d: true,
      parameters: { depthWriteEnabled: false },
    }),
    new TextLayer<{ at: P3; text: string; s: Sector }>({
      id: 'campus-sector-labels',
      data: labels,
      getPosition: (d) => d.at,
      getText: (d) => d.text,
      getSize: 10.5,
      getColor: (d) => (d.s.state === 'SCANNED' ? [111, 207, 168, 255] : d.s.state === 'ACTIVE' ? [31, 200, 216, 255] : [170, 196, 230, 230]),
      background: true,
      getBackgroundColor: [7, 9, 13, 200],
      backgroundPadding: [5, 2],
      fontFamily: VEHICLE_FONT,
      fontWeight: 600,
      characterSet: 'auto',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      parameters: { depthCompare: 'always' },
    }),
  ];
}

export function campusFocus(campus: Campus): Vec3 {
  const r = campus.target.ring;
  return { x: (r[0].x + r[2].x) / 2, y: (r[0].y + r[2].y) / 2, z: campus.target.top / 2 };
}
