import { Vec3 } from './geometry';

export type SensorType = 'EO' | 'THERMAL' | 'IR' | 'RADAR';
export type PayloadStatus = 'ONLINE' | 'STANDBY' | 'FAULT' | 'OFFLINE';
export type FovMode = 'WFOV' | 'MFOV' | 'NFOV';

export interface Payload {
  id: string; // UAV-007/EO
  type: SensorType;
  model: string;
  status: PayloadStatus;
  /** Horizontal FOV by zoom mode, degrees. */
  hfov: Record<FovMode, number>;
  fovMode: FovMode;
  /** Sensor aspect ratio width/height. */
  aspect: number;
  /** Max useful range meters. */
  rangeM: number;
}

/** Fully resolved sensor pose in world (local ENU, z AMSL-agnostic = AGL). */
export interface SensorPose {
  vehicleId: string;
  payloadId: string;
  type: SensorType;
  origin: Vec3;
  /** Absolute azimuth of boresight, deg cw from north. */
  azimuth: number;
  /** Elevation of boresight, deg (negative = looking down). */
  elevation: number;
  hfov: number;
  vfov: number;
}

export interface SensorFootprint {
  vehicleId: string;
  payloadId: string;
  /** Frustum far corners (where rays hit surface or max range). TL, TR, BR, BL. */
  corners: Vec3[];
  /** Boresight hit point. */
  target: Vec3 | null;
  slantRange: number;
  /** Surface id hit by boresight: 'ground' | facade/roof id. */
  surface: string;
}

export function vfovFrom(hfov: number, aspect: number): number {
  const h = (hfov * Math.PI) / 360;
  return ((2 * Math.atan(Math.tan(h) / aspect)) * 180) / Math.PI;
}
