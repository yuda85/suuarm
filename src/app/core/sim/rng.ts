/** Mulberry32 — tiny, fast, deterministic PRNG. Same seed ⇒ same sequence on every run. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hiExclusive: number): number {
    return Math.floor(this.range(lo, hiExclusive));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Approximately normal(0,1) via sum of uniforms. */
  gauss(): number {
    return this.next() + this.next() + this.next() + this.next() - 2;
  }

  /** Derive an independent child stream (per subsystem / per vehicle). */
  fork(salt: number): Rng {
    return new Rng(Math.imul(this.s ^ (salt * 0x9e3779b1), 0x85ebca6b) >>> 0);
  }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
