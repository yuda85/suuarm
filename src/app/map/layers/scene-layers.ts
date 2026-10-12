import type { Layer } from '@deck.gl/core';
import { PolygonLayer, TextLayer } from '@deck.gl/layers';
import { SimulationEngine } from '../../core/sim/engine';
import { padPosition } from '../../core/sim/fleet-factory';
import { LocalFrame } from '../../core/world/geo';
import { VEHICLE_FONT } from './vehicle-layers';

interface PadDatum {
  polygon: number[][];
}

/** Static scene (hubs, pads). Rebuilt only when the engine generation changes. */
export function sceneLayers(engine: SimulationEngine, geo: LocalFrame, groundZ: number): Layer[] {
  const pads: PadDatum[] = [];
  const hubAreas: PadDatum[] = [];
  const labels: { position: [number, number, number]; text: string }[] = [];
  for (const hub of engine.hubs) {
    const count = engine.vehicles.filter((v) => v.hubId === hub.id).length;
    const rows = Math.max(1, Math.ceil(count / hub.cols));
    for (let s = 0; s < count; s++) {
      const p = padPosition(hub, s);
      const h = 2.6;
      pads.push({
        polygon: geo.ringToLngLat(
          [
            { x: p.x - h, y: p.y - h },
            { x: p.x + h, y: p.y - h },
            { x: p.x + h, y: p.y + h },
            { x: p.x - h, y: p.y + h },
          ],
          groundZ + 0.15,
        ),
      });
    }
    const w = (hub.cols / 2) * hub.spacing + 6;
    const top = hub.pos.y + hub.spacing / 2 + 4;
    const bottom = hub.pos.y - (rows - 0.5) * hub.spacing - 4;
    hubAreas.push({
      polygon: geo.ringToLngLat(
        [
          { x: hub.pos.x - w, y: bottom },
          { x: hub.pos.x + w, y: bottom },
          { x: hub.pos.x + w, y: top },
          { x: hub.pos.x - w, y: top },
        ],
        groundZ + 0.1,
      ),
    });
    const ll = geo.toLngLat(hub.pos.x, top + 8);
    labels.push({ position: [ll[0], ll[1], groundZ + 1], text: hub.name });
  }

  return [
    new PolygonLayer<PadDatum>({
      id: 'hub-area',
      data: hubAreas,
      getPolygon: (d) => d.polygon,
      getFillColor: [12, 22, 38, 200],
      getLineColor: [61, 139, 255, 110],
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      stroked: true,
    }),
    new PolygonLayer<PadDatum>({
      id: 'hub-pads',
      data: pads,
      getPolygon: (d) => d.polygon,
      getFillColor: [22, 32, 46, 255],
      getLineColor: [134, 169, 211, 120],
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      stroked: true,
    }),
    new TextLayer({
      id: 'hub-labels',
      data: labels,
      getPosition: (d: { position: [number, number, number] }) => d.position,
      getText: (d: { text: string }) => d.text,
      getSize: 11,
      getColor: [134, 169, 211, 220],
      fontFamily: VEHICLE_FONT,
      fontWeight: 500,
      characterSet: 'auto',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      parameters: { depthCompare: 'always' },
    }),
  ];
}
