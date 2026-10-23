// Bots the tournament can field, by id. HeuristicBot and RandomBot are permanent benchmarks.

import type { Bot } from '../bot';
import { HeuristicBot } from '../heuristicBot';
import { RandomBot } from '../randomBot';
import { IsmctsBot } from '../ismcts/IsmctsBot';

/** Tournaments use an iteration cap (never a time budget), so results are reproducible. */
export const DEFAULT_TOURNAMENT_ITERATIONS = 1000;

export interface BotSpec {
  /** Id used on the command line, e.g. "heuristic", "random", "ismcts:400". */
  id: string;
  create(seed: number): Bot;
  /**
   * The bot used for the harness-only continuation after a Set is decided (undercall estimate):
   * it should simply try to win as many rounds as possible for its team.
   */
  createRoundsMaximizer(seed: number): Bot;
}

const registry: Record<string, (arg: string | undefined) => BotSpec> = {
  random: () => ({ id: 'random', create: (s) => new RandomBot(s), createRoundsMaximizer: (s) => new RandomBot(s) }),
  heuristic: () => ({ id: 'heuristic', create: () => new HeuristicBot(), createRoundsMaximizer: () => new HeuristicBot() }),
  /** Experiment (tournament only): HeuristicBot's calls and trump, ISMCTS card play. */
  hybrid: (arg) => {
    const budget = { deterministic: true, maxIterations: arg ? Number(arg) : DEFAULT_TOURNAMENT_ITERATIONS };
    const make = (seed: number): Bot => {
      const h = new HeuristicBot();
      const m = new IsmctsBot(seed, { budget });
      return { name: 'hybrid', chooseAction: (v, l) => (v.phase === 'playing' ? m.chooseAction(v, l) : h.chooseAction(v, l)) };
    };
    return { id: arg ? `hybrid:${arg}` : 'hybrid', create: make, createRoundsMaximizer: (seed) => new IsmctsBot(seed, { budget, objective: 'rounds' }) };
  },
  ismcts: (arg) => {
    const maxIterations = arg ? Number(arg) : DEFAULT_TOURNAMENT_ITERATIONS;
    const budget = { deterministic: true, maxIterations };
    return {
      id: arg ? `ismcts:${arg}` : 'ismcts',
      create: (seed) => new IsmctsBot(seed, { budget }),
      // After a Set is decided, points no longer depend on the rest; play for rounds instead.
      createRoundsMaximizer: (seed) => new IsmctsBot(seed, { budget, objective: 'rounds' }),
    };
  },
};

export function registerBot(name: string, factory: (arg: string | undefined) => BotSpec): void {
  registry[name] = factory;
}

export function botSpec(id: string): BotSpec {
  const [name, arg] = id.split(':');
  const factory = registry[name];
  if (!factory) throw new Error(`Unknown bot "${id}". Known: ${Object.keys(registry).join(', ')}`);
  return factory(arg);
}
