import { FleetSize, ScenarioDefinition, VehicleSeed } from '../domain/scenario';
import { BUILDING_SCAN } from './building-scan.scenario';

const ZONE = { center: { x: 0, y: 0, z: 0 }, radius: 1100, name: 'AL REEM PROTECTED ZONE' };

function circle(r: number, n = 64) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: ZONE.center.x + Math.sin(a) * r, y: ZONE.center.y + Math.cos(a) * r };
  });
}

/**
 * Airspace Response — same world, same fleet engine, same mission/approval core as Building Scan.
 * A non-cooperative track approaches the protected campus; SuuarmOS proposes an observation group.
 */
export const AERIAL_RESPONSE: ScenarioDefinition = {
  ...BUILDING_SCAN,
  id: 'aerial-response',
  name: 'Airspace Response',
  missionName: 'OP. GUARDIAN SKY · Al Reem protected airspace',
  seed: 20261013,
  protectedZone: ZONE,
  geofences: [{ id: 'GF-REEM', name: 'AL REEM PROTECTED ZONE', ring: circle(ZONE.radius), floor: 0, ceiling: 400, kind: 'RESTRICTED' }],
  view: { center: [54.4085, 24.5005], zoom: 13.9, pitch: 0, bearing: 0 },
  script: [{ atTick: 120, spawnTrack: { id: 'T-0417', pos: { x: -3900, y: 3650, z: 95 }, heading: 133, speed: 14 } }],
  fleet(size: FleetSize): VehicleSeed[] {
    // Same fleet, with a quick-reaction element at Ops Base Alpha.
    const seeds = BUILDING_SCAN.fleet(size);
    let n = 0;
    for (const s of seeds) {
      if (s.hubId === 'HUB-A' && !s.background && n < Math.max(2, Math.round(size / 8)) && ['INSPECTION', 'MAPPING', 'THERMAL'].includes(s.capability)) {
        s.capability = 'RESPONSE';
        s.battery = 0.97;
        n++;
      }
    }
    // Quick-reaction element at Mina Zayed, close to the northern approach.
    for (let i = 0; i < 6; i++) seeds.push({ capability: 'RESPONSE', hubId: 'HUB-C', battery: 0.98 - i * 0.004 });
    return seeds;
  },
};
