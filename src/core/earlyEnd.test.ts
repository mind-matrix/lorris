import { describe, expect, it } from 'vitest';
import { act, playingGame, playTrick } from './testUtils';
import type { Card, GameState } from './types';

// Seat 1 (team 1) wins every round by leading aces and kings; play order is 1, 2, 3, 0.
const hands: Card[][] = [
  ['7H', '7D', '7C', '8H', '8D', '8C'],
  ['AH', 'AD', 'AC', 'KH', 'KD', 'KC'],
  ['9H', '9D', '9C', '10H', '10D', '10C'],
  ['JH', 'JD', 'JC', 'QH', 'QD', 'QC'],
];
const game = (callSeat: number, value: number) =>
  playingGame({ hands, trump: 'S', contract: { seat: callSeat, value }, leader: 1, tricksPerSet: 6 });

/** Plays a round in which every seat (1, 2, 3, 0) plays its first card of `suit`. */
const round = (s: GameState, suit: string) =>
  playTrick(s, [1, 2, 3, 0].map((seat) => s.hands[seat].find((c) => c.endsWith(suit))!));

describe('the set ends as soon as its result is decided', () => {
  it('ends the moment the calling team makes its call', () => {
    let s = game(1, 3);
    s = round(s, 'H');
    s = round(s, 'D');
    expect(s.phase).toBe('playing');
    s = round(s, 'C'); // third round won = call of 3 made
    expect(s.phase).toBe('setOver');
    expect(s.completedTricks).toHaveLength(3);
    expect(s.scores).toEqual([0, 3]);
    expect(s.setHistory[0]).toMatchObject({ made: true, delta: 3, roundsPlayed: 3 });
    // Unplayed cards stay in hands; nobody can keep playing.
    expect(s.hands[1]).toHaveLength(3);
    expect(() => act(s, 1, { type: 'PLAY_CARD', card: 'KH' })).toThrow(/not playing/i);
  });

  it('ends the moment the calling team can no longer make its call', () => {
    // Team 0 calls 4 of 6 rounds; after losing 3, at most 3 remain, so 4 is impossible.
    let s = game(0, 4);
    s = round(s, 'H');
    s = round(s, 'D');
    expect(s.phase).toBe('playing');
    s = round(s, 'C');
    expect(s.phase).toBe('setOver');
    expect(s.scores).toEqual([-8, 0]); // first failure counts double
    expect(s.setHistory[0]).toMatchObject({ made: false, roundsPlayed: 3 });
  });

  it('does not end while the result is still open', () => {
    let s = game(1, 6);
    for (const suit of ['H', 'D', 'C', 'H', 'D']) s = round(s, suit);
    expect(s.phase).toBe('playing');
    s = round(s, 'C');
    expect(s.phase).toBe('setOver');
    expect(s.setHistory[0].roundsPlayed).toBe(6);
  });

  it('the next dealer deals after an early end', () => {
    let s = game(1, 1);
    s = round(s, 'H');
    expect(s.phase).toBe('setOver');
    expect(s.turn).toBe(1);
    s = act(s, 1, { type: 'NEXT_SET' });
    expect(s.phase).toBe('bidding');
    for (const h of s.hands) expect(h).toHaveLength(8);
  });
});
