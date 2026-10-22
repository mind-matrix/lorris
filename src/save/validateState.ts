// Checks that a loaded GameState is internally consistent before we trust it. A save that fails
// any of this is corrupt or was edited, and is refused rather than crashing the game later.

import { SUITS, SUPPORTED_PLAYER_COUNTS, buildDeck, makeConfig, type GameState } from '../core';

const PHASES = ['bidding', 'choosingTrump', 'playing', 'setOver', 'gameOver'];
const isInt = (x: unknown, min = -Infinity, max = Infinity) => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Returns a reason the state is invalid, or null if it's fine. */
export function gameStateProblem(s: unknown): string | null {
  if (!isObj(s)) return 'not an object';
  const st = s as unknown as GameState;
  if (!isObj(st.config) || !(SUPPORTED_PLAYER_COUNTS as readonly number[]).includes(st.config.playerCount)) return 'bad config';
  const expected = makeConfig(st.config.playerCount, { targetScore: st.config.targetScore });
  for (const k of ['cardsPerPlayer', 'tricksPerSet', 'lowestRank', 'minBid', 'maxBid'] as const) {
    if (st.config[k] !== expected[k]) return `bad config.${k}`;
  }
  const n = st.config.playerCount;
  if (!isInt(st.rng, 0, 2 ** 32 - 1)) return 'bad rng';
  if (!PHASES.includes(st.phase)) return 'bad phase';
  if (!isInt(st.setNumber, 1)) return 'bad set number';
  for (const k of ['dealer', 'cutter'] as const) if (!isInt(st[k], 0, n - 1)) return `bad ${k}`;
  if (!(st.turn === null || isInt(st.turn, 0, n - 1))) return 'bad turn';
  if ((st.turn === null) !== (st.phase === 'gameOver')) return 'turn/phase mismatch';
  if (!(st.trump === null || SUITS.includes(st.trump))) return 'bad trump';
  if (!Array.isArray(st.hands) || st.hands.length !== n || !st.hands.every(Array.isArray)) return 'bad hands';
  if (!isObj(st.trick) || !Array.isArray(st.trick.plays) || !Array.isArray(st.completedTricks)) return 'bad tricks';

  // Every card of the deck exists exactly once: in a hand, the current round, or a finished round.
  const deck = buildDeck(st.config);
  const all = [...st.hands.flat(), ...st.trick.plays.map((p) => p?.card), ...st.completedTricks.flatMap((t) => (t?.plays ?? []).map((p) => p?.card))];
  if (all.length !== deck.length) return 'wrong number of cards';
  const set = new Set(all);
  if (set.size !== deck.length || !deck.every((c) => set.has(c))) return 'cards do not match the deck';

  if (!Array.isArray(st.tricksWon) || st.tricksWon.length !== 2 || !st.tricksWon.every((x) => isInt(x, 0))) return 'bad tricks won';
  if (st.tricksWon[0] + st.tricksWon[1] !== st.completedTricks.length) return 'tricks won do not match rounds played';
  if (!Array.isArray(st.scores) || st.scores.length !== 2 || !st.scores.every((x) => isInt(x))) return 'bad scores';
  if (!Array.isArray(st.hasFailedBefore) || st.hasFailedBefore.length !== 2 || !st.hasFailedBefore.every((x) => typeof x === 'boolean')) {
    return 'bad first-loss flags';
  }
  if (!Array.isArray(st.setHistory)) return 'bad set history';
  const totals = [0, 0];
  for (const r of st.setHistory) {
    if (!isObj(r) || (r.bidTeam !== 0 && r.bidTeam !== 1) || !isInt(r.delta)) return 'bad set result';
    totals[r.bidTeam as 0 | 1] += r.delta as number;
  }
  if (totals[0] !== st.scores[0] || totals[1] !== st.scores[1]) return 'scores do not match set history';
  if (!(st.winner === null || st.winner === 0 || st.winner === 1)) return 'bad winner';
  if (st.phase === 'playing' && (!st.contract || !st.trump)) return 'playing without a call or trump';
  if (!Array.isArray(st.bids) || !Array.isArray(st.log) || !isInt(st.nextSeq, 0)) return 'bad bids or log';
  return null;
}
