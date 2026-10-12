import type { Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { area as turfArea } from '@turf/area';
import { circle as turfCircle } from '@turf/circle';
import { lineString, polygon as turfPolygon } from '@turf/helpers';
import { length as turfLength } from '@turf/length';
import { Vec2 } from '../../core/domain/geometry';
import { formatLatLng, LocalFrame } from '../../core/world/geo';
import { VEHICLE_FONT } from '../layers/vehicle-layers';

export type AnnotationKind = 'distance' | 'area' | 'radius' | 'poi' | 'coord';

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  /** lng/lat vertices */
  pts: [number, number][];
  label: string;
  /** Per-segment labels for distance measurements. */
  segments?: { at: [number, number]; text: string }[];
  ring?: [number, number][];
}

type P3 = [number, number, number];

export function fmtDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km`;
}

export function fmtArea(m2: number): string {
  if (m2 < 10000) return `${Math.round(m2).toLocaleString('en')} m²`;
  if (m2 < 1e6) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${(m2 / 1e6).toFixed(2)} km²`;
}

let seq = 0;

/** Build a measured annotation from local drawing points (geodesic measures via Turf). */
export function makeAnnotation(kind: AnnotationKind, local: Vec2[], geo: LocalFrame): Annotation {
  const pts = local.map((p) => geo.toLngLat(p.x, p.y) as [number, number]);
  const id = `${kind.toUpperCase()}-${++seq}`;
  switch (kind) {
    case 'distance': {
      const segs: { at: [number, number]; text: string }[] = [];
      for (let i = 1; i < pts.length; i++) {
        const km = turfLength(lineString([pts[i - 1], pts[i]]), { units: 'kilometers' });
        segs.push({ at: [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2], text: fmtDistance(km) });
      }
      const total = turfLength(lineString(pts), { units: 'kilometers' });
      return { id, kind, pts, label: `Σ ${fmtDistance(total)}`, segments: pts.length > 2 ? segs : [] };
    }
    case 'area': {
      const ring = [...pts, pts[0]];
      const m2 = turfArea(turfPolygon([ring]));
      const perim = turfLength(lineString(ring), { units: 'kilometers' });
      return { id, kind, pts, label: `${fmtArea(m2)} · perimeter ${fmtDistance(perim)}`, ring };
    }
    case 'radius': {
      const [c, e] = pts;
      const km = turfLength(lineString([c, e]), { units: 'kilometers' });
      const circ = turfCircle(c, km, { steps: 72, units: 'kilometers' });
      const ring = circ.geometry.coordinates[0] as [number, number][];
      return { id, kind, pts, label: `r ${fmtDistance(km)} · ${fmtArea(Math.PI * (km * 1000) ** 2)}`, ring };
    }
    case 'poi':
      return { id: `POI-${seq}`, kind, pts, label: `POI-${seq}` };
    case 'coord':
      return { id, kind, pts, label: formatLatLng(pts[0][0], pts[0][1]) };
  }
}

/** Render operator annotations (measurements, POIs, coordinate pins). */
export function annotationLayers(list: Annotation[], ground: number): Layer[] {
  if (!list.length) return [];
  const z = (p: [number, number], dz = 0.6): P3 => [p[0], p[1], ground + dz];
  const lines = list.filter((a) => a.kind === 'distance').map((a) => a.pts.map((p) => z(p)));
  const rings = list.filter((a) => a.ring).map((a) => ({ a, ring: a.ring!.map((p) => z(p)) }));
  const pins = list.filter((a) => a.kind === 'poi' || a.kind === 'coord');
  const vertices = list.filter((a) => a.kind === 'distance' || a.kind === 'area' || a.kind === 'radius').flatMap((a) => a.pts.map((p) => z(p)));
  const labels = list.map((a) => {
    const at = a.kind === 'distance' ? a.pts[a.pts.length - 1] : a.kind === 'area' ? centroid(a.pts) : a.pts[a.kind === 'radius' ? 1 : 0];
    return { at: z(at, 2), text: a.kind === 'poi' ? a.label : a.label, kind: a.kind };
  });
  const segs = list.flatMap((a) => (a.segments ?? []).map((s) => ({ at: z(s.at, 1.5), text: s.text })));
  const C: [number, number, number] = [245, 196, 92];
  return [
    new SolidPolygonLayer<{ a: Annotation; ring: P3[] }>({
      id: 'anno-fill',
      data: rings,
      getPolygon: (d) => d.ring,
      getFillColor: [...C, 28],
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
    }),
    new PathLayer<P3[]>({
      id: 'anno-lines',
      data: [...lines, ...rings.map((r) => r.ring)],
      getPath: (d) => d,
      getColor: [...C, 235],
      getWidth: 2,
      widthUnits: 'pixels',
      parameters: { depthCompare: 'always' },
    }),
    new ScatterplotLayer<P3>({
      id: 'anno-vertices',
      data: vertices,
      getPosition: (d) => d,
      getRadius: 3.5,
      radiusUnits: 'pixels',
      getFillColor: [7, 9, 13, 255],
      stroked: true,
      getLineColor: [...C, 255],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      parameters: { depthCompare: 'always' },
    }),
    new ScatterplotLayer<Annotation>({
      id: 'anno-pins',
      data: pins,
      getPosition: (d) => z(d.pts[0], 1),
      getRadius: (d) => (d.kind === 'poi' ? 7 : 5),
      radiusUnits: 'pixels',
      getFillColor: (d) => (d.kind === 'poi' ? [...C, 255] : [232, 237, 243, 255]),
      stroked: true,
      getLineColor: [7, 9, 13, 255],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      pickable: true,
      parameters: { depthCompare: 'always' },
    }),
    new TextLayer<{ at: P3; text: string }>({
      id: 'anno-seg-labels',
      data: segs,
      getPosition: (d) => d.at,
      getText: (d) => d.text,
      getSize: 10,
      getColor: [...C, 255],
      background: true,
      getBackgroundColor: [7, 9, 13, 200],
      backgroundPadding: [3, 1],
      fontFamily: VEHICLE_FONT,
      characterSet: 'auto',
      parameters: { depthCompare: 'always' },
    }),
    new TextLayer<{ at: P3; text: string; kind: AnnotationKind }>({
      id: 'anno-labels',
      data: labels,
      getPosition: (d) => d.at,
      getText: (d) => d.text,
      getSize: 11,
      getColor: (d) => (d.kind === 'coord' ? [232, 237, 243, 255] : [...C, 255]),
      getPixelOffset: [0, -16],
      background: true,
      getBackgroundColor: [7, 9, 13, 225],
      backgroundPadding: [5, 2],
      fontFamily: VEHICLE_FONT,
      fontWeight: 600,
      characterSet: 'auto',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      parameters: { depthCompare: 'always' },
    }),
  ];
}

function centroid(pts: [number, number][]): [number, number] {
  const n = pts.length || 1;
  return [pts.reduce((a, p) => a + p[0], 0) / n, pts.reduce((a, p) => a + p[1], 0) / n];
}
