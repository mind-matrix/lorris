import { describe, expect, it } from 'vitest';
import { buildDeck, cardsOfSuit } from './cards';
import { makeConfig, nextSeat, seatsOfTeam, teamOf } from './config';

describe('config and deck', () => {
  it('4 players: 32 cards, 7..A per suit, 7S replaced by the Joker', () => {
    const config = makeConfig(4);
    const deck = buildDeck(config);
    expect(config.lowestRank).toBe(7);
    expect(deck).toHaveLength(32);
    expect(new Set(deck).size).toBe(32);
    expect(deck).not.toContain('7S');
    expect(deck).toContain('JK');
    expect(deck).toContain('7H');
    expect(deck).not.toContain('6H');
    expect(cardsOfSuit(config, 'S')).toHaveLength(7);
    expect(cardsOfSuit(config, 'H')).toHaveLength(8);
  });

  it('6 players: 48 cards, 3..A per suit, 3S replaced by the Joker', () => {
    const config = makeConfig(6);
    const deck = buildDeck(config);
    expect(config.lowestRank).toBe(3);
    expect(deck).toHaveLength(48);
    expect(new Set(deck).size).toBe(48);
    expect(deck).not.toContain('3S');
    expect(deck).not.toContain('2H');
    expect(deck).toContain('3H');
    expect(deck).toContain('JK');
  });

  it('every config gives 8 cards per player and 8 rounds', () => {
    for (const n of [4, 6]) {
      const config = makeConfig(n);
      expect(buildDeck(config).length / n).toBe(8);
      expect(config.tricksPerSet).toBe(8);
      expect(config.minBid).toBe(4);
      expect(config.maxBid).toBe(8);
      expect(config.targetScore).toBe(32);
    }
  });

  it('rejects unsupported player counts', () => {
    expect(() => makeConfig(5)).toThrow();
    expect(() => makeConfig(2)).toThrow();
    expect(() => makeConfig(8)).toThrow();
  });

  it('teams alternate seats: across for 4, triangles for 6', () => {
    expect(seatsOfTeam(makeConfig(4), 0)).toEqual([0, 2]);
    expect(seatsOfTeam(makeConfig(4), 1)).toEqual([1, 3]);
    expect(seatsOfTeam(makeConfig(6), 0)).toEqual([0, 2, 4]);
    expect(seatsOfTeam(makeConfig(6), 1)).toEqual([1, 3, 5]);
    expect(teamOf(3)).toBe(1);
  });

  it('play moves anti-clockwise (seat + 1) and wraps', () => {
    expect(nextSeat(makeConfig(4), 3)).toBe(0);
    expect(nextSeat(makeConfig(6), 5)).toBe(0);
    expect(nextSeat(makeConfig(6), 2)).toBe(3);
  });
});
