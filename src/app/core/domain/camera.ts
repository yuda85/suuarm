export type CameraMode = 'FREE_2D' | 'FREE_3D' | 'TACTICAL' | 'FOLLOW_VEHICLE' | 'SENSOR_POV';

export interface FollowParams {
  /** Horizontal distance behind vehicle, m. */
  distance: number;
  /** Height above vehicle, m. */
  height: number;
  /** Orbit offset from vehicle heading, deg. */
  bearingOffset: number;
}

export interface SensorPovParams {
  vehicleId: string;
  payloadId: string;
  heading: number;
  pitch: number;
  fov: number;
}

export interface CameraState {
  mode: CameraMode;
  targetVehicleId: string | null;
  follow: FollowParams;
  pov: SensorPovParams | null;
  transitioning: boolean;
}

export const DEFAULT_FOLLOW: FollowParams = { distance: 26, height: 9, bearingOffset: 0 };
