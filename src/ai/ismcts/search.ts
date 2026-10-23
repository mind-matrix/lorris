// Single-observer Information Set MCTS. Each iteration samples a deal consistent with what the
// bot knows, walks one shared tree (UCB1 with availability counts), plays out to the end of the
// Set, and backs up each team's result. Calls, passes and the trump choice are searched exactly
// like card plays because they're ordinary engine actions.

import { applyAction, getLegalActions, teamOf, type Action, type GameState, type PlayerView, type Team } from '../../core';
import { SEARCH_CONFIG, type SearchBudget } from './config';
import { sampleHands } from './determinize';
import { buildKnowledge } from './Knowledge';
import { actionKey, legalCardActions, playCardNoEarlyEnd, stateFromView } from './model';
import { isSetOver, randomPlayout, randomRoundsPlayout, type PlayoutPolicy } from './playout';
import { matchUtility, roundsUtility } from './reward';
import type { Rng } from './rng';

export type Objective = 'match' | 'rounds';

class Node {
  children = new Map<string, Node>();
  visits = 0;
  /** Sum of rewards for the team that made the move into this node. */
  reward = 0;
  /** How many iterations this node's move was legal (availability, for ISMCTS). */
  avail = 0;
  constructor(
    readonly action: Action | null,
    /** Team of the player who chose `action`. */
    readonly team: Team,
    readonly parent: Node | null,
  ) {}
}

export interface SearchResult {
  action: Action;
  iterations: number;
  ms: number;
  /** Visits per root action, for debugging and tests. */
  visits: Record<string, number>;
}

export interface SearchOptions {
  budget: SearchBudget;
  rng: Rng;
  playout?: PlayoutPolicy;
  objective?: Objective;
  exploration?: number;
}

export function search(view: PlayerView, legal: Action[], opts: SearchOptions): SearchResult {
  const t0 = performance.now();
  const { budget, rng } = opts;
  const objective = opts.objective ?? 'match';
  const playout = opts.playout ?? (objective === 'rounds' ? randomRoundsPlayout : randomPlayout);
  const c = opts.exploration ?? SEARCH_CONFIG.exploration;
  const knowledge = buildKnowledge(view);
  const root = new Node(null, teamOf(view.seat), null);

  const done = (s: GameState) => (objective === 'rounds' ? s.completedTricks.length >= s.config.tricksPerSet : isSetOver(s));
  const legalIn = (s: GameState) => (objective === 'rounds' ? legalCardActions(s, s.turn!) : getLegalActions(s, s.turn!));
  const step = (s: GameState, a: Action): GameState => {
    if (objective === 'rounds') return playCardNoEarlyEnd(s, s.turn!, (a as Extract<Action, { type: 'PLAY_CARD' }>).card);
    const r = applyAction(s, s.turn!, a);
    if (!r.ok) throw new Error(`search: ${r.error.message}`);
    return r.state;
  };
  const utility = (s: GameState, team: Team) => (objective === 'rounds' ? roundsUtility(s, team) : matchUtility(s, team));

  let iterations = 0;
  while (iterations < budget.maxIterations) {
    if (!budget.deterministic && (iterations & 15) === 0 && performance.now() - t0 >= budget.timeMs) break;
    iterations++;

    // 1. Determinize: one deal consistent with everything this player knows.
    let s = stateFromView(view, sampleHands(knowledge, view.myHand, rng), rng.seed());
    let node = root;

    // 2. Select / expand, among the moves legal in this deal.
    while (!done(s)) {
      const moves = legalIn(s);
      const mover = teamOf(s.turn!);
      let untried: Action[] = [];
      for (const m of moves) {
        const child = node.children.get(actionKey(m));
        if (child) child.avail++;
        else untried.push(m);
      }
      if (untried.length > 0) {
        const m = untried[rng.int(untried.length)];
        const child = new Node(m, mover, node);
        child.avail = 1;
        node.children.set(actionKey(m), child);
        s = step(s, m);
        node = child;
        break;
      }
      let best: Node | null = null;
      let bestScore = -Infinity;
      for (const m of moves) {
        const child = node.children.get(actionKey(m))!;
        const score = child.reward / child.visits + c * Math.sqrt(Math.log(child.avail) / child.visits);
        if (score > bestScore) {
          bestScore = score;
          best = child;
        }
      }
      s = step(s, best!.action!);
      node = best!;
      untried = [];
    }

    // 3. Play out to the end of the Set, then 4. back up each team's result.
    if (!done(s)) s = playout(s, rng);
    for (let n: Node | null = node; n && n.parent; n = n.parent) {
      n.visits++;
      n.reward += utility(s, n.team);
    }
  }

  // The most-visited legal root move (ties: the order of `legal`). Always a legal move.
  const visits: Record<string, number> = {};
  let action = legal[0];
  let most = -1;
  for (const a of legal) {
    const v = root.children.get(actionKey(a))?.visits ?? 0;
    visits[actionKey(a)] = v;
    if (v > most) {
      most = v;
      action = a;
    }
  }
  return { action, iterations, ms: performance.now() - t0, visits };
}
