import { describe, expect, it } from 'vitest';
import { nextRandom, randomInt, seedFromString, shuffle } from './rng';

describe('seeded rng', () => {
  it('is deterministic for the same seed', () => {
    expect(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 42)).toEqual(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 42));
    expect(nextRandom(7)).toEqual(nextRandom(7));
  });

  it('shuffle returns a permutation and does not mutate the input', () => {
    const input = Array.from({ length: 48 }, (_, i) => i);
    const [out] = shuffle(input, 123);
    expect(out.slice().sort((a, b) => a - b)).toEqual(input);
    expect(input[0]).toBe(0);
    expect(out).not.toEqual(input);
  });

  it('randomInt stays in range', () => {
    let s = 99;
    for (let i = 0; i < 1000; i++) {
      let v: number;
      [v, s] = randomInt(s, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it('seedFromString is stable', () => {
    expect(seedFromString('lorris')).toBe(seedFromString('lorris'));
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });
});
