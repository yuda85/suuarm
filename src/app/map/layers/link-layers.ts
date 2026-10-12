import type { Layer } from '@deck.gl/core';
import { PathStyleExtension } from '@deck.gl/extensions';
import { LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { Vec3 } from '../../core/domain/geometry';
import { SimulationEngine } from '../../core/sim/engine';
import { RenderFrame } from '../render-frame';
import { VEHICLE_FONT } from './vehicle-layers';

type P3 = [number, number, number];
const dash = new PathStyleExtension({ dash: true });

interface Link {
  s: P3;
  e: P3;
  q: number;
}

/** C2 mesh: each airborne asset's active link to a ground station or airborne relay, coloured by quality. */
export function linkLayers(engine: SimulationEngine, frame: RenderFrame, toWorld: (p: Vec3) => P3): Layer[] {
  const n = frame.n;
  const byId = new Map(frame.vehicles.map((v) => [v.id, v]));
  const hubs = new Map(engine.hubs.map((h) => [h.id, h]));
  const links: Link[] = [];
  for (const rv of frame.vehicles) {
    if (!rv.airborne || rv.clustered) continue;
    const v = engine.vehicles[rv.i];
    if (v.opState === 'OFFLINE' || v.health.linkLost) continue;
    const relay = byId.get(v.link.via);
    const hub = hubs.get(v.link.via);
    const e = relay ? relay.position : hub ? toWorld({ ...hub.pos, z: 12 }) : null;
    if (!e) continue;
    links.push({ s: rv.position, e, q: v.link.quality });
  }
  const color = (q: number): [number, number, number, number] =>
    q > 0.7 ? [31, 200, 216, 70] : q > 0.35 ? [242, 169, 59, 150] : [240, 82, 79, 190];
  const stations = engine.hubs.map((h) => ({ p: toWorld({ ...h.pos, z: 12 }), name: `GCS · ${h.name}` }));
  return [
    new LineLayer<Link>({
      id: 'link-lines',
      data: links,
      getSourcePosition: (d) => d.s,
      getTargetPosition: (d) => d.e,
      getColor: (d) => color(d.q),
      getWidth: (d) => (d.q > 0.7 ? 1 : 1.5),
      widthUnits: 'pixels',
      ...({ getDashArray: (d: Link) => (d.q > 0.35 ? [0, 0] : [4, 3]) } as object),
      extensions: [dash],
      updateTriggers: { getSourcePosition: n, getTargetPosition: n, getColor: n },
    }),
    new ScatterplotLayer<{ p: P3; name: string }>({
      id: 'link-stations',
      data: stations,
      getPosition: (d) => d.p,
      getRadius: 6,
      radiusUnits: 'pixels',
      getFillColor: [7, 9, 13, 255],
      stroked: true,
      getLineColor: [31, 200, 216, 220],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
    }),
    new TextLayer<{ p: P3; name: string }>({
      id: 'link-station-labels',
      data: stations,
      getPosition: (d) => d.p,
      getText: (d) => d.name,
      getSize: 9.5,
      getColor: [31, 200, 216, 220],
      getPixelOffset: [0, 14],
      fontFamily: VEHICLE_FONT,
      characterSet: 'auto',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'top',
    }),
  ];
}
