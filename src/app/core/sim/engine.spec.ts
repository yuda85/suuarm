import { describe, expect, it } from 'vitest';
import { BUILDING_SCAN } from '../scenarios/building-scan.scenario';
import { SimulationEngine } from './engine';
import { Rng } from './rng';
import { LocalFrame } from '../world/geo';

function run(ticks: number, seed?: number): SimulationEngine {
  const e = new SimulationEngine({ scenario: BUILDING_SCAN, fleetSize: 10, seed });
  e.enqueue({ type: 'SET_SWARM_MODE', mode: 'ACTIVE' });
  for (let i = 0; i < ticks; i++) {
    if (i === 300) e.enqueue({ type: 'HOLD', vehicleId: 'UAV-004' });
    if (i === 450) e.enqueue({ type: 'RESUME', vehicleId: 'UAV-004' });
    e.step();
  }
  return e;
}

describe('SimulationEngine', () => {
  it('is deterministic for identical seed + command log', () => {
    expect(run(900).stateHash()).toBe(run(900).stateHash());
  });

  it('diverges for a different seed', () => {
    expect(run(400, 1).stateHash()).not.toBe(run(400, 2).stateHash());
  });

  it('activating the swarm plans and starts the primary mission', () => {
    const e = run(400);
    expect(e.swarmMode).toBe('ACTIVE');
    const m = e.missions.active!;
    expect(m.intent.type).toBe('BUILDING_SCAN');
    const tasked = e.vehicles.filter((v) => v.missionId === m.id);
    expect(tasked.length).toBe(m.stats.assigned);
    expect(tasked.every((v) => v.pos.z > 10)).toBe(true);
  });

  it('respects platform speed and turn limits', () => {
    const e = new SimulationEngine({ scenario: BUILDING_SCAN, fleetSize: 10 });
    e.enqueue({ type: 'SET_SWARM_MODE', mode: 'ACTIVE' });
    for (let i = 0; i < 1200; i++) {
      const before = e.vehicles.map((v) => v.heading);
      e.step();
      e.vehicles.forEach((v, k) => {
        expect(v.speed).toBeLessThanOrEqual(v.platform.maxSpeed + 1e-6);
        const d = Math.abs(((v.heading - before[k] + 540) % 360) - 180);
        expect(d).toBeLessThanOrEqual(v.platform.maxTurnRate * 0.1 + 1e-6);
      });
    }
  });

  it('returns and lands everyone when swarm goes back to READY', () => {
    const e = run(500);
    e.enqueue({ type: 'SET_SWARM_MODE', mode: 'READY' });
    for (let i = 0; i < 2400; i++) e.step();
    const primary = e.vehicles.filter((v) => !v.route?.id.startsWith('bg-'));
    expect(primary.every((v) => v.phase === 'PARKED' && v.opState === 'READY')).toBe(true);
  });
});

describe('Rng', () => {
  it('reproduces sequences', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });
});

describe('LocalFrame', () => {
  it('round-trips ENU ↔ lng/lat to sub-millimetre', () => {
    const f = new LocalFrame(54.41468, 24.49528);
    const [lng, lat] = f.toLngLat(1234.5, -876.25);
    const p = f.fromLngLat(lng, lat);
    expect(p.x).toBeCloseTo(1234.5, 3);
    expect(p.y).toBeCloseTo(-876.25, 3);
  });
});
