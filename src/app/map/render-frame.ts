import { SensorType } from '../core/domain/sensor';
import { AirframeClass, VehicleCapability, VehicleState } from '../core/domain/vehicle';

export type RGBA = [number, number, number, number];

export const STATE_RGB: Record<VehicleState, [number, number, number]> = {
  READY: [134, 169, 211],
  ACTIVE: [31, 200, 216],
  HOLD: [163, 147, 255],
  RETURNING: [111, 207, 168],
  WARNING: [242, 169, 59],
  OFFLINE: [93, 102, 115],
};

export const ACCENT_RGB: [number, number, number] = [61, 139, 255];
export const CRITICAL_RGB: [number, number, number] = [240, 82, 79];

/** Per-frame interpolated vehicle, reused across frames (no GC churn). */
export interface RenderVehicle {
  i: number;
  id: string;
  callsign: string;
  cls: AirframeClass;
  capability: VehicleCapability;
  state: VehicleState;
  /** lng, lat, z AMSL */
  position: [number, number, number];
  ground: [number, number, number];
  /** local meters, AGL */
  local: [number, number, number];
  heading: number;
  pitch: number;
  roll: number;
  gimbalPan: number;
  gimbalTilt: number;
  airborne: boolean;
  color: RGBA;
  selected: boolean;
  hovered: boolean;
  /** Folded into a cluster this frame (not drawn individually). */
  clustered: boolean;
}

export interface RenderFrame {
  /** Monotonic counter → deck updateTriggers. */
  n: number;
  vehicles: RenderVehicle[];
  byClass: Record<AirframeClass, RenderVehicle[]>;
  selected: RenderVehicle | null;
  hovered: RenderVehicle | null;
  zoom: number;
  pitch: number;
  /** meters per pixel at view centre */
  mpp: number;
  dim: '2D' | '3D';
  /** Vehicle whose payload drives the main camera (SENSOR POV). Its own mesh/overlays are hidden. */
  povId: string | null;
  /** Active sensor visual simulation on the main canvas. */
  fx: SensorType | null;
}
