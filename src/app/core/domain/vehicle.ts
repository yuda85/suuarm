import { Vec3 } from './geometry';
import { Payload } from './sensor';

/** Airframe silhouette family. Drives mesh + icon. */
export type AirframeClass = 'QUAD' | 'HEXA' | 'VTOL' | 'RELAY';

export type VehicleCapability =
  | 'ISR'
  | 'MAPPING'
  | 'THERMAL'
  | 'RELAY'
  | 'INSPECTION'
  | 'SEARCH'
  | 'RESPONSE';

/** Operational state commanded/assigned by SuuarmOS. */
export type VehicleOpState = 'READY' | 'ACTIVE' | 'HOLD' | 'RETURNING' | 'OFFLINE';

/** Displayed state: op state, escalated to WARNING when health flags are raised. */
export type VehicleState = VehicleOpState | 'WARNING';

export type FlightPhase =
  | 'PARKED'
  | 'TAKEOFF'
  | 'TRANSIT'
  | 'ON_TASK'
  | 'HOLD'
  | 'RTB'
  | 'LANDING';

export type LinkState = 'NOMINAL' | 'DEGRADED' | 'LOST';
export type NavState = 'RTK FIX' | 'GNSS' | 'DEGRADED' | 'DEAD RECKONING';
export type HealthLevel = 'OK' | 'DEGRADED' | 'FAULT';

export interface PlatformSpec {
  id: string;
  name: string;
  airframe: AirframeClass;
  cruiseSpeed: number; // m/s
  maxSpeed: number;
  minSpeed: number; // > 0 for wing-borne flight
  maxTurnRate: number; // deg/s
  maxAccel: number; // m/s^2
  maxClimb: number; // m/s
  enduranceMin: number; // full battery endurance at cruise
  lengthM: number; // visual length, used for mesh scaling
}

export interface Waypoint extends Vec3 {
  /** Desired speed at this leg, m/s. */
  speed?: number;
  /** Hover/dwell time seconds (multirotor). */
  dwell?: number;
  /** Optional gimbal look-at point while on this leg. */
  look?: Vec3;
  /** Fixed gimbal tilt on this leg (e.g. -90 nadir for survey). */
  tilt?: number;
  /** Desired airframe heading on this leg (multirotor strafing, e.g. facing a facade). */
  yaw?: number;
  /** Gimbal locks perpendicular onto this wall segment (facade inspection). */
  facade?: { ax: number; ay: number; bx: number; by: number };
}

export interface Route {
  id: string;
  waypoints: Waypoint[];
  loop: boolean;
}

export interface VehicleHealth {
  lowBattery: boolean;
  criticalBattery: boolean;
  linkDegraded: boolean;
  linkLost: boolean;
  payloadFault: boolean;
  navDegraded: boolean;
}

export interface Vehicle {
  id: string; // UAV-007
  index: number;
  callsign: string; // FALCON 07
  platform: PlatformSpec;
  capability: VehicleCapability;
  hubId: string;
  pad: Vec3;

  // Pose (local ENU, z = AGL)
  pos: Vec3;
  heading: number; // deg cw from north
  pitch: number; // deg nose-up
  roll: number; // deg right-bank positive
  /** Horizontal velocity m/s (east, north). */
  vel: { x: number; y: number };
  speed: number; // ground speed m/s
  climb: number; // m/s
  turnRate: number; // deg/s

  opState: VehicleOpState;
  phase: FlightPhase;
  /** VTOL only: wing-borne cruise (true) vs hover/lift-rotor flight (false). */
  wingMode: boolean;
  holdPoint: Vec3 | null;
  /** Tick at which a queued launch begins (staggered swarm launch). */
  launchAtTick: number | null;

  battery: number; // 0..1
  drainPerSec: number; // fraction/sec at cruise

  link: { quality: number; latencyMs: number; state: LinkState; via: string };
  nav: { state: NavState; hAccM: number };
  compute: { health: HealthLevel; tempC: number; load: number };
  payloads: Payload[];
  gimbal: { pan: number; tilt: number; targetPan: number; targetTilt: number; mode: 'AUTO' | 'MANUAL' };
  activePayloadId: string | null;

  health: VehicleHealth;

  missionId: string | null;
  taskId: string | null;
  route: Route | null;
  routeIndex: number;
  dwellLeft: number;
  /** Distance flown along current route (m), for progress + trail. */
  odometer: number;
  /** Ticks since C2 link was lost (lost-link procedure timer). */
  lostLinkTicks: number;
}

export function displayState(v: Pick<Vehicle, 'opState' | 'health'>): VehicleState {
  if (v.opState === 'OFFLINE') return 'OFFLINE';
  const h = v.health;
  if (h.criticalBattery || h.lowBattery || h.linkDegraded || h.linkLost || h.payloadFault || h.navDegraded) {
    return 'WARNING';
  }
  return v.opState;
}

export const CAPABILITY_LABEL: Record<VehicleCapability, string> = {
  ISR: 'ISR',
  MAPPING: 'Mapping',
  THERMAL: 'Thermal',
  RELAY: 'Relay',
  INSPECTION: 'Inspection',
  SEARCH: 'Search',
  RESPONSE: 'Response',
};

/** Two-letter capability badge code. */
export const CAPABILITY_CODE: Record<VehicleCapability, string> = {
  ISR: 'IS',
  MAPPING: 'MP',
  THERMAL: 'TH',
  RELAY: 'RL',
  INSPECTION: 'IN',
  SEARCH: 'SR',
  RESPONSE: 'RS',
};
