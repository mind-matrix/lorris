import { describe, expect, it } from 'vitest';
import { createGame, makeConfig, type GameState } from '../../core';
import { matchUtility } from './reward';

const at = (scores: [number, number], winner: 0 | 1 | null = null): GameState => ({ ...createGame(makeConfig(4), 1), scores, winner });

describe('match utility', () => {
  it('a won match is 1, a lost one 0', () => {
    expect(matchUtility(at([33, 5], 0), 0)).toBe(1);
    expect(matchUtility(at([33, 5], 0), 1)).toBe(0);
  });

  it('is symmetric-ish and rises with our score and falls with theirs', () => {
    expect(matchUtility(at([10, 0]), 0)).toBeGreaterThan(matchUtility(at([5, 0]), 0));
    expect(matchUtility(at([10, 0]), 0)).toBeGreaterThan(matchUtility(at([10, 8]), 0));
  });

  it('being close to 32 is worth a lot more than the same lead far from it', () => {
    const near = matchUtility(at([28, 20]), 0) - matchUtility(at([20, 20]), 0);
    const far = matchUtility(at([8, 0]), 0) - matchUtility(at([0, 0]), 0);
    expect(near).toBeGreaterThan(far);
  });

  it('still rewards progress when the opponents are hopelessly behind (no saturation)', () => {
    const a = matchUtility(at([4, -200]), 0);
    const b = matchUtility(at([12, -200]), 0);
    expect(b - a).toBeGreaterThan(0.01);
  });
});
