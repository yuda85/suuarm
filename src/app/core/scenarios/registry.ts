import { ScenarioDefinition } from '../domain/scenario';
import { AERIAL_RESPONSE } from './aerial-response.scenario';
import { BUILDING_SCAN } from './building-scan.scenario';

export const SCENARIOS: ScenarioDefinition[] = [BUILDING_SCAN, AERIAL_RESPONSE];

export function scenarioById(id: string): ScenarioDefinition {
  return SCENARIOS.find((s) => s.id === id) ?? BUILDING_SCAN;
}
