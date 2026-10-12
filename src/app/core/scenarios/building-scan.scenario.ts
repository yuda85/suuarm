import { Hub } from '../domain/ops';
import { FleetSize, ScenarioDefinition, VehicleSeed } from '../domain/scenario';
import { Ring } from '../domain/geometry';
import { MissionIntent } from '../domain/mission';
import { Route, VehicleCapability } from '../domain/vehicle';
import { lawnmowerRoute, racetrackRoute, ringRoute, stationRoute } from '../mission/route-gen';
import { buildCampus, campusPrisms } from '../world/campus';

/**
 * Building Scan — Abu Dhabi. Origin = target campus centre (vacant reclaimed plot, east Al Reem).
 * Local frame: x east, y north, metres.
 */
const ORIGIN: [number, number] = [54.41468, 24.49528];
const CAMPUS = buildCampus();

const HUB_A: Hub = { id: 'HUB-A', name: 'OPS BASE ALPHA', pos: { x: 1150, y: 175, z: 0 }, cols: 6, spacing: 9 };
const HUB_B: Hub = { id: 'HUB-B', name: 'SAADIYAT NORTH', pos: { x: 2300, y: 6300, z: 0 }, cols: 10, spacing: 9 };
const HUB_C: Hub = { id: 'HUB-C', name: 'MINA ZAYED', pos: { x: -3200, y: 3050, z: 0 }, cols: 10, spacing: 9 };
const HUB_D: Hub = { id: 'HUB-D', name: 'AL MAQTA', pos: { x: 7600, y: -10500, z: 0 }, cols: 10, spacing: 9 };

/** Ops Base Alpha line-up. Story actors keep stable IDs at every fleet size ≥ 50 (UAV-007/021/031). */
const ALPHA_MIX: VehicleCapability[] = ['ISR', 'THERMAL', 'ISR', 'INSPECTION', 'THERMAL', 'ISR', 'ISR', 'MAPPING', 'THERMAL', 'ISR', 'INSPECTION', 'THERMAL'];
const HUB_MIX: VehicleCapability[] = ['ISR', 'SEARCH', 'MAPPING', 'THERMAL', 'RESPONSE', 'INSPECTION', 'ISR', 'RESPONSE'];

/** Rectangle (w x h) centred on (cx, cy), rotated `rot` degrees counter-clockwise. */
function rect(cx: number, cy: number, w: number, h: number, rot: number): Ring {
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

/**
 * Ops Base Alpha state of charge. The scan-ready dozen are fully charged; UAV-031 is the best
 * charged reserve (first choice for reassignment); the rest are recharging after earlier sorties.
 */
const SCAN_READY = new Set([7, 21, 1, 2, 3, 5, 6, 9, 10, 12, 13, 14]);
function alphaBattery(n: number): number {
  if (n === 7) return 1;
  if (n === 21) return 0.995;
  if (SCAN_READY.has(n)) return 0.965 + ((n * 37) % 30) / 1000;
  if (n === 31) return 0.9;
  return 0.58 + ((n * 53) % 240) / 1000;
}

interface Standing {
  cap: VehicleCapability;
  hub: Hub;
  route: (i: number) => Route;
  alt: number;
}

/** Standing (background) tasking that keeps a large fleet purposeful while the swarm is READY. */
const STANDING: Standing[] = [
  { cap: 'RELAY', hub: HUB_A, alt: 120, route: (i) => stationRoute({ x: 560, y: 110, z: 120 }, `bg-relay-${i}`) },
  { cap: 'SEARCH', hub: HUB_A, alt: 160, route: (i) => racetrackRoute({ x: -1800, y: 2300, z: 160 }, { x: 2600, y: 2700, z: 160 }, 650, `bg-coast-${i}`) },
  { cap: 'RELAY', hub: HUB_B, alt: 130, route: (i) => stationRoute({ x: 1700, y: 3300, z: 130 }, `bg-relay-${i}`) },
  { cap: 'MAPPING', hub: HUB_B, alt: 90, route: (i) => lawnmowerRoute(2600 + (i % 3) * 420, 5200, 380, 520, 18, 60, 90, `bg-map-${i}`) },
  { cap: 'INSPECTION', hub: HUB_C, alt: 55, route: (i) => ringRoute(-3500 + (i % 4) * 160, 3400, 70, 55, 10, `bg-port-${i}`, 7, i * 3) },
  { cap: 'RELAY', hub: HUB_C, alt: 130, route: (i) => stationRoute({ x: -1500, y: 1500, z: 130 }, `bg-relay-${i}`) },
  { cap: 'SEARCH', hub: HUB_C, alt: 180, route: (i) => racetrackRoute({ x: -9000, y: -2200, z: 180 }, { x: -4600, y: 1600, z: 180 }, 520, `bg-corniche-${i}`) },
  { cap: 'ISR', hub: HUB_B, alt: 70, route: (i) => ringRoute(1200 + (i % 5) * 300, 4300, 120, 70, 12, `bg-patrol-${i}`, 9, i * 2) },
  { cap: 'INSPECTION', hub: HUB_D, alt: 60, route: (i) => ringRoute(6900 + (i % 4) * 140, -9400, 80, 60, 10, `bg-bridge-${i}`, 7, i * 3) },
  { cap: 'RELAY', hub: HUB_D, alt: 140, route: (i) => stationRoute({ x: 4300, y: -5200, z: 140 }, `bg-relay-${i}`) },
  { cap: 'SEARCH', hub: HUB_D, alt: 170, route: (i) => racetrackRoute({ x: 9000, y: -8000, z: 170 }, { x: 4000, y: -1500, z: 170 }, 600, `bg-channel-${i}`) },
  { cap: 'RESPONSE', hub: HUB_C, alt: 80, route: (i) => ringRoute(-2400 + (i % 3) * 250, 600, 150, 80, 12, `bg-corniche-cover-${i}`, 10, i * 4) },
];

interface FleetPlan {
  alpha: number;
  standing: number;
  parked: [Hub, number][];
}

const PLANS: Record<FleetSize, FleetPlan> = {
  5: { alpha: 4, standing: 1, parked: [] },
  10: { alpha: 8, standing: 2, parked: [] },
  20: { alpha: 14, standing: 6, parked: [] },
  50: { alpha: 34, standing: 16, parked: [] },
  100: { alpha: 36, standing: 40, parked: [[HUB_B, 12], [HUB_C, 12]] },
  500: { alpha: 48, standing: 212, parked: [[HUB_B, 80], [HUB_C, 80], [HUB_D, 80]] },
};

export const BUILDING_SCAN: ScenarioDefinition = {
  id: 'building-scan',
  name: 'Building Scan',
  missionName: 'OP. FALCON EYE · Al Reem Campus',
  origin: ORIGIN,
  seed: 20261012,
  defaultFleetSize: 50,
  cruiseAlt: 60,
  terrainCeiling: 6,
  campus: CAMPUS,
  structures: campusPrisms(CAMPUS),
  missionHubId: HUB_A.id,
  view: { center: [54.42035, 24.49605], zoom: 15.2, pitch: 0, bearing: 0 },
  hubs: [HUB_A, HUB_B, HUB_C, HUB_D],
  geofences: [],
  pois: [{ id: 'GCS-1', name: 'GCS ALPHA', pos: { x: 1150, y: 215, z: 0 }, kind: 'GCS' }],
  focus: [{ label: 'Campus', pos: { x: 0, y: 0, z: 0 } }],
  fleet(size: FleetSize): VehicleSeed[] {
    const plan = PLANS[size];
    const seeds: VehicleSeed[] = [];
    for (let i = 0; i < plan.alpha; i++) seeds.push({ capability: ALPHA_MIX[i % ALPHA_MIX.length], hubId: HUB_A.id, battery: alphaBattery(i + 1) });
    for (let i = 0; i < plan.standing; i++) {
      const s = STANDING[i % STANDING.length];
      const route = s.route(i);
      seeds.push({
        capability: s.cap,
        hubId: s.hub.id,
        background: { route, altitude: s.alt, startIndex: (i * 7) % route.waypoints.length },
      });
    }
    for (const [hub, n] of plan.parked) {
      for (let i = 0; i < n; i++) seeds.push({ capability: HUB_MIX[i % HUB_MIX.length], hubId: hub.id });
    }
    return seeds;
  },
  presetAreas: [
    { id: 'campus', name: 'Al Reem campus plot', ring: rect(0, 0, 440, 320, 12) },
    { id: 'reem-east', name: 'Reem east reclaimed land', ring: rect(560, -420, 520, 300, -8) },
    { id: 'saadiyat', name: 'Saadiyat north shore', ring: rect(2300, 5250, 760, 420, 20) },
  ],
  defaultIntent(): MissionIntent {
    return {
      type: 'BUILDING_SCAN',
      name: 'Building Scan',
      area: CAMPUS.target.ring,
      priority: 'HIGH',
      requiredSensors: ['EO', 'THERMAL'],
      targetBuildingId: CAMPUS.target.id,
    };
  },
};
