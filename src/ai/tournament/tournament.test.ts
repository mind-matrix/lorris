import { describe, expect, it } from 'vitest';
import { makeConfig } from '../../core';
import { botSpec } from './bots';
import { duplicateGame, duplicateSet, playSet } from './match';
import { setStart, SITUATIONS } from './scenarios';
import { bootstrapMean, wilson } from './stats';

describe('tournament statistics', () => {
  it('wilson intervals bracket the proportion', () => {
    const w = wilson(60, 100);
    expect(w.mean).toBe(0.6);
    expect(w.lo).toBeGreaterThan(0.49);
    expect(w.hi).toBeLessThan(0.7);
    expect(wilson(0, 0).n).toBe(0);
  });

  it('bootstrap interval of a constant is the constant; of noise it brackets the mean', () => {
    expect(bootstrapMean([3, 3, 3, 3])).toMatchObject({ mean: 3, lo: 3, hi: 3 });
    const values = Array.from({ length: 400 }, (_, i) => ((i * 37) % 11) - 5);
    const b = bootstrapMean(values);
    expect(b.lo).toBeLessThan(b.mean);
    expect(b.hi).toBeGreaterThan(b.mean);
  });
});

describe('duplicate matches', () => {
  it('start positions cover the score situations and keep the engine invariant', () => {
    const names = new Set<string>();
    for (let seed = 0; seed < SITUATIONS.length; seed++) {
      const { state, situation } = setStart(makeConfig(4), seed);
      names.add(situation.name);
      expect(state.scores).toEqual(situation.scores);
      expect(state.setHistory.reduce((t, r) => t + r.delta, 0)).toBe(state.scores[0] + state.scores[1]);
    }
    expect(names.size).toBe(SITUATIONS.length);
  });

  it('a bot against itself has a margin of exactly zero (the pairing cancels everything)', async () => {
    for (const players of [4, 6]) {
      const r = await duplicateSet(players, 5, botSpec('heuristic'), botSpec('heuristic'));
      expect(r.margin).toBe(0);
    }
  });

  it('the margin is the same deal seen from both seatings', async () => {
    const r = await duplicateSet(4, 9, botSpec('heuristic'), botSpec('random'));
    const [g1, g2] = r.games;
    expect(r.margin).toBe(g1.deltas[0] - g1.deltas[1] + g2.deltas[1] - g2.deltas[0]);
    expect(g1.teamBots).toEqual(['heuristic', 'random']);
    expect(g2.teamBots).toEqual(['random', 'heuristic']);
  });

  it('the undercall continuation never touches the real game state', async () => {
    const { state } = setStart(makeConfig(4), 3);
    const before = JSON.stringify(state);
    const rec = await playSet(state, [botSpec('heuristic'), botSpec('heuristic')], 3, 0);
    expect(JSON.stringify(state)).toBe(before);
    if (rec.call?.made) expect(typeof rec.undercall).toBe('boolean');
  });

  it('duplicate full games report wins for A out of the pair', async () => {
    const r = await duplicateGame(4, 2, botSpec('heuristic'), botSpec('random'));
    expect(r.finished).toBe(2);
    expect(r.aWins).toBe(2);
  });
});
