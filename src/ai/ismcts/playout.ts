// Playouts finish a simulated Set from a tree leaf. Swappable: a smarter policy can replace
// randomPlayout without touching the search.

import { applyAction, getLegalActions, type Action, type GameState } from '../../core';
import { legalCardActions, playCardNoEarlyEnd } from './model';
import type { Rng } from './rng';

export type PlayoutPolicy = (state: GameState, rng: Rng) => GameState;

export const isSetOver = (s: GameState) => s.phase === 'setOver' || s.phase === 'gameOver';

/** Uniformly random legal moves until the Set is over (calls, trump and cards alike). */
export const randomPlayout: PlayoutPolicy = (state, rng) => {
  let s = state;
  while (!isSetOver(s)) {
    const seat = s.turn!;
    const legal = getLegalActions(s, seat);
    const r = applyAction(s, seat, legal[rng.int(legal.length)]);
    if (!r.ok) throw new Error(`playout: ${r.error.message}`);
    s = r.state;
  }
  return s;
};

/** Random card play to the last round, never ending early (rounds-maximizing mode only). */
export const randomRoundsPlayout: PlayoutPolicy = (state, rng) => {
  let s = state;
  while (s.completedTricks.length < s.config.tricksPerSet) {
    const legal = legalCardActions(s, s.turn!);
    const a = legal[rng.int(legal.length)] as Extract<Action, { type: 'PLAY_CARD' }>;
    s = playCardNoEarlyEnd(s, s.turn!, a.card);
  }
  return s;
};
