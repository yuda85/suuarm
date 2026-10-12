import type { Layer } from '@deck.gl/core';
import { PathStyleExtension } from '@deck.gl/extensions';
import { LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { DEG, Ring, Vec3 } from '../../core/domain/geometry';
import { Geofence, Track } from '../../core/domain/ops';
import { SimulationEngine } from '../../core/sim/engine';
import { airframeMesh } from '../meshes/mesh-builder';
import { RenderFrame } from '../render-frame';
import { meshScale, VEHICLE_FONT } from './vehicle-layers';

type P3 = [number, number, number];
const dash = new PathStyleExtension({ dash: true });

function trackColor(t: Track): [number, number, number] {
  switch (t.status) {
    case 'DEPARTING':
      return [134, 169, 211];
    case 'RESOLVED':
      return [93, 102, 115];
    default:
      return [242, 169, 59];
  }
}

export interface TrackDatum {
  t: Track;
  pos: P3;
  ground: P3;
  label: string;
  color: [number, number, number];
}

/** Aerial tracks: contact model, classification label, history, predicted vector, sensor locks. */
export function trackLayers(
  engine: SimulationEngine,
  frame: RenderFrame,
  toWorld: (p: Vec3, surface?: string) => P3,
  selectedTrack: string | null,
  alpha: number,
): Layer[] {
  const tracks = engine.response.tracks.filter((t) => t.status !== 'RESOLVED' || engine.tick - t.statusTick < 600);
  if (!tracks.length) return [];
  const n = frame.n;
  const data: TrackDatum[] = tracks.map((t) => {
    const dt = alpha * 0.1;
    const p = { x: t.pos.x + Math.sin(t.heading * DEG) * t.speed * dt, y: t.pos.y + Math.cos(t.heading * DEG) * t.speed * dt, z: t.pos.z };
    const cls = t.status === 'DETECTED' ? 'UNKNOWN' : t.status === 'CLASSIFYING' ? 'CLASSIFYING…' : t.cls;
    const tail = t.status === 'RESOLVED' ? 'RESOLVED' : t.status === 'DEPARTING' ? 'DEPARTING' : t.status === 'MONITORED' ? 'UNDER OBSERVATION' : 'NON-COOP';
    return {
      t,
      pos: toWorld(p, 'air'),
      ground: toWorld({ ...p, z: 0 }),
      label: `${t.id} · ${cls} · ${Math.round(t.confidence * 100)}% · ${tail}`,
      color: trackColor(t),
    };
  });
  const history = data.map((d) => ({ path: [...d.t.history.map((h) => toWorld(h, 'air')), d.pos], color: d.color }));
  const vectors = data
    .filter((d) => d.t.status !== 'RESOLVED')
    .map((d) => {
      const e = { x: d.t.pos.x + Math.sin(d.t.heading * DEG) * d.t.speed * 45, y: d.t.pos.y + Math.cos(d.t.heading * DEG) * d.t.speed * 45, z: d.t.pos.z };
      return { s: d.pos, e: toWorld(e, 'air'), color: d.color };
    });
  // Sensor-lock lines from the escorting group to their contact.
  const locks: { s: P3; e: P3 }[] = [];
  for (const d of data) {
    if (!d.t.missionId || d.t.status === 'RESOLVED') continue;
    const m = engine.missions.missions.find((x) => x.id === d.t.missionId);
    if (!m || m.status !== 'ACTIVE') continue;
    for (const id of m.taskIds) {
      const task = engine.missions.tasks.get(id);
      const rv = task?.vehicleId ? frame.vehicles.find((v) => v.id === task.vehicleId) : undefined;
      if (rv && rv.airborne && !rv.clustered) locks.push({ s: rv.position, e: d.pos });
    }
  }
  const scale = meshScale(frame) * 1.1;
  const mesh = airframeMesh('QUAD');
  return [
    new PathLayer<{ path: P3[]; color: [number, number, number] }>({
      id: 'track-history',
      data: history,
      getPath: (d) => d.path,
      getColor: (d) => [...d.color, 150],
      getWidth: 1.5,
      widthUnits: 'pixels',
      ...({ getDashArray: [2, 3] } as object),
      extensions: [dash],
      updateTriggers: { getPath: n },
    }),
    new LineLayer<{ s: P3; e: P3; color: [number, number, number] }>({
      id: 'track-vector',
      data: vectors,
      getSourcePosition: (d) => d.s,
      getTargetPosition: (d) => d.e,
      getColor: (d) => [...d.color, 200],
      getWidth: 1.5,
      widthUnits: 'pixels',
      updateTriggers: { getSourcePosition: n, getTargetPosition: n },
    }),
    new LineLayer<{ s: P3; e: P3 }>({
      id: 'track-locks',
      data: locks,
      getSourcePosition: (d) => d.s,
      getTargetPosition: (d) => d.e,
      getColor: [99, 162, 255, 150],
      getWidth: 1,
      widthUnits: 'pixels',
      updateTriggers: { getSourcePosition: n, getTargetPosition: n },
    }),
    new LineLayer<TrackDatum>({
      id: 'track-drop',
      data: data,
      getSourcePosition: (d) => d.ground,
      getTargetPosition: (d) => d.pos,
      getColor: (d) => [...d.color, 90],
      getWidth: 1,
      widthUnits: 'pixels',
      updateTriggers: { getSourcePosition: n, getTargetPosition: n },
    }),
    new SimpleMeshLayer<TrackDatum>({
      id: 'track-model',
      data: frame.dim === '3D' ? data : [],
      mesh: mesh.body as never,
      getPosition: (d) => d.pos,
      getOrientation: (d) => [8, 90 - d.t.heading, 0],
      getColor: [168, 150, 132, 255],
      sizeScale: scale,
      updateTriggers: { getPosition: n, getOrientation: n },
    }),
    new ScatterplotLayer<TrackDatum>({
      id: 'track-marker',
      data,
      getPosition: (d) => d.pos,
      getRadius: (d) => (d.t.id === selectedTrack ? 20 : 15),
      radiusUnits: 'pixels',
      stroked: true,
      filled: true,
      getFillColor: (d) => [...d.color, 30],
      getLineColor: (d) => [...d.color, 255],
      getLineWidth: (d) => (d.t.id === selectedTrack ? 2.5 : 1.75),
      lineWidthUnits: 'pixels',
      billboard: true,
      pickable: true,
      updateTriggers: { getPosition: n, getRadius: selectedTrack, getLineWidth: selectedTrack, getFillColor: n, getLineColor: n },
      parameters: { depthCompare: 'always' },
    }),
    new TextLayer<TrackDatum>({
      id: 'track-label',
      data,
      getPosition: (d) => d.pos,
      getText: (d) => d.label,
      getSize: 11,
      getColor: (d) => [...d.color, 255],
      getPixelOffset: [0, -28],
      background: true,
      getBackgroundColor: [7, 9, 13, 215],
      backgroundPadding: [5, 2],
      fontFamily: VEHICLE_FONT,
      fontWeight: 600,
      characterSet: 'auto',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      updateTriggers: { getPosition: n, getText: n, getColor: n },
      parameters: { depthCompare: 'always' },
    }),
  ];
}

interface FenceDatum {
  g: Geofence;
  base: P3[];
}

/** Restricted volumes as translucent extruded walls with crisp floor/ceiling outlines. */
export function geofenceLayers(fences: Geofence[], toWorld: (p: Vec3) => P3, is3D: boolean): Layer[] {
  if (!fences.length) return [];
  const data: FenceDatum[] = fences.map((g) => ({ g, base: g.ring.map((p) => toWorld({ x: p.x, y: p.y, z: g.floor })) }));
  const outline = (r: Ring, z: number) => {
    const pts = r.map((p) => toWorld({ x: p.x, y: p.y, z }));
    return [...pts, pts[0]];
  };
  const rings: { path: P3[]; top: boolean }[] = [];
  for (const g of fences) {
    rings.push({ path: outline(g.ring, g.floor + 0.5), top: false });
    if (is3D) rings.push({ path: outline(g.ring, g.ceiling), top: true });
  }
  const color = (g: Geofence): [number, number, number] => (g.kind === 'OPERATING' ? [61, 139, 255] : [240, 82, 79]);
  const labels = fences.map((g) => {
    const p = g.ring[0];
    return { at: toWorld({ x: p.x, y: p.y, z: is3D ? g.ceiling : 0 }), text: `${g.name} · ${g.kind} · ${g.floor}–${g.ceiling} m`, c: color(g) };
  });
  return [
    new SolidPolygonLayer<FenceDatum>({
      id: 'geofence-volume',
      data: is3D ? data : [],
      getPolygon: (d) => d.base,
      extruded: true,
      wireframe: false,
      getElevation: (d) => d.g.ceiling - d.g.floor,
      getFillColor: (d) => [...color(d.g), 16],
      material: false,
      parameters: { depthWriteEnabled: false },
    }),
    new SolidPolygonLayer<FenceDatum>({
      id: 'geofence-floor',
      data,
      getPolygon: (d) => d.base,
      getFillColor: (d) => [...color(d.g), is3D ? 8 : 22],
      parameters: { depthWriteEnabled: false, depthCompare: 'always' },
    }),
    new PathLayer<{ path: P3[]; top: boolean }>({
      id: 'geofence-rings',
      data: rings,
      getPath: (d) => d.path,
      getColor: (d) => (d.top ? [240, 82, 79, 120] : [240, 82, 79, 190]),
      getWidth: 1.25,
      widthUnits: 'pixels',
      ...({ getDashArray: (d: { top: boolean }) => (d.top ? [6, 6] : [0, 0]) } as object),
      extensions: [dash],
    }),
    new TextLayer<{ at: P3; text: string; c: [number, number, number] }>({
      id: 'geofence-labels',
      data: labels,
      getPosition: (d) => d.at,
      getText: (d) => d.text,
      getSize: 10,
      getColor: (d) => [...d.c, 230],
      background: true,
      getBackgroundColor: [7, 9, 13, 190],
      backgroundPadding: [4, 2],
      fontFamily: VEHICLE_FONT,
      fontWeight: 600,
      characterSet: 'auto',
      getTextAnchor: 'start',
      getAlignmentBaseline: 'bottom',
      parameters: { depthCompare: 'always' },
    }),
  ];
}
