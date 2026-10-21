// Helpers for building specific game situations in tests.
import { expect } from 'vitest';
import { applyAction } from './reducer';
import { createGame } from './deal';
import { makeConfig } from './config';
import type { Action, Card, GameState, Seat, Suit } from './types';

/** Applies an action and fails the test if it is rejected. */
export function act(state: GameState, seat: Seat, action: Action): GameState {
  const result = applyAction(state, seat, action);
  if (!result.ok) throw new Error(`Expected ${JSON.stringify(action)} by seat ${seat} to succeed: ${result.error.message}`);
  return result.state;
}

/** Applies an action and asserts it is rejected with the given error code. */
export function expectError(state: GameState, seat: Seat, action: Action, code: string): void {
  const result = applyAction(state, seat, action);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

/** A 4- or 6-player game in the bidding phase with dealer 0, so seat 1 cuts and bids first. */
export function biddingGame(playerCount = 4, seed = 1): GameState {
  const s = createGame(makeConfig(playerCount), seed);
  return { ...s, dealer: 0, cutter: 1, turn: 1, trick: { leader: 1, plays: [] } };
}

/**
 * A game in the playing phase with chosen hands. Dealer is 0, so seat 1 cut and leads.
 * Hands need not be full decks; tests only use what matters.
 */
export function playingGame(opts: {
  playerCount?: number;
  hands: Card[][];
  trump: Suit;
  contract?: { seat: Seat; value: number };
  leader?: Seat;
  tricksPerSet?: number;
}): GameState {
  const base = biddingGame(opts.playerCount ?? 4);
  const leader = opts.leader ?? 1;
  return {
    ...base,
    config: { ...base.config, tricksPerSet: opts.tricksPerSet ?? base.config.tricksPerSet },
    phase: 'playing',
    hands: opts.hands,
    trump: opts.trump,
    contract: { ...(opts.contract ?? { seat: 1, value: 4 }), forced: false },
    turn: leader,
    trick: { leader, plays: [] },
  };
}

/** Plays one card per seat starting at `trick.leader`. */
export function playTrick(state: GameState, cards: Card[]): GameState {
  let s = state;
  for (const card of cards) s = act(s, s.turn!, { type: 'PLAY_CARD', card });
  return s;
}
