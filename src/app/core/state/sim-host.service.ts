import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { Alert, OperationalEvent } from '../domain/ops';
import { FleetSize } from '../domain/scenario';
import { scenarioById } from '../scenarios/registry';
import { SIM_DT, SimCommand, SimulationEngine } from '../sim/engine';

const UI_HZ = 4;

/**
 * Owns the simulation lifecycle. Engine stepping is decoupled from Angular:
 * fixed-rate accumulator loop drives 10 Hz ticks; UI is notified at 4 Hz via a signal.
 * Map rendering reads engine pose buffers directly every animation frame.
 */
@Injectable({ providedIn: 'root' })
export class SimHost {
  private _engine: SimulationEngine | null = null;
  /** Bumps on scenario/fleet reset so consumers can rebuild. */
  readonly generation = signal(0);
  /** 4 Hz UI heartbeat. */
  readonly uiTick = signal(0);
  readonly speed = signal(1);
  readonly paused = signal(false);
  readonly scenarioId = signal('building-scan');
  readonly fleetSize = signal<FleetSize>(50);

  readonly events$ = new Subject<OperationalEvent>();
  readonly alerts$ = new Subject<Alert>();
  /** Emits synchronously when a new engine replaces the old one (before its first events). */
  readonly reset$ = new Subject<void>();

  /** performance.now() of the last completed tick — render interpolation anchor. */
  lastTickAt = performance.now();
  /** Wall-clock anchor for display timestamps (sim itself is time-agnostic). */
  startedAtMs = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastUiAt = 0;

  get engine(): SimulationEngine {
    if (!this._engine) this.start(this.scenarioId(), this.fleetSize());
    return this._engine!;
  }

  get stepMs(): number {
    return (SIM_DT * 1000) / this.speed();
  }

  start(scenarioId: string, fleetSize: FleetSize): void {
    this.stop();
    const scenario = scenarioById(scenarioId);
    this.scenarioId.set(scenario.id);
    this.fleetSize.set(fleetSize);
    this._engine = new SimulationEngine({ scenario, fleetSize });
    this.startedAtMs = Date.now();
    this.reset$.next();
    this.flush();
    this.lastTickAt = performance.now();
    this.generation.update((g) => g + 1);
    this.uiTick.update((t) => t + 1);
    this.timer = setInterval(() => this.loop(), 20);
  }

  reset(): void {
    this.start(this.scenarioId(), this.fleetSize());
  }

  setFleetSize(size: FleetSize): void {
    this.start(this.scenarioId(), size);
  }

  /**
   * Deterministic time skip for presenters: steps the engine synchronously until `until` holds
   * (or `maxTicks`), flushing events as it goes. Same inputs ⇒ same outcome.
   */
  fastForward(maxTicks: number, until: (e: SimulationEngine) => boolean = () => false): number {
    const e = this.engine;
    let n = 0;
    while (n < maxTicks && !until(e)) {
      e.step();
      this.flush();
      n++;
    }
    this.lastTickAt = performance.now();
    this.uiTick.update((t) => t + 1);
    return n;
  }

  dispatch(cmd: SimCommand): void {
    this.engine.enqueue(cmd);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private loop(): void {
    const now = performance.now();
    if (this.paused()) {
      this.lastTickAt = now;
      return;
    }
    const step = this.stepMs;
    let n = 0;
    // Catch up at most 5 ticks (tab throttling) to avoid spiral.
    const budget = Math.max(5, Math.ceil(this.speed() * 4));
    while (now - this.lastTickAt >= step && n < budget) {
      this._engine!.step();
      this.flush();
      this.lastTickAt += step;
      n++;
    }
    if (now - this.lastTickAt > step * budget) this.lastTickAt = now;
    if (now - this.lastUiAt >= 1000 / UI_HZ) {
      this.lastUiAt = now;
      this.uiTick.update((t) => t + 1);
    }
  }

  private flush(): void {
    const e = this._engine!;
    for (const ev of e.newEvents) this.events$.next(ev);
    for (const a of e.newAlerts) this.alerts$.next(a);
  }
}
