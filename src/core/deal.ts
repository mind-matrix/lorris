import { buildDeck } from './cards';
import { nextSeat } from './config';
import { randomInt, shuffle } from './rng';
import { pushEvent } from './state';
import type { Card, GameConfig, GameState } from './types';

/** Creates a new game and deals the first set. The first dealer is chosen by the seeded RNG. */
export function createGame(config: GameConfig, seed: number): GameState {
  const [dealer, rng] = randomInt(seed >>> 0, config.playerCount);
  const state: GameState = {
    config,
    rng,
    phase: 'bidding',
    setNumber: 0,
    dealer,
    cutter: nextSeat(config, dealer),
    turn: null,
    hands: [],
    bids: [],
    contract: null,
    trump: null,
    trick: { leader: 0, plays: [] },
    completedTricks: [],
    tricksWon: [0, 0],
    scores: [0, 0],
    hasFailedBefore: [false, false],
    setHistory: [],
    winner: null,
    log: [],
    nextSeq: 0,
  };
  startSet(state);
  return state;
}

/** Starts a new set with the current dealer: resets the log, then shuffles, cuts and deals. Mutates `s`. */
export function startSet(s: GameState): void {
  s.setNumber++;
  s.log = [];
  dealCards(s);
}

/**
 * Shuffles, cuts and deals for the current dealer, and opens bidding. Mutates `s`.
 * Used for new sets and for re-deals after a misdeal (same dealer, same set number).
 */
export function dealCards(s: GameState): void {
  const { config } = s;
  s.cutter = nextSeat(config, s.dealer);

  // The dealer shuffles, the next player anti-clockwise cuts at a random point.
  let deck: Card[];
  let cutIndex: number;
  [deck, s.rng] = shuffle(buildDeck(config), s.rng);
  [cutIndex, s.rng] = randomInt(s.rng, deck.length - 1);
  cutIndex += 1; // cut somewhere strictly inside the deck
  deck = [...deck.slice(cutIndex), ...deck.slice(0, cutIndex)];

  // Deal one card at a time, starting with the cutter and going anti-clockwise.
  s.hands = Array.from({ length: config.playerCount }, () => []);
  let seat = s.cutter;
  for (const card of deck) {
    s.hands[seat].push(card);
    seat = nextSeat(config, seat);
  }

  s.phase = 'bidding';
  s.turn = s.cutter;
  s.bids = [];
  s.contract = null;
  s.trump = null;
  s.trick = { leader: s.cutter, plays: [] };
  s.completedTricks = [];
  s.tricksWon = [0, 0];
  pushEvent(s, { type: 'SET_STARTED', setNumber: s.setNumber, dealer: s.dealer, cutter: s.cutter, cutIndex });
}
