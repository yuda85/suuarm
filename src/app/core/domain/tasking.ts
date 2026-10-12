import { Vehicle } from './vehicle';

/** Standing-task families (background routes are prefixed `bg-<family>-`). */
const STANDING_LABEL: Record<string, string> = {
  relay: 'Network relay station',
  coast: 'Coastal surveillance',
  map: 'Saadiyat survey mapping',
  port: 'Port infrastructure inspection',
  corniche: 'Corniche maritime patrol',
  'corniche-cover': 'Corniche overwatch',
  patrol: 'Area patrol · Saadiyat',
  bridge: 'Al Maqta bridge inspection',
  channel: 'Channel surveillance',
};

export function standingFamily(routeId: string): string | null {
  if (!routeId.startsWith('bg-')) return null;
  const rest = routeId.slice(3);
  const i = rest.lastIndexOf('-');
  return i > 0 ? rest.slice(0, i) : rest;
}

/** Human-readable task group for fleet filters ("Unassigned", mission name, standing task). */
export function taskGroup(v: Vehicle, missionName: (id: string) => string | null): string {
  if (v.missionId) return missionName(v.missionId) ?? 'Mission';
  const fam = v.route ? standingFamily(v.route.id) : null;
  if (fam) return STANDING_LABEL[fam] ?? 'Standing task';
  if (v.route) return 'Tasked';
  return 'Unassigned';
}

export function taskLabel(v: Vehicle, missionTask: (v: Vehicle) => string | null = () => null): string {
  if (v.opState === 'OFFLINE') return 'No telemetry';
  const t = missionTask(v);
  if (t) return t;
  switch (v.phase) {
    case 'PARKED':
      return v.launchAtTick !== null ? 'Launch queued' : 'Ready on pad';
    case 'TAKEOFF':
      return 'Climbing to altitude';
    case 'RTB':
      return 'Returning to base';
    case 'LANDING':
      return 'Landing';
    case 'HOLD':
      return 'Holding position';
    default: {
      const fam = v.route ? standingFamily(v.route.id) : null;
      if (fam) return STANDING_LABEL[fam] ?? 'Standing task';
      return 'Transit';
    }
  }
}
