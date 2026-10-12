import { describe, expect, it } from 'vitest';
import { AERIAL_RESPONSE } from '../scenarios/aerial-response.scenario';
import { SimulationEngine } from '../sim/engine';

describe('Airspace Response', () => {
  it('track → classification → response group → approve → escort → TRACK RESOLVED', () => {
    const e = new SimulationEngine({ scenario: AERIAL_RESPONSE, fleetSize: 50 });
    for (let i = 0; i < 260; i++) e.step();
    const t = e.response.trackOf('T-0417')!;
    expect(t).toBeTruthy();
    expect(t.status).toBe('CLASSIFIED');
    const rec = e.missions.recommendations.find((r) => r.kind === 'RESPONSE_GROUP' && r.status === 'PENDING')!;
    expect(rec.toIds.length).toBe(4);
    expect(e.swarmMode).toBe('READY');

    e.enqueue({ type: 'APPROVE', recommendationId: rec.id });
    e.step();
    expect(e.swarmMode).toBe('ACTIVE');
    const m = e.missions.missions.find((x) => x.id === rec.missionId)!;
    expect(m.status).toBe('ACTIVE');

    let monitored = false;
    for (let i = 0; i < 6000 && t.status !== 'RESOLVED'; i++) {
      e.step();
      if (t.status === 'MONITORED') monitored = true;
    }
    expect(monitored).toBe(true);
    expect(t.status).toBe('RESOLVED');
    expect(m.status).toBe('COMPLETE');
    expect(e.swarmMode).toBe('READY');
  });
});
