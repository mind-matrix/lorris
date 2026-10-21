import { describe, expect, it } from 'vitest';
import { buildDeck } from './cards';
import { makeConfig } from './config';
import { createGame } from './deal';
import { getLegalActions } from './legal';
import { applyAction } from './reducer';
import { decidedWinner } from './rules';
import type { GameState } from './types';

/** Plays one full set taking the first legal action for whoever must act. */
function playSet(state: GameState): GameState {
  let s = state;
  const startSet = s.setNumber;
  for (let guard = 0; guard < 500 && (s.phase !== 'setOver' && s.phase !== 'gameOver'); guard++) {
    const seat = s.turn!;
    const action = getLegalActions(s, seat)[0];
    const r = applyAction(s, seat, action);
    if (!r.ok) throw new Error(r.error.message);
    s = r.state;
  }
  expect(s.setNumber).toBe(startSet);
  return s;
}

describe('a full set', () => {
  for (const n of [4, 6]) {
    it(`${n} players: plays until the result is decided, every card accounted for, scores updated`, () => {
      for (let seed = 0; seed < 50; seed++) {
        const s = playSet(createGame(makeConfig(n), seed));
        const rounds = s.completedTricks.length;
        expect(rounds).toBeGreaterThan(0);
        expect(rounds).toBeLessThanOrEqual(8);
        expect(s.tricksWon[0] + s.tricksWon[1]).toBe(rounds);
        // Decided now, but not one round earlier.
        const { seat, value } = s.contract!;
        expect(decidedWinner(s.config, seat, value, s.tricksWon, rounds)).not.toBeNull();
        const before = [...s.tricksWon] as [number, number];
        before[s.completedTricks[rounds - 1].winner % 2]--;
        expect(decidedWinner(s.config, seat, value, before, rounds - 1)).toBeNull();
        // Cards played plus cards left in hands make up the whole deck.
        const played = s.completedTricks.flatMap((t) => t.plays.map((p) => p.card));
        expect([...played, ...s.hands.flat()].sort()).toEqual(buildDeck(makeConfig(n)).sort());
        expect(s.setHistory).toHaveLength(1);
        expect(s.setHistory[0].roundsPlayed).toBe(rounds);
        expect(s.scores[0] + s.scores[1]).toBe(s.setHistory[0].delta);
      }
    });
  }

  it('replaying the same seed and actions gives the same result', () => {
    const a = playSet(createGame(makeConfig(4), 123));
    const b = playSet(createGame(makeConfig(4), 123));
    expect(a).toEqual(b);
  });
});
