// Turns a player's view plus one sampled deal into a full state the search can simulate.
// Only ever built from the view (public info + own hand) and sampled cards: never real hands.

import { legalCards, teamOf, trickWinner, type Action, type Card, type GameState, type PlayerView, type Seat } from '../../core';

export function stateFromView(view: PlayerView, hands: Card[][], rngSeed: number): GameState {
  const { seat: _seat, myHand: _mine, handCounts: _counts, ...pub } = view;
  return { ...pub, hands, rng: rngSeed };
}

export const actionKey = (a: Action): string =>
  a.type === 'BID' ? `B${a.value}` : a.type === 'CHOOSE_TRUMP' ? `T${a.suit}` : a.type === 'PLAY_CARD' ? `C${a.card}` : a.type;

/**
 * "Win as many rounds as possible" mode (used only by the tournament's harness-only
 * continuation): plays a card with the engine's card rules but without ending the Set early.
 */
export function playCardNoEarlyEnd(s: GameState, seat: Seat, card: Card): GameState {
  const n = s.config.playerCount;
  const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => c !== card) : h));
  const trick = { leader: s.trick.leader, plays: [...s.trick.plays, { seat, card }] };
  if (trick.plays.length < n) return { ...s, hands, trick, turn: (seat + 1) % n };
  const winner = trickWinner(trick, s.trump!);
  const tricksWon: [number, number] = [s.tricksWon[0], s.tricksWon[1]];
  tricksWon[teamOf(winner)]++;
  return { ...s, hands, tricksWon, completedTricks: [...s.completedTricks, { ...trick, winner }], trick: { leader: winner, plays: [] }, turn: winner };
}

export function legalCardActions(s: GameState, seat: Seat): Action[] {
  return legalCards(s.hands[seat], s.trick, s.trump!).map((card) => ({ type: 'PLAY_CARD', card }) as Action);
}

