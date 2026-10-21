import { describe, expect, it } from 'vitest';
import { buildDeck } from './cards';
import { makeConfig } from './config';
import { createGame } from './deal';

describe('dealing', () => {
  for (const n of [4, 6]) {
    it(`${n} players: deals 8 distinct cards each, covering the whole deck`, () => {
      const config = makeConfig(n);
      const s = createGame(config, 2024);
      expect(s.hands).toHaveLength(n);
      for (const hand of s.hands) expect(hand).toHaveLength(8);
      expect(s.hands.flat().sort()).toEqual(buildDeck(config).sort());
    });

    it(`${n} players: the seat after the dealer cuts and starts bidding`, () => {
      const s = createGame(makeConfig(n), 5);
      expect(s.cutter).toBe((s.dealer + 1) % n);
      expect(s.turn).toBe(s.cutter);
      expect(s.phase).toBe('bidding');
      expect(s.setNumber).toBe(1);
      expect(s.log[0]).toMatchObject({ type: 'SET_STARTED', dealer: s.dealer, cutter: s.cutter });
    });
  }

  it('is deterministic per seed and differs across seeds', () => {
    const config = makeConfig(4);
    expect(createGame(config, 77).hands).toEqual(createGame(config, 77).hands);
    expect(createGame(config, 77).hands).not.toEqual(createGame(config, 78).hands);
  });

  it('the cut lands strictly inside the deck', () => {
    for (let seed = 0; seed < 200; seed++) {
      const e = createGame(makeConfig(4), seed).log[0];
      if (e.type !== 'SET_STARTED') throw new Error('expected SET_STARTED');
      expect(e.cutIndex).toBeGreaterThan(0);
      expect(e.cutIndex).toBeLessThan(32);
    }
  });

  it('the first dealer varies with the seed', () => {
    const dealers = new Set(Array.from({ length: 50 }, (_, seed) => createGame(makeConfig(6), seed).dealer));
    expect(dealers.size).toBeGreaterThan(1);
  });
});
