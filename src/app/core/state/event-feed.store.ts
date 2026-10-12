import { inject, Injectable, signal } from '@angular/core';
import { bufferTime, filter } from 'rxjs';
import { OperationalEvent } from '../domain/ops';
import { SimHost } from './sim-host.service';

const MAX = 300;

/** Live operational event stream, batched to UI rate (not a timeline: no playback). */
@Injectable({ providedIn: 'root' })
export class EventFeedStore {
  private readonly sim = inject(SimHost);
  /** Newest first. */
  readonly events = signal<OperationalEvent[]>([]);

  constructor() {
    this.sim.reset$.subscribe(() => this.events.set([]));
    this.sim.events$
      .pipe(
        bufferTime(250),
        filter((b) => b.length > 0),
      )
      .subscribe((batch) => this.events.update((list) => [...batch.reverse(), ...list].slice(0, MAX)));
  }
}
