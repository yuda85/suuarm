import { Hub } from '../domain/ops';
import { FleetSize, ScenarioDefinition } from '../domain/scenario';
import { Vehicle } from '../domain/vehicle';
import { CALLSIGNS, CAPABILITY_LOADOUT, makePayloads, PLATFORMS } from './platforms';
import { Rng } from './rng';

export function padPosition(hub: Hub, slot: number): { x: number; y: number; z: number } {
  const col = slot % hub.cols;
  const row = Math.floor(slot / hub.cols);
  return {
    x: hub.pos.x + (col - (hub.cols - 1) / 2) * hub.spacing,
    y: hub.pos.y - row * hub.spacing,
    z: 0,
  };
}

export function buildFleet(scenario: ScenarioDefinition, size: FleetSize, rng: Rng): Vehicle[] {
  const seeds = scenario.fleet(size);
  const slotByHub = new Map<string, number>();
  const hubs = new Map(scenario.hubs.map((h) => [h.id, h]));

  return seeds.map((seed, i) => {
    const n = i + 1;
    const id = `UAV-${String(n).padStart(3, '0')}`;
    const hub = hubs.get(seed.hubId) ?? scenario.hubs[0];
    const slot = slotByHub.get(hub.id) ?? 0;
    slotByHub.set(hub.id, slot + 1);
    const pad = padPosition(hub, slot);
    const loadout = CAPABILITY_LOADOUT[seed.capability];
    const platform = PLATFORMS[loadout.platform];
    const r = rng.fork(n);
    const payloads = makePayloads(id, loadout.sensors);

    const v: Vehicle = {
      id,
      index: i,
      callsign: `${CALLSIGNS[i % CALLSIGNS.length]} ${String(n).padStart(2, '0')}`,
      platform,
      capability: seed.capability,
      hubId: hub.id,
      pad,
      pos: { ...pad },
      heading: hub.pos.z === 0 ? 0 : 0,
      pitch: 0,
      roll: 0,
      vel: { x: 0, y: 0 },
      speed: 0,
      climb: 0,
      turnRate: 0,
      opState: 'READY',
      phase: 'PARKED',
      wingMode: false,
      holdPoint: null,
      launchAtTick: null,
      battery: seed.battery ?? r.range(0.86, 1),
      drainPerSec: 1 / (platform.enduranceMin * 60),
      link: { quality: 0.97, latencyMs: 22, state: 'NOMINAL', via: hub.id },
      nav: { state: 'RTK FIX', hAccM: 0.03 },
      compute: { health: 'OK', tempC: r.range(38, 46), load: r.range(0.12, 0.2) },
      payloads,
      gimbal: { pan: 0, tilt: -30, targetPan: 0, targetTilt: -30, mode: 'AUTO' },
      activePayloadId: payloads[0]?.id ?? null,
      health: {
        lowBattery: false,
        criticalBattery: false,
        linkDegraded: false,
        linkLost: false,
        payloadFault: false,
        navDegraded: false,
      },
      missionId: null,
      taskId: null,
      route: null,
      routeIndex: 0,
      dwellLeft: 0,
      odometer: 0,
      lostLinkTicks: 0,
    };

    if (seed.background) {
      const { route, startIndex = 0, altitude } = seed.background;
      const wp = route.waypoints[startIndex % route.waypoints.length];
      const next = route.waypoints[(startIndex + 1) % route.waypoints.length];
      v.pos = { x: wp.x, y: wp.y, z: altitude ?? wp.z };
      v.route = route;
      v.routeIndex = (startIndex + 1) % route.waypoints.length;
      v.opState = 'ACTIVE';
      v.phase = 'TRANSIT';
      v.heading = (Math.atan2(next.x - wp.x, next.y - wp.y) * 180) / Math.PI;
      if (v.heading < 0) v.heading += 360;
      v.wingMode = platform.airframe === 'VTOL';
      v.speed = v.wingMode ? platform.cruiseSpeed : 0;
      v.battery = r.range(0.55, 0.9);
    }
    return v;
  });
}
