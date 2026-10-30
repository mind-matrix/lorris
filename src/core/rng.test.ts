import { describe, expect, it } from 'vitest';
import { isRngState, nextUint32, randomInt, randomSeed, seedFromString, seedState, shuffle, splitmix32, type RngState } from './rng';

// Reference outputs from an independent C implementation of sfc32 (as in PractRand) and
// SplitMix32, so this implementation is checked against the published algorithms.
describe('sfc32 and SplitMix32 match the reference algorithms', () => {
  it('sfc32 raw outputs', () => {
    let s: RngState = [0xdeadbeef, 0x01234567, 0x89abcdef, 1];
    const out: number[] = [];
    for (let i = 0; i < 8; i++) {
      let u: number;
      [u, s] = nextUint32(s);
      out.push(u);
    }
    expect(out).toEqual([3755017303, 3626897966, 1664467148, 803340405, 3835332420, 370291761, 3283756759, 1247792897]);
  });

  it('SplitMix32 outputs', () => {
    let x = 42;
    const out: number[] = [];
    for (let i = 0; i < 6; i++) {
      let w: number;
      [w, x] = splitmix32(x);
      out.push(w);
    }
    expect(out).toEqual([551831576, 144025891, 322543647, 3034809370, 908029994, 2648427983]);
  });

  it('seeding a number: SplitMix32 expansion, then 12 warm-up rounds', () => {
    let s = seedState(42);
    const out: number[] = [];
    for (let i = 0; i < 5; i++) {
      let u: number;
      [u, s] = nextUint32(s);
      out.push(u);
    }
    expect(out).toEqual([3825871779, 1851418855, 1383259262, 890322987, 2796912455]);
    expect(s).toEqual([2499755033, 3018709031, 4238052671, 3034809387]);
  });
});

describe('seeded rng', () => {
  it('is deterministic for the same seed, and never mutates its input', () => {
    const s = seedState(7);
    const copy = [...s];
    expect(shuffle([1, 2, 3, 4, 5, 6, 7, 8], s)).toEqual(shuffle([1, 2, 3, 4, 5, 6, 7, 8], seedState(7)));
    expect(nextUint32(s)).toEqual(nextUint32(s));
    expect([...s]).toEqual(copy);
  });

  it('128-bit seeds are used whole: changing any one word changes the stream', () => {
    const base = [1, 2, 3, 4] as const;
    const first = nextUint32(seedState(base))[0];
    for (let i = 0; i < 4; i++) {
      const changed = [...base] as [number, number, number, number];
      changed[i] ^= 1;
      expect(nextUint32(seedState(changed))[0]).not.toBe(first);
    }
  });

  it('randomSeed gives four fresh uint32 words', () => {
    const a = randomSeed();
    const b = randomSeed();
    expect(isRngState(a)).toBe(true);
    expect(a).not.toEqual(b);
  });

  it('shuffle returns a permutation and does not mutate the input', () => {
    const input = Array.from({ length: 48 }, (_, i) => i);
    const [out] = shuffle(input, seedState(123));
    expect(out.slice().sort((a, b) => a - b)).toEqual(input);
    expect(input[0]).toBe(0);
    expect(out).not.toEqual(input);
  });

  it('randomInt stays in range and rejects bad ranges', () => {
    let s = seedState(99);
    for (let i = 0; i < 1000; i++) {
      let v: number;
      [v, s] = randomInt(s, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    expect(() => randomInt(s, 0)).toThrow(RangeError);
    expect(() => randomInt(s, 2.5)).toThrow(RangeError);
  });

  it('randomInt is uniform (chi-squared, fixed seed)', () => {
    for (const max of [3, 7, 32, 47]) {
      const counts = new Array(max).fill(0);
      const draws = 2000 * max;
      let s = seedState(2024 + max);
      for (let i = 0; i < draws; i++) {
        let v: number;
        [v, s] = randomInt(s, max);
        counts[v]++;
      }
      const chi2 = counts.reduce((acc, c) => acc + (c - 2000) ** 2 / 2000, 0);
      // Far above any plausible chi-squared value for these degrees of freedom (mean = max - 1).
      expect(chi2).toBeLessThan(max - 1 + 6 * Math.sqrt(2 * (max - 1)));
    }
  });

  it('randomInt rejects the uneven tail exactly (no rounding bias)', () => {
    // max = 3 * 2^30: the largest multiple below 2^32 is 3 * 2^30 itself, so draws at or above
    // it must be rejected. A naive floor(r * max) would map them unevenly instead.
    const max = 3 * 2 ** 30;
    let s = seedState(5);
    for (let i = 0; i < 2000; i++) {
      let v: number;
      [v, s] = randomInt(s, max);
      expect(v).toBeLessThan(max);
    }
  });

  it('isRngState checks the saved shape', () => {
    expect(isRngState([0, 1, 2, 4294967295])).toBe(true);
    expect(isRngState([0, 1, 2])).toBe(false);
    expect(isRngState([0, 1, 2, 4294967296])).toBe(false);
    expect(isRngState([0, 1, 2, -1])).toBe(false);
    expect(isRngState(12345)).toBe(false);
  });

  it('seedFromString is stable', () => {
    expect(seedFromString('lorris')).toBe(seedFromString('lorris'));
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });
});
