import { LngLat, Vec3 } from './geometry';
import { Geofence, Hub, Poi, ScriptedEvent } from './ops';
import { Route, VehicleCapability } from './vehicle';
import type { Prism } from '../sensor/sensor-geometry';
import type { Campus } from '../world/campus';
import { MissionIntent } from './mission';
import { Ring } from './geometry';

export type FleetSize = 5 | 10 | 20 | 50 | 100 | 500;
export const FLEET_SIZES: FleetSize[] = [5, 10, 20, 50, 100, 500];

export interface VehicleSeed {
  capability: VehicleCapability;
  hubId: string;
  /** Explicit state of charge (otherwise seeded random). */
  battery?: number;
  /** If set, vehicle starts airborne on this background route (ACTIVE regardless of swarm mode). */
  background?: { route: Route; startIndex?: number; altitude?: number };
}

export interface ViewSpec {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Data-driven scenario. New scenarios plug in without touching core engine/UI. */
export interface ScenarioDefinition {
  id: string;
  name: string;
  missionName: string;
  origin: LngLat;
  seed: number;
  defaultFleetSize: FleetSize;
  view: ViewSpec;
  hubs: Hub[];
  /** Hub whose READY assets are available to the primary mission. */
  missionHubId: string;
  geofences: Geofence[];
  pois: Poi[];
  fleet(size: FleetSize): VehicleSeed[];
  /** Intent used when the operator activates the swarm without a custom plan. */
  defaultIntent(): MissionIntent;
  /** Named operator areas offered in the mission builder. */
  presetAreas: { id: string; name: string; ring: Ring }[];
  /** Max plausible ground elevation (m); DEM spikes above are flattened (coastal DSM artefacts). */
  terrainCeiling?: number;
  /** Default cruise altitude AGL. */
  cruiseAlt: number;
  /** Solid structures (ray-cast surfaces for sensors; rendered by scenario layers). */
  structures?: Prism[];
  /** Procedural building complex (Building Scan target + context). */
  campus?: Campus;
  /** Deterministic scripted events (by sim tick). */
  script?: ScriptedEvent[];
  /** Protected site the response picture is built around. */
  protectedZone?: { center: Vec3; radius: number; name: string };
  /** Points of interest the scenario wants the camera to frame. */
  focus: { label: string; pos: Vec3 }[];
}
