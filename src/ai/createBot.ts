// The ONE place that decides which bot plays in real games. Change IN_GAME_BOT to switch.
// (Tournaments and tests can still create any bot directly.)

import type { Bot } from './bot';
import { HeuristicBot } from './heuristicBot';
import { IsmctsBot } from './ismcts/IsmctsBot';

export type InGameBotKind = 'ismcts' | 'heuristic';
export const IN_GAME_BOT: InGameBotKind = 'ismcts';

/** In the browser this is replaced with a factory that runs the bot in a Web Worker. */
let factory: ((seed: number) => Bot) | null = null;

export function setInGameBotFactory(f: ((seed: number) => Bot) | null): void {
  factory = f;
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;

/** Every bot seat in a real game: lobby bots, takeovers, mid-game seats, resumed games, local games. */
export function createInGameBot(seed: number = randomSeed()): Bot {
  if (factory) return factory(seed);
  return IN_GAME_BOT === 'ismcts' ? new IsmctsBot(seed) : new HeuristicBot();
}
