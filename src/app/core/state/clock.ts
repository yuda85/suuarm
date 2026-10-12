import { SIM_DT } from '../sim/engine';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Sim tick → wall-clock label in theatre local time (GST). */
export function tickClock(startedAtMs: number, tick: number): string {
  return fmt.format(new Date(startedAtMs + tick * SIM_DT * 1000));
}

export function missionElapsed(tick: number): string {
  const s = Math.floor(tick * SIM_DT);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `T+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
