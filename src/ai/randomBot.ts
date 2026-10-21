import { randomInt, type Action, type PlayerView } from '../core';
import type { Bot } from './bot';

/** Picks any legal action uniformly at random, using its own seeded RNG. */
export class RandomBot implements Bot {
  readonly name = 'Random';
  private rng: number;

  constructor(seed: number) {
    this.rng = seed >>> 0;
  }

  async chooseAction(_view: PlayerView, legal: Action[]): Promise<Action> {
    let i: number;
    [i, this.rng] = randomInt(this.rng, legal.length);
    return legal[i];
  }
}
