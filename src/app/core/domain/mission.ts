import { Ring, Vec3 } from './geometry';
import { SensorType } from './sensor';
import { Route, VehicleCapability } from './vehicle';

export type MissionType = 'BUILDING_SCAN' | 'AREA_SEARCH' | 'AERIAL_RESPONSE';
export type MissionStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETE' | 'ABORTED';
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
export type SectorState = 'UNASSIGNED' | 'ASSIGNED' | 'ACTIVE' | 'SCANNED';
export type TaskState = 'UNASSIGNED' | 'ASSIGNED' | 'ACTIVE' | 'COMPLETE';
export type SectorKind = 'ROOF' | 'FACADE' | 'GROUND' | 'AREA' | 'ZONE';

/** Operator intent — what and why, never how. */
export interface MissionIntent {
  type: MissionType;
  name: string;
  area: Ring;
  priority: Priority;
  requiredSensors: SensorType[];
  targetBuildingId?: string;
  /** Optional altitude override (m AGL). */
  altitude?: number;
}

export interface MissionArea {
  id: string;
  name: string;
  ring: Ring;
  kind: 'MISSION' | 'SEARCH' | 'TASK' | 'RESPONSE';
}

/** Vertical facade coverage grid: u along wall (a→b), v up (z0→z1). */
export interface FacadeGrid {
  cols: number;
  rows: number;
  cells: Uint8Array;
}

/** Ground coverage raster for a mission: square cells over the area bbox, tagged with sector (-1 = outside). */
export interface GroundField {
  cell: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  sector: Int16Array;
  scanned: Uint8Array;
}

export interface Sector {
  id: string;
  missionId: string;
  index: number;
  name: string; // EAST FACADE / SECTOR C
  code: string; // E / C
  kind: SectorKind;
  state: SectorState;
  ring: Ring;
  /** Facade: wall a→b (outward normal to the right), base/top heights. */
  wall?: { a: Vec3; b: Vec3; z0: number; z1: number; normal: { x: number; y: number } };
  /** Roof elevation (m AGL) for ROOF sectors. */
  z?: number;
  facade?: FacadeGrid;
  total: number;
  scanned: number;
  requiredSensors: SensorType[];
}

export interface Task {
  id: string;
  missionId: string;
  sectorId: string;
  name: string;
  state: TaskState;
  vehicleId: string | null;
  capability: VehicleCapability[];
  route: Route;
  /** Waypoint index where productive work (lanes / passes) begins. */
  workStart: number;
  progress: number;
  /** Planner's rationale for the assignment (shown to the operator). */
  rationale: string[];
  /** Tick the current vehicle was assigned (for ETA / reassignment logic). */
  assignedTick: number;
  /** Fraction of the sector (along u) this task covers. */
  slice?: [number, number];
  /** Set when the assigned asset was lost: where to resume and since when. */
  resumeIndex?: number;
  releasedTick?: number;
  previousVehicleId?: string;
  delayedAlerted?: boolean;
  reassignments?: number;
}

export interface PlanStats {
  evaluated: number;
  capable: number;
  sectors: number;
  assigned: number;
  routeKm: number;
  etaMin: number;
}

export interface Mission {
  id: string;
  code: string; // M-01
  intent: MissionIntent;
  status: MissionStatus;
  sectorIds: string[];
  taskIds: string[];
  field: GroundField | null;
  stats: PlanStats;
  createdTick: number;
  startedTick: number | null;
  completedTick: number | null;
  progress: number;
}
