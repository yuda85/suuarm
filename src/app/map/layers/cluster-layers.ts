import type { Layer } from '@deck.gl/core';
import { IconLayer, LineLayer, TextLayer } from '@deck.gl/layers';
import { VehicleState } from '../../core/domain/vehicle';
import { CLUSTER_STATES, ClusterItem } from '../clustering/cluster-engine';
import { STATE_RGB } from '../render-frame';
import { VEHICLE_FONT } from './vehicle-layers';

const ICON = 96;
const cache = new Map<string, string>();

/** Status donut: ring segments in fixed order so mixes are comparable cluster to cluster. */
function donut(key: string, states: Record<VehicleState, number>, count: number): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = ICON;
  const g = c.getContext('2d')!;
  const cx = ICON / 2;
  const r = ICON / 2 - 4;
  const ring = 9;
  g.beginPath();
  g.arc(cx, cx, r - ring / 2, 0, Math.PI * 2);
  g.fillStyle = 'rgba(12,16,22,0.92)';
  g.fill();
  let a = -Math.PI / 2;
  const gap = CLUSTER_STATES.filter((s) => states[s] > 0).length > 1 ? 0.06 : 0;
  for (const s of CLUSTER_STATES) {
    const n = states[s];
    if (!n) continue;
    const sweep = (n / count) * Math.PI * 2;
    g.beginPath();
    g.arc(cx, cx, r - ring / 2, a + gap / 2, a + sweep - gap / 2);
    const [R, G, B] = STATE_RGB[s];
    g.strokeStyle = s === 'OFFLINE' ? 'rgb(240,82,79)' : `rgb(${R},${G},${B})`;
    g.lineWidth = ring;
    g.lineCap = 'butt';
    g.stroke();
    a += sweep;
  }
  g.beginPath();
  g.arc(cx, cx, r + 1, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(232,237,243,0.18)';
  g.lineWidth = 1.5;
  g.stroke();
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

export function clusterLayers(clusters: ClusterItem[], groundOf: (lng: number, lat: number) => number, is3D: boolean, n: number): Layer[] {
  const size = (d: ClusterItem) => (30 + Math.min(26, Math.log2(d.count) * 5)) * d.scale;
  return [
    new LineLayer<ClusterItem>({
      id: 'cluster-stem',
      data: is3D ? clusters : [],
      getSourcePosition: (d) => [d.position[0], d.position[1], groundOf(d.position[0], d.position[1])],
      getTargetPosition: (d) => d.position,
      getColor: [134, 169, 211, 60],
      getWidth: 1,
      widthUnits: 'pixels',
      updateTriggers: { getSourcePosition: n, getTargetPosition: n },
    }),
    new IconLayer<ClusterItem>({
      id: 'cluster-donut',
      data: clusters,
      getPosition: (d) => d.position,
      getIcon: (d) => ({ id: d.key, url: donut(d.key, d.states, d.count), width: ICON, height: ICON, anchorY: ICON / 2 }),
      getSize: size,
      sizeUnits: 'pixels',
      billboard: true,
      pickable: true,
      updateTriggers: { getPosition: n, getSize: n, getIcon: n },
      parameters: { depthCompare: 'always' },
    }),
    new TextLayer<ClusterItem>({
      id: 'cluster-count',
      data: clusters,
      getPosition: (d) => d.position,
      getText: (d) => String(d.count),
      getSize: (d) => (d.count >= 100 ? 14 : 13) * d.scale,
      getColor: [232, 237, 243, 255],
      fontFamily: VEHICLE_FONT,
      fontWeight: 500,
      characterSet: '0123456789',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      updateTriggers: { getPosition: n, getText: n, getSize: n },
      parameters: { depthCompare: 'always' },
    }),
  ];
}
