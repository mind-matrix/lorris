import { mulberry32, type Action, type PlayerView } from '../core';
import type { Bot } from './bot';

/** Picks any legal action uniformly at random, using its own seeded RNG. */
export class RandomBot implements Bot {
  readonly name = 'Random';
  private rng: number;

  constructor(seed: number) {
    this.rng = seed >>> 0;
  }

  async chooseAction(_view: PlayerView, legal: Action[]): Promise<Action> {
    const [r, next] = mulberry32(this.rng);
    this.rng = next;
    return legal[Math.floor(r * legal.length)];
  }
}
