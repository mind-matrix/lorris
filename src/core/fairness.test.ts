// Statistical fairness of the deal, checked on many simulated games with fixed seeds (so the
// test is repeatable and never flaky). If a change ever made dealing biased, this fails.
//
// Thresholds are set several standard errors wide: a fair deal passes comfortably, while
// any real bias of a size players could notice fails.

import { describe, expect, it } from 'vitest';
import { applyAction, buildDeck, createGame, getLegalActions, makeConfig, JOKER, type Card, type GameState } from '.';

const GAMES = 1200;
const SETS_PER_GAME = 6;

/** "High cards": the sum of ranks (2..14), with the Joker as 15. */
const rankOf = (c: Card): number => (c === JOKER ? 15 : ({ A: 14, K: 13, Q: 12, J: 11 } as Record<string, number>)[c.slice(0, -1)] ?? Number(c.slice(0, -1)));
const strength = (hand: Card[]) => hand.reduce((sum, c) => sum + rankOf(c), 0);

function correlation(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b) / n;
  const my = y.reduce((a, b) => a + b) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** Generous upper bound for a chi-squared statistic: mean + 5 standard deviations. */
const chiSquaredLimit = (df: number) => df + 5 * Math.sqrt(2 * df);

/** Plays to the end of the current Set with the first legal moves, then deals the next one. */
function nextSet(s: GameState): GameState {
  let state = s;
  for (let guard = 0; guard < 500 && state.phase !== 'setOver' && state.phase !== 'gameOver'; guard++) {
    const seat = state.turn!;
    const r = applyAction(state, seat, getLegalActions(state, seat)[0]);
    if (!r.ok) throw new Error(r.error.message);
    state = r.state;
  }
  if (state.phase !== 'setOver') return state;
  const r = applyAction(state, state.turn!, { type: 'NEXT_SET' });
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}

describe.each([4, 6])('dealing is fair with %i players', (n) => {
  const config = makeConfig(n);
  const deck = buildDeck(config);
  const prev: number[] = [];
  const next: number[] = [];
  const strengthBySeat = Array.from({ length: n }, () => ({ sum: 0, count: 0 }));
  const jokerBySeat = new Array<number>(n).fill(0);
  /** cardByPosition[card][position from the cutter] */
  const cardByPosition = new Map<Card, number[]>(deck.map((c) => [c, new Array<number>(n).fill(0)]));
  let sets = 0;
  let strongestPairs = 0;
  let strongestRepeats = 0;

  for (let game = 0; game < GAMES; game++) {
    let s = createGame(config, 10_000 + game);
    let previous: number[] | null = null;
    let previousStrongest = -1;
    for (let set = 0; set < SETS_PER_GAME && s.phase === 'bidding'; set++) {
      const strengths = s.hands.map(strength);
      sets++;
      strengths.forEach((v, seat) => {
        strengthBySeat[seat].sum += v;
        strengthBySeat[seat].count++;
      });
      jokerBySeat[s.hands.findIndex((h) => h.includes(JOKER))]++;
      s.hands.forEach((hand, seat) => hand.forEach((c) => cardByPosition.get(c)![(seat - s.cutter + n) % n]++));
      const strongest = strengths.indexOf(Math.max(...strengths));
      if (previous) {
        for (let seat = 0; seat < n; seat++) {
          prev.push(previous[seat]);
          next.push(strengths[seat]);
        }
        strongestPairs++;
        if (strongest === previousStrongest) strongestRepeats++;
      }
      previous = strengths;
      previousStrongest = strongest;
      s = nextSet(s);
    }
  }

  it('a strong hand in one Set says nothing about the next (no correlation)', () => {
    expect(prev.length).toBeGreaterThan(GAMES * 3 * n);
    expect(Math.abs(correlation(prev, next))).toBeLessThan(0.03);
  });

  it('the strongest hand moves to a new seat as often as chance predicts', () => {
    const rate = strongestRepeats / strongestPairs;
    const expected = 1 / n;
    const standardError = Math.sqrt((expected * (1 - expected)) / strongestPairs);
    expect(Math.abs(rate - expected)).toBeLessThan(4 * standardError);
  });

  it('every seat gets the same average hand strength', () => {
    const overall = strengthBySeat.reduce((a, s) => a + s.sum, 0) / strengthBySeat.reduce((a, s) => a + s.count, 0);
    for (const { sum, count } of strengthBySeat) expect(Math.abs(sum / count - overall)).toBeLessThan(0.6);
  });

  it('every seat gets the Joker equally often', () => {
    const expected = sets / n;
    const chi2 = jokerBySeat.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(chiSquaredLimit(n - 1));
  });

  it('every card is equally likely in every position around the table', () => {
    const expected = sets / n;
    let chi2 = 0;
    for (const counts of cardByPosition.values()) for (const c of counts) chi2 += (c - expected) ** 2 / expected;
    expect(chi2).toBeLessThan(chiSquaredLimit(deck.length * (n - 1)));
  });
});
