import { DEG, LngLat, Vec2, Vec3 } from '../domain/geometry';

/**
 * Local tangent-plane frame (ENU meters) anchored at a scenario origin.
 * Equirectangular with WGS84 meridian/parallel lengths at origin latitude — sub-meter
 * accurate across a city-sized operating area.
 */
export class LocalFrame {
  readonly mPerDegLat: number;
  readonly mPerDegLng: number;

  constructor(
    readonly originLng: number,
    readonly originLat: number,
  ) {
    const p = originLat * DEG;
    this.mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
    this.mPerDegLng = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  }

  toLngLat(x: number, y: number): LngLat {
    return [this.originLng + x / this.mPerDegLng, this.originLat + y / this.mPerDegLat];
  }

  fromLngLat(lng: number, lat: number): Vec2 {
    return { x: (lng - this.originLng) * this.mPerDegLng, y: (lat - this.originLat) * this.mPerDegLat };
  }

  /** Writes [lng, lat, z] into out at offset (for binary attribute buffers). */
  writeLngLat(p: Vec3, zOffset: number, out: Float64Array, offset: number): void {
    out[offset] = this.originLng + p.x / this.mPerDegLng;
    out[offset + 1] = this.originLat + p.y / this.mPerDegLat;
    out[offset + 2] = p.z + zOffset;
  }

  ringToLngLat(ring: Vec2[], z?: number): number[][] {
    return ring.map((p) => {
      const ll = this.toLngLat(p.x, p.y);
      return z === undefined ? ll : [ll[0], ll[1], z];
    });
  }
}

/** Formats lat/lng as aviation-style DMS-ish decimal. */
export function formatLatLng(lng: number, lat: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}°${ns}  ${Math.abs(lng).toFixed(5)}°${ew}`;
}
