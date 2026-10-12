import type { Layer } from '@deck.gl/core';
import { PathStyleExtension } from '@deck.gl/extensions';
import { PathLayer, PolygonLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { Ring, Vec3 } from '../../core/domain/geometry';
import { Sector, SectorState } from '../../core/domain/mission';
import { ringCentroid } from '../../core/mission/polygon';
import { SimulationEngine } from '../../core/sim/engine';
import { VEHICLE_FONT } from './vehicle-layers';

type P3 = [number, number, number];
type ToWorld = (p: Vec3, surface?: string) => P3;

const SECTOR_FILL: Record<SectorState, [number, number, number, number]> = {
  UNASSIGNED: [134, 169, 211, 16],
  ASSIGNED: [61, 139, 255, 22],
  ACTIVE: [31, 200, 216, 26],
  SCANNED: [31, 200, 216, 8],
};
const SECTOR_LINE: Record<SectorState, [number, number, number, number]> = {
  UNASSIGNED: [134, 169, 211, 120],
  ASSIGNED: [61, 139, 255, 170],
  ACTIVE: [31, 200, 216, 220],
  SCANNED: [111, 207, 168, 200],
};
const dash = new PathStyleExtension({ dash: true });

interface SectorDatum {
  s: Sector;
  polygon: P3[];
  label: string;
  at: P3;
}

/**
 * Mission geometry: area, sectors (state-coloured), scanned coverage cells, planned/active routes.
 * Pure function of engine mission state — callers memoise on `missions.version`.
 */
export function missionLayers(engine: SimulationEngine, toWorld: ToWorld, is3D: boolean): Layer[] {
  const sys = engine.missions;
  const visible = sys.missions.filter((m) => m.status === 'PLANNED' || m.status === 'ACTIVE' || m.status === 'COMPLETE');
  if (!visible.length) return [];
  const flat = (r: Ring, z = 0.4): P3[] => r.map((p) => toWorld({ x: p.x, y: p.y, z }, 'ground'));

  const areas: { polygon: P3[]; planned: boolean }[] = [];
  const sectors: SectorDatum[] = [];
  const cells: P3[][] = [];
  const routes: { path: P3[]; planned: boolean }[] = [];

  for (const m of visible) {
    if (m.status === 'COMPLETE' && engine.tick - (m.completedTick ?? 0) > 600) continue;
    areas.push({ polygon: flat(m.intent.area, 0.3), planned: m.status === 'PLANNED' });
    for (const sid of m.sectorIds) {
      const s = sys.sectors.get(sid);
      if (!s || s.kind === 'FACADE' || s.kind === 'ROOF') continue;
      const c = ringCentroid(s.ring);
      const pct = s.total ? Math.round((s.scanned / s.total) * 100) : 0;
      sectors.push({
        s,
        polygon: flat(s.ring, 0.5),
        label: m.status === 'PLANNED' ? s.code : `${s.code} ${s.state === 'SCANNED' ? '✓' : pct + '%'}`,
        at: toWorld({ x: c.x, y: c.y, z: 1 }, 'ground'),
      });
    }
    const f = m.field;
    if (f) {
      const h = f.cell / 2;
      for (let r = 0; r < f.rows; r++) {
        for (let c = 0; c < f.cols; c++) {
          const i = r * f.cols + c;
          if (!f.scanned[i]) continue;
          const x = f.x0 + (c + 0.5) * f.cell;
          const y = f.y0 + (r + 0.5) * f.cell;
          cells.push(
            flat(
              [
                { x: x - h, y: y - h },
                { x: x + h, y: y - h },
                { x: x + h, y: y + h },
                { x: x - h, y: y + h },
              ],
              0.6,
            ),
          );
        }
      }
    }
    if (m.status !== 'COMPLETE') {
      for (const tid of m.taskIds) {
        const t = sys.tasks.get(tid);
        if (!t || t.state === 'COMPLETE') continue;
        const v = t.vehicleId ? engine.byId.get(t.vehicleId) : undefined;
        const pts: P3[] = [];
        if (v && m.status === 'PLANNED') pts.push(toWorld({ ...v.pos, z: Math.max(v.pos.z, 1) }));
        for (const w of t.route.waypoints) pts.push(toWorld(w, 'air'));
        routes.push({ path: is3D ? pts : pts.map((p) => [p[0], p[1], 0.5] as P3), planned: m.status === 'PLANNED' });
      }
    }
  }

  return [
    new PolygonLayer<{ polygon: P3[]; planned: boolean }>({
      id: 'mission-area',
      data: areas,
      getPolygon: (d) => d.polygon,
      filled: false,
      stroked: true,
      getLineColor: [232, 237, 243, 170],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      ...({ getDashArray: [8, 5], dashJustified: true } as object),
      extensions: [dash],
    }),
    new PolygonLayer<SectorDatum>({
      id: 'mission-sectors',
      data: sectors,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => SECTOR_FILL[d.s.state],
      getLineColor: (d) => SECTOR_LINE[d.s.state],
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      stroked: true,
      filled: true,
      pickable: true,
      parameters: { depthWriteEnabled: false, depthCompare: 'always' },
    }),
    new SolidPolygonLayer<P3[]>({
      id: 'mission-coverage',
      data: cells,
      getPolygon: (d) => d,
      getFillColor: [31, 200, 216, 72],
      parameters: { depthWriteEnabled: false, depthCompare: 'always' },
    }),
    new PathLayer<{ path: P3[]; planned: boolean }>({
      id: 'mission-routes',
      data: routes,
      getPath: (d) => d.path,
      getColor: (d) => (d.planned ? [99, 162, 255, 220] : [99, 162, 255, 90]),
      getWidth: (d) => (d.planned ? 1.75 : 1),
      widthUnits: 'pixels',
      ...({ getDashArray: (d: { planned: boolean }) => (d.planned ? [5, 4] : [0, 0]), dashJustified: false } as object),
      extensions: [dash],
    }),
    new TextLayer<SectorDatum>({
      id: 'mission-sector-labels',
      data: sectors,
      getPosition: (d) => d.at,
      getText: (d) => d.label,
      getSize: 10.5,
      getColor: (d) => SECTOR_LINE[d.s.state],
      background: true,
      getBackgroundColor: [7, 9, 13, 190],
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
