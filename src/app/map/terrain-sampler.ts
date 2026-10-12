import type { Map as MlMap } from 'maplibre-gl';
import { LocalFrame } from '../core/world/geo';

const CELL = 40;

/**
 * Ground elevation (m AMSL) under local points. deck.gl draws in AMSL, the sim works AGL —
 * this bridges them. Cached on a 40 m grid; unresolved cells retry until DEM tiles arrive.
 */
export class TerrainSampler {
  private cache = new Map<number, number>();
  enabled = true;

  constructor(
    private readonly map: MlMap,
    private readonly geo: LocalFrame,
  ) {}

  reset(): void {
    this.cache.clear();
  }

  elevation(x: number, y: number): number {
    if (!this.enabled) return 0;
    const cx = Math.round(x / CELL);
    const cy = Math.round(y / CELL);
    const key = cx * 100003 + cy;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const ll = this.geo.toLngLat(cx * CELL, cy * CELL);
    let e: number | null = null;
    try {
      e = this.map.queryTerrainElevation(ll);
    } catch {
      e = null;
    }
    if (e === null || !Number.isFinite(e)) return 0;
    const v = Math.max(0, e);
    this.cache.set(key, v);
    return v;
  }
}
