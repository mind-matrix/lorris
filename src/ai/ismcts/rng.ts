import { nextRandom } from '../../core';

/** A small seeded RNG (mulberry32 from core) with the helpers the search needs. Deterministic. */
export class Rng {
  constructor(private state: number) {
    this.state = state >>> 0;
  }
  /** [0, 1) */
  next(): number {
    const [r, s] = nextRandom(this.state);
    this.state = s;
    return r;
  }
  int(max: number): number {
    return Math.floor(this.next() * max);
  }
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
  /** A fresh 32-bit seed (for re-deals inside a simulation). */
  seed(): number {
    return Math.floor(this.next() * 2 ** 32) >>> 0;
  }
}
