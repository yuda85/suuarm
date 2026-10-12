import Supercluster, { type ClusterProperties, type PointFeature } from 'supercluster';
import { easeInOutCubic } from '../../core/domain/geometry';
import { VehicleCapability, VehicleState } from '../../core/domain/vehicle';
import { RenderFrame, RenderVehicle } from '../render-frame';

const STATES: VehicleState[] = ['ACTIVE', 'READY', 'HOLD', 'RETURNING', 'WARNING', 'OFFLINE'];
const CAPS: VehicleCapability[] = ['ISR', 'MAPPING', 'THERMAL', 'RELAY', 'INSPECTION', 'SEARCH', 'RESPONSE'];
const MAX_CLUSTER_ZOOM = 14.6;
const SPLIT_MS = 450;
const POP_MS = 260;

interface PointProps {
  i: number;
  s: number; // state index
  c: number; // capability index
  z: number;
}

interface AggProps {
  st: number[];
  cp: number[];
  zs: number;
}

export interface ClusterItem {
  id: number;
  position: [number, number, number];
  count: number;
  states: Record<VehicleState, number>;
  caps: Partial<Record<VehicleCapability, number>>;
  /** Pop-in scale 0..1 */
  scale: number;
  /** Donut key (quantised state mix) for icon caching. */
  key: string;
}

/**
 * Screen-space clustering of the fleet. Clusters carry the state + capability mix so a group of
 * 24 reads as "21 ACTIVE · 2 READY · 1 WARNING" without opening anything. Splits animate members
 * out from the cluster centre as you zoom in.
 */
export class ClusterEngine {
  clusters: ClusterItem[] = [];
  private index = this.makeIndex();
  private lastBuild = 0;
  private lastZoomKey = -1;
  /** vehicle id → cluster centre it currently belongs to */
  private memberOf = new Map<string, [number, number, number]>();
  private splitAnim = new Map<string, { from: [number, number, number]; t0: number }>();
  private bornAt = new Map<number, number>();

  private makeIndex(): Supercluster<PointProps, AggProps> {
    return new Supercluster<PointProps, AggProps>({
      radius: 60,
      extent: 512,
      maxZoom: Math.floor(MAX_CLUSTER_ZOOM),
      minPoints: 3,
      map: (p) => {
        const st = [0, 0, 0, 0, 0, 0];
        const cp = [0, 0, 0, 0, 0, 0, 0];
        st[p.s] = 1;
        cp[p.c] = 1;
        return { st, cp, zs: p.z };
      },
      reduce: (a, b) => {
        for (let k = 0; k < 6; k++) a.st[k] += b.st[k];
        for (let k = 0; k < 7; k++) a.cp[k] += b.cp[k];
        a.zs += b.zs;
      },
    });
  }

  /** Recluster at most every 400 ms (or immediately on zoom-bucket change). Returns hidden ids. */
  update(frame: RenderFrame, enabled: boolean, keepIds: Set<string>, now: number): void {
    const zoom = frame.zoom;
    const active = enabled && zoom < MAX_CLUSTER_ZOOM && frame.vehicles.length > 6 && !frame.povId;
    const zoomKey = active ? Math.floor(zoom * 2) : -2;
    if (!active) {
      if (this.clusters.length || this.memberOf.size) this.release(frame, now);
      this.clusters = [];
      for (const v of frame.vehicles) v.clustered = false;
      this.lastZoomKey = zoomKey;
      this.applyAnim(frame, now);
      return;
    }
    if (zoomKey !== this.lastZoomKey || now - this.lastBuild > 400) {
      this.lastZoomKey = zoomKey;
      this.lastBuild = now;
      this.rebuild(frame, keepIds, now);
    }
    this.applyAnim(frame, now);
  }

  private rebuild(frame: RenderFrame, keepIds: Set<string>, now: number): void {
    const pts: PointFeature<PointProps>[] = [];
    for (const v of frame.vehicles) {
      if (keepIds.has(v.id)) continue;
      pts.push({
        type: 'Feature',
        properties: { i: v.i, s: STATES.indexOf(v.state), c: CAPS.indexOf(v.capability), z: v.position[2] },
        geometry: { type: 'Point', coordinates: [v.position[0], v.position[1]] },
      });
    }
    this.index = this.makeIndex();
    this.index.load(pts);
    const raw = this.index.getClusters([-180, -85, 180, 85], Math.floor(frame.zoom));

    const nextMember = new Map<string, [number, number, number]>();
    const clusters: ClusterItem[] = [];
    const nextBorn = new Map<number, number>();
    for (const f of raw) {
      const p = f.properties as Partial<ClusterProperties & AggProps & PointProps>;
      if (!p.cluster) continue;
      const count = p.point_count ?? 0;
      const states = {} as Record<VehicleState, number>;
      STATES.forEach((s, k) => (states[s] = p.st![k]));
      const caps: Partial<Record<VehicleCapability, number>> = {};
      CAPS.forEach((c, k) => {
        if (p.cp![k]) caps[c] = p.cp![k];
      });
      const pos: [number, number, number] = [f.geometry.coordinates[0], f.geometry.coordinates[1], (p.zs ?? 0) / Math.max(1, count)];
      const id = p.cluster_id!;
      nextBorn.set(id, this.bornAt.get(id) ?? now);
      clusters.push({ id, position: pos, count, states, caps, scale: 1, key: donutKey(states, count) });
      for (const leaf of this.index.getLeaves(id, Infinity)) {
        nextMember.set(frame.vehicles[leaf.properties.i].id, pos);
      }
    }
    // Members leaving a cluster animate out from its centre.
    for (const [id, from] of this.memberOf) {
      if (!nextMember.has(id)) this.splitAnim.set(id, { from, t0: now });
    }
    this.memberOf = nextMember;
    this.bornAt = nextBorn;
    this.clusters = clusters;
    for (const v of frame.vehicles) v.clustered = nextMember.has(v.id);
  }

  private release(frame: RenderFrame, now: number): void {
    for (const [id, from] of this.memberOf) this.splitAnim.set(id, { from, t0: now });
    this.memberOf.clear();
    void frame;
  }

  private applyAnim(frame: RenderFrame, now: number): void {
    for (const c of this.clusters) {
      const b = this.bornAt.get(c.id) ?? now;
      c.scale = Math.min(1, 0.55 + (0.45 * (now - b)) / POP_MS);
    }
    if (!this.splitAnim.size) return;
    const byId = new Map<string, RenderVehicle>();
    for (const v of frame.vehicles) if (this.splitAnim.has(v.id)) byId.set(v.id, v);
    for (const [id, a] of this.splitAnim) {
      const t = (now - a.t0) / SPLIT_MS;
      const v = byId.get(id);
      if (t >= 1 || !v || v.clustered) {
        this.splitAnim.delete(id);
        continue;
      }
      const u = easeInOutCubic(t);
      v.position[0] = a.from[0] + (v.position[0] - a.from[0]) * u;
      v.position[1] = a.from[1] + (v.position[1] - a.from[1]) * u;
      v.position[2] = a.from[2] + (v.position[2] - a.from[2]) * u;
    }
  }

  expansionZoom(clusterId: number): number {
    try {
      return this.index.getClusterExpansionZoom(clusterId);
    } catch {
      return MAX_CLUSTER_ZOOM;
    }
  }
}

/** Quantise state mix to 36 segments so donut icons are cached and reused. */
function donutKey(states: Record<VehicleState, number>, count: number): string {
  const seg = STATES.map((s) => Math.round((states[s] / count) * 36));
  const size = count >= 100 ? 3 : count >= 25 ? 2 : count >= 8 ? 1 : 0;
  return `d${size}-${seg.join('.')}`;
}

export const CLUSTER_STATES = STATES;
