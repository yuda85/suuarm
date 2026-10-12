import { describe, expect, it } from 'vitest';
import { BUILDING_SCAN } from '../scenarios/building-scan.scenario';
import { SimulationEngine } from '../sim/engine';
import { ringCentroid } from './polygon';

function planned(): SimulationEngine {
  const e = new SimulationEngine({ scenario: BUILDING_SCAN, fleetSize: 50 });
  e.enqueue({ type: 'PLAN_MISSION', intent: BUILDING_SCAN.defaultIntent() });
  e.step();
  return e;
}

describe('Building Scan planning', () => {
  it('divides the target into roof, four facades and surroundings with 12 tasks', () => {
    const e = planned();
    const m = e.missions.missions[0];
    const codes = m.sectorIds.map((id) => e.missions.sectors.get(id)!.code);
    expect(codes).toEqual(['R', 'N', 'S', 'E', 'W', 'G']);
    expect(m.taskIds.length).toBe(12);
    expect(m.stats.assigned).toBe(12);
  });

  it('assigns only EO + THERMAL capable assets and puts UAV-007 on the east facade', () => {
    const e = planned();
    const m = e.missions.missions[0];
    const tasks = m.taskIds.map((id) => e.missions.tasks.get(id)!);
    for (const t of tasks) {
      const v = e.byId.get(t.vehicleId!)!;
      expect(v.payloads.some((p) => p.type === 'EO')).toBe(true);
      expect(v.payloads.some((p) => p.type === 'THERMAL')).toBe(true);
    }
    const east = tasks.filter((t) => t.sectorId.endsWith('-E')).map((t) => t.vehicleId);
    expect(east).toContain('UAV-007');
    const all = tasks.map((t) => t.vehicleId);
    expect(all).toContain('UAV-021');
    expect(all).not.toContain('UAV-031');
  });

  it('ranks UAV-031 first among reserves for the east facade', () => {
    const e = planned();
    const m = e.missions.missions[0];
    const assigned = new Set(m.taskIds.map((id) => e.missions.tasks.get(id)!.vehicleId!));
    const east = e.missions.sectors.get(`${m.id}-E`)!;
    const w = east.wall!;
    const best = e.missions.candidates(['EO', 'THERMAL'], { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }, assigned)[0];
    expect(best.vehicle.id).toBe('UAV-031');
    void ringCentroid;
  });

  it('scans facades: coverage grows once the mission runs', () => {
    const e = planned();
    e.enqueue({ type: 'START_MISSION' });
    for (let i = 0; i < 1500; i++) e.step();
    const m = e.missions.missions[0];
    expect(m.status).toBe('ACTIVE');
    expect(m.progress).toBeGreaterThan(0.05);
    const facadeScanned = m.sectorIds.map((id) => e.missions.sectors.get(id)!).filter((s) => s.kind === 'FACADE').reduce((a, s) => a + s.scanned, 0);
    expect(facadeScanned).toBeGreaterThan(20);
  });
});

describe('Resilience', () => {
  it('UAV-007 link lost → task released → UAV-031 recommended → approved → UAV-031 active on the east facade', () => {
    const e = planned();
    e.enqueue({ type: 'START_MISSION' });
    for (let i = 0; i < 1400; i++) e.step();
    const v7 = e.byId.get('UAV-007')!;
    const taskId = v7.taskId!;
    expect(taskId).toContain('-E-');
    e.enqueue({ type: 'LINK_LOST', vehicleId: 'UAV-007' });
    e.step();
    const t = e.missions.tasks.get(taskId)!;
    expect(t.state).toBe('UNASSIGNED');
    const rec = e.missions.recommendations.find((r) => r.taskId === taskId && r.status === 'PENDING')!;
    expect(rec.fromId).toBe('UAV-007');
    expect(rec.toIds[0]).toBe('UAV-031');
    e.enqueue({ type: 'APPROVE', recommendationId: rec.id });
    for (let i = 0; i < 300; i++) e.step();
    const v31 = e.byId.get('UAV-031')!;
    expect(v31.taskId).toBe(taskId);
    expect(v31.opState).toBe('ACTIVE');
    expect(v31.pos.z).toBeGreaterThan(10);
    expect(e.alerts.some((a) => a.kind === 'TASK_REASSIGNED')).toBe(true);
    // UAV-007 runs its lost-link procedure home
    expect(['RTB', 'LANDING', 'PARKED']).toContain(v7.phase);
  });

  it('runs the full building scan to completion and returns the swarm to READY', () => {
    const e = planned();
    e.enqueue({ type: 'START_MISSION' });
    e.step();
    for (let i = 0; i < 4000 && e.missions.missions[0].status === 'ACTIVE'; i++) e.step();
    expect(e.missions.missions[0].status).toBe('COMPLETE');
    expect(e.swarmMode).toBe('READY');
  });

  it('autonomous mode reallocates without operator input', () => {
    const e = planned();
    e.enqueue({ type: 'START_MISSION' });
    e.enqueue({ type: 'SET_AUTONOMY', mode: 'AUTONOMOUS' });
    for (let i = 0; i < 1200; i++) e.step();
    e.enqueue({ type: 'FAIL_VEHICLE', vehicleId: 'UAV-007' });
    e.step();
    const rec = e.missions.recommendations[0];
    expect(rec.status).toBe('APPROVED');
    expect(rec.decidedBy).toBe('AUTONOMY');
  });
});
