import type { Layer } from '@deck.gl/core';
import { LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { DEG, Vec3 } from '../../core/domain/geometry';
import { SensorType } from '../../core/domain/sensor';
import { SensorSolution } from '../../core/sensor/sensor-geometry';
import { VEHICLE_FONT } from './vehicle-layers';

export type P3 = [number, number, number];

export interface SensorView {
  vehicleId: string;
  label: string | null;
  type: SensorType;
  sol: SensorSolution;
  primary: boolean;
  /** Light rendering: boresight + footprint outline only (many concurrent sensors). */
  light?: boolean;
  /** Sensor origin in world coords (interpolated vehicle position). */
  originWorld: P3;
}

export type ToWorld = (p: Vec3, surface: string) => P3;

const SENSOR_RGB: [number, number, number] = [120, 176, 255];
const RADAR_RGB: [number, number, number] = [110, 220, 200];

interface Tri {
  polygon: P3[];
  a: number;
}

/**
 * Sensor geometry in 3D: translucent FOV frustum from the payload, footprint wrapped over terrain
 * and building faces, boresight to the target, feed letter tag. Answers "who is looking where".
 */
export function sensorLayers(views: SensorView[], toWorld: ToWorld, n: number, nowMs: number): Layer[] {
  const faces: Tri[] = [];
  const foot: Tri[] = [];
  const outlines: { path: P3[]; a: number }[] = [];
  const edges: { s: P3; e: P3; a: number }[] = [];
  const bores: { s: P3; e: P3; a: number }[] = [];
  const targets: { p: P3; a: number }[] = [];
  const tags: { p: P3; text: string }[] = [];
  const radar: Tri[] = [];
  const sweeps: { s: P3; e: P3 }[] = [];
  const radarOutlines: P3[][] = [];

  for (const v of views) {
    const o = v.originWorld;
    const s = v.sol;
    const strong = v.primary ? 1 : 0.55;
    if (v.label) tags.push({ p: o, text: `${v.label} · ${v.type}` });

    if (v.type === 'RADAR') {
      // Ground wedge ± hfov/2 out to range, sampled arc + rotating sweep.
      const segs = 24;
      const half = s.hfov / 2;
      const base = toWorld({ x: s.origin.x, y: s.origin.y, z: 0 }, 'ground');
      const arc: P3[] = [base];
      for (let i = 0; i < segs; i++) {
        const a0 = (s.azimuth - half + (s.hfov * i) / segs) * DEG;
        const a1 = (s.azimuth - half + (s.hfov * (i + 1)) / segs) * DEG;
        const p0 = toWorld({ x: s.origin.x + Math.sin(a0) * s.range, y: s.origin.y + Math.cos(a0) * s.range, z: 0 }, 'ground');
        const p1 = toWorld({ x: s.origin.x + Math.sin(a1) * s.range, y: s.origin.y + Math.cos(a1) * s.range, z: 0 }, 'ground');
        radar.push({ polygon: [base, p0, p1], a: 42 * strong });
        arc.push(p0);
        if (i === segs - 1) arc.push(p1);
      }
      const phase = ((nowMs / 2600) % 2) - 1; // -1..1 back-and-forth scan
      const sa = (s.azimuth + half * Math.sin(phase * Math.PI)) * DEG;
      sweeps.push({ s: base, e: toWorld({ x: s.origin.x + Math.sin(sa) * s.range, y: s.origin.y + Math.cos(sa) * s.range, z: 0 }, 'ground') });
      arc.push(base);
      radarOutlines.push(arc);
      continue;
    }

    const ring: P3[] = s.edge.map((h) => toWorld(h.p, h.surface));
    if (v.light) {
      const tw = toWorld(s.target.p, s.target.surface);
      if (s.target.surface !== 'sky') {
        outlines.push({ path: [...ring.filter((_, i) => s.edge[i].surface !== 'sky'), ring[0]], a: 120 });
        targets.push({ p: tw, a: 140 });
      }
      bores.push({ s: o, e: tw, a: 95 });
      continue;
    }
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      faces.push({ polygon: [o, a, b], a: 30 * strong });
    }
    const hitsSurface = s.target.surface !== 'sky';
    const tw = toWorld(s.target.p, s.target.surface);
    if (hitsSurface) {
      for (let i = 0; i < ring.length; i++) {
        const a = s.edge[i];
        const b = s.edge[(i + 1) % ring.length];
        if (a.surface === 'sky' || b.surface === 'sky') continue;
        foot.push({ polygon: [tw, ring[i], ring[(i + 1) % ring.length]], a: 70 * strong });
      }
      outlines.push({ path: [...ring.filter((_, i) => s.edge[i].surface !== 'sky'), ring[0]], a: 230 * strong });
      targets.push({ p: tw, a: 255 * strong });
    }
    for (let k = 0; k < 4; k++) edges.push({ s: o, e: ring[k * s.perEdge], a: 170 * strong });
    bores.push({ s: o, e: tw, a: 240 * strong });
  }

  const noDepthWrite = { depthWriteEnabled: false } as const;
  return [
    new SolidPolygonLayer<Tri>({
      id: 'sensor-radar-wedge',
      data: radar,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => [...RADAR_RGB, d.a],
      _full3d: true,
      updateTriggers: { getPolygon: n },
      parameters: noDepthWrite,
    }),
    new PathLayer<P3[]>({
      id: 'sensor-radar-outline',
      data: radarOutlines,
      getPath: (d) => d,
      getColor: [...RADAR_RGB, 160],
      getWidth: 1,
      widthUnits: 'pixels',
      updateTriggers: { getPath: n },
    }),
    new LineLayer<{ s: P3; e: P3 }>({
      id: 'sensor-radar-sweep',
      data: sweeps,
      getSourcePosition: (d) => d.s,
      getTargetPosition: (d) => d.e,
      getColor: [...RADAR_RGB, 220],
      getWidth: 2,
      widthUnits: 'pixels',
      updateTriggers: { getSourcePosition: n, getTargetPosition: n },
    }),
    new SolidPolygonLayer<Tri>({
      id: 'sensor-frustum',
      data: faces,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => [...SENSOR_RGB, d.a],
      _full3d: true,
      updateTriggers: { getPolygon: n },
      parameters: noDepthWrite,
    }),
    new SolidPolygonLayer<Tri>({
      id: 'sensor-footprint',
      data: foot,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => [...SENSOR_RGB, d.a],
      _full3d: true,
      updateTriggers: { getPolygon: n },
      parameters: noDepthWrite,
    }),
    new PathLayer<{ path: P3[]; a: number }>({
      id: 'sensor-footprint-outline',
      data: outlines,
      getPath: (d) => d.path,
      getColor: (d) => [170, 206, 255, d.a],
      getWidth: 1.5,
      widthUnits: 'pixels',
      updateTriggers: { getPath: n },
    }),
    new LineLayer<{ s: P3; e: P3; a: number }>({
      id: 'sensor-frustum-edges',
      data: edges,
      getSourcePosition: (d) => d.s,
      getTargetPosition: (d) => d.e,
      getColor: (d) => [...SENSOR_RGB, d.a],
      getWidth: 1,
      widthUnits: 'pixels',
      updateTriggers: { getSourcePosition: n, getTargetPosition: n },
    }),
    new LineLayer<{ s: P3; e: P3; a: number }>({
      id: 'sensor-boresight',
      data: bores,
      getSourcePosition: (d) => d.s,
      getTargetPosition: (d) => d.e,
      getColor: (d) => [235, 242, 255, d.a],
      getWidth: 1.5,
      widthUnits: 'pixels',
      updateTriggers: { getSourcePosition: n, getTargetPosition: n },
    }),
    new ScatterplotLayer<{ p: P3; a: number }>({
      id: 'sensor-target',
      data: targets,
      getPosition: (d) => d.p,
      getRadius: 7,
      radiusUnits: 'pixels',
      stroked: true,
      filled: true,
      getFillColor: [235, 242, 255, 60],
      getLineColor: (d) => [235, 242, 255, d.a],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      billboard: true,
      updateTriggers: { getPosition: n },
      parameters: { depthCompare: 'always' },
    }),
    new TextLayer<{ p: P3; text: string }>({
      id: 'sensor-tags',
      data: tags,
      getPosition: (d) => d.p,
      getText: (d) => d.text,
      getSize: 10.5,
      getColor: [10, 14, 20, 255],
      background: true,
      getBackgroundColor: [...SENSOR_RGB, 235],
      backgroundPadding: [4, 2],
      getPixelOffset: [0, 26],
      fontFamily: VEHICLE_FONT,
      characterSet: 'auto',
      fontWeight: 600,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'top',
      updateTriggers: { getPosition: n },
      parameters: { depthCompare: 'always' },
    }),
  ];
}
