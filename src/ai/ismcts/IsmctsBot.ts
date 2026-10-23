import type { Action, PlayerView } from '../../core';
import type { Bot } from '../bot';
import { SEARCH_BUDGET, type SearchBudget } from './config';
import type { PlayoutPolicy } from './playout';
import { Rng } from './rng';
import { search, type Objective, type SearchResult } from './search';

export interface IsmctsOptions {
  budget?: Partial<SearchBudget>;
  playout?: PlayoutPolicy;
  /** 'match' for real games; 'rounds' only for the tournament's harness-only continuation. */
  objective?: Objective;
}

/**
 * The in-game bot. Sees only its PlayerView and legal actions (the same Bot interface as every
 * other bot), always plays the best move its search found, and is deterministic for a seed when
 * the budget is iteration-capped.
 */
export class IsmctsBot implements Bot {
  readonly name = 'ISMCTS';
  readonly budget: SearchBudget;
  private rng: Rng;
  /** Stats of the last decision (iterations, time), for benchmarks. */
  last: SearchResult | null = null;

  constructor(
    seed: number,
    private opts: IsmctsOptions = {},
  ) {
    this.rng = new Rng(seed);
    this.budget = { ...SEARCH_BUDGET, ...opts.budget };
  }

  async chooseAction(view: PlayerView, legal: Action[]): Promise<Action> {
    return this.decide(view, legal).action;
  }

  /** Synchronous search (used directly by the Web Worker and benchmarks). */
  decide(view: PlayerView, legal: Action[]): SearchResult {
    if (legal.length === 1) return { action: legal[0], iterations: 0, ms: 0, visits: {} };
    this.last = search(view, legal, { budget: this.budget, rng: this.rng, playout: this.opts.playout, objective: this.opts.objective });
    return this.last;
  }
}
