import { Ring, Vec3 } from './geometry';

export type SwarmMode = 'READY' | 'ACTIVE';
export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type SystemHealthLevel = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export type AlertKind =
  | 'LOW_BATTERY'
  | 'CRITICAL_BATTERY'
  | 'LINK_DEGRADED'
  | 'LINK_LOST'
  | 'PAYLOAD_OFFLINE'
  | 'NAV_DEGRADED'
  | 'MISSION_DELAYED'
  | 'VEHICLE_OFFLINE'
  | 'RESTRICTED_AREA'
  | 'TASK_REASSIGNED'
  | 'TRACK_DETECTED';

export interface FocusRef {
  kind: 'vehicle' | 'mission' | 'sector' | 'track' | 'point';
  id?: string;
  point?: Vec3;
}

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: Severity;
  title: string;
  detail: string;
  tick: number;
  focus: FocusRef | null;
  acknowledged: boolean;
  active: boolean;
}

export interface OperationalEvent {
  id: number;
  tick: number;
  severity: Severity;
  text: string;
  focus: FocusRef | null;
}

export interface Hub {
  id: string;
  name: string;
  pos: Vec3;
  cols: number;
  spacing: number;
}

export interface Geofence {
  id: string;
  name: string;
  ring: Ring;
  floor: number;
  ceiling: number;
  kind: 'RESTRICTED' | 'NO_FLY' | 'OPERATING';
  /** Own fleet must stay out (operator-drawn no-fly). Scenario zones protect against external tracks. */
  appliesToFleet?: boolean;
}

export interface Poi {
  id: string;
  name: string;
  pos: Vec3;
  kind: 'GCS' | 'LANDMARK' | 'MARKER' | 'OBSERVATION';
}

export interface SystemHealth {
  level: SystemHealthLevel;
  core: 'ONLINE' | 'DEGRADED';
  network: 'ONLINE' | 'DEGRADED';
  edgeOnline: number;
  edgeTotal: number;
  sensorServices: 'ONLINE' | 'DEGRADED';
  mapServices: 'ONLINE' | 'DEGRADED' | 'FALLBACK';
}

export type AutonomyMode = 'SUPERVISED' | 'AUTONOMOUS';

/** System-proposed action awaiting (or recording) operator decision — supervised autonomy. */
export interface Recommendation {
  id: string;
  kind: 'REASSIGN' | 'RESPONSE_GROUP';
  title: string;
  /** e.g. "East facade B" */
  subject: string;
  missionId: string | null;
  taskId: string | null;
  fromId: string | null;
  toIds: string[];
  rationale: string[];
  alternatives: string[];
  confidence: number;
  createdTick: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  decidedBy: 'OPERATOR' | 'AUTONOMY' | null;
  focus: FocusRef | null;
}

export type TrackClass = 'UNKNOWN' | 'SMALL UAS' | 'LIGHT AIRCRAFT' | 'BIRD FLOCK';
export type TrackStatus = 'DETECTED' | 'CLASSIFYING' | 'CLASSIFIED' | 'MONITORED' | 'DEPARTING' | 'RESOLVED';

/** Simulated aerial track (sensor-fused picture). Visualisation and C2 only — no guidance/engagement logic. */
export interface Track {
  id: string;
  pos: Vec3;
  heading: number;
  speed: number;
  climb: number;
  cls: TrackClass;
  cooperative: boolean;
  confidence: number;
  status: TrackStatus;
  createdTick: number;
  statusTick: number;
  history: Vec3[];
  /** Response mission handling this track. */
  missionId: string | null;
  /** Ticks with response assets on station. */
  monitoredTicks: number;
}

export interface TrackSpawn {
  id: string;
  pos: Vec3;
  heading: number;
  speed: number;
}

export interface ScriptedEvent {
  atTick: number;
  spawnTrack?: TrackSpawn;
}
