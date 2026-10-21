import { describe, expect, it } from 'vitest';
import { setDelta } from './scoring';
import { act, playingGame, playTrick } from './testUtils';
import type { Card, GameState } from './types';

// One-round sets keep these tests short: seat 1 (team 1) leads AH and wins; seat 0 leads 7H and loses.
const winningHands: Card[][] = [['7H'], ['AH'], ['8H'], ['9H']];

function oneRoundSet(opts: { callSeat: number; value: number; bidTeamWins: boolean; scores?: [number, number]; failed?: [boolean, boolean] }): GameState {
  const s = playingGame({
    hands: opts.bidTeamWins === (opts.callSeat % 2 === 1) ? winningHands : [['AH'], ['7H'], ['8H'], ['9H']],
    trump: 'S',
    contract: { seat: opts.callSeat, value: opts.value },
    leader: 0,
    tricksPerSet: 1,
  });
  return { ...s, scores: opts.scores ?? [0, 0], hasFailedBefore: opts.failed ?? [false, false] };
}

const finish = (s: GameState) => playTrick(s, s.hands.map((_, i) => s.hands[(s.trick.leader + i) % 4][0]));

describe('scoring', () => {
  it('setDelta: +call on success, -2x call on first failure, -call afterwards', () => {
    expect(setDelta(5, true, false)).toBe(5);
    expect(setDelta(5, true, true)).toBe(5);
    expect(setDelta(5, false, false)).toBe(-10);
    expect(setDelta(5, false, true)).toBe(-5);
  });

  it('the calling team gains their call when they make it; the other team gets nothing', () => {
    // Value 1 so a single won round makes the call in a one-round set.
    const s = finish(oneRoundSet({ callSeat: 1, value: 1, bidTeamWins: true }));
    expect(s.phase).toBe('setOver');
    expect(s.scores).toEqual([0, 1]);
    expect(s.setHistory[0]).toMatchObject({ made: true, delta: 1, bidTeam: 1, roundsPlayed: 1 });
  });

  it('the first failure costs double, later failures cost the call', () => {
    let s = finish(oneRoundSet({ callSeat: 1, value: 1, bidTeamWins: false }));
    expect(s.scores).toEqual([0, -2]);
    expect(s.hasFailedBefore).toEqual([false, true]);
    s = finish(oneRoundSet({ callSeat: 1, value: 1, bidTeamWins: false, scores: s.scores, failed: s.hasFailedBefore }));
    expect(s.scores).toEqual([0, -3]);
  });

  it('the defending team never scores, even when they defeat the call', () => {
    const s = finish(oneRoundSet({ callSeat: 0, value: 1, bidTeamWins: false, scores: [3, 3] }));
    expect(s.scores).toEqual([1, 3]);
  });

  it('negative scores are allowed', () => {
    const s = finish(oneRoundSet({ callSeat: 1, value: 1, bidTeamWins: false, scores: [0, -20], failed: [false, true] }));
    expect(s.scores[1]).toBe(-21);
    expect(s.phase).toBe('setOver');
  });
});

describe('end of game', () => {
  it('reaching 32 wins the game', () => {
    const s = finish(oneRoundSet({ callSeat: 1, value: 1, bidTeamWins: true, scores: [10, 31] }));
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toBe(1);
    expect(s.turn).toBeNull();
    expect(s.log.at(-1)).toMatchObject({ type: 'GAME_OVER', winner: 1 });
  });

  it('going past 32 also wins', () => {
    const s = finish(oneRoundSet({ callSeat: 0, value: 1, bidTeamWins: true, scores: [31, 0] }));
    expect(s.scores[0]).toBe(32);
    expect(s.winner).toBe(0);
  });

  it('31 is not enough', () => {
    const s = finish(oneRoundSet({ callSeat: 1, value: 1, bidTeamWins: true, scores: [0, 30] }));
    expect(s.phase).toBe('setOver');
  });

  it('no actions are accepted after the game is over', () => {
    const s = finish(oneRoundSet({ callSeat: 1, value: 1, bidTeamWins: true, scores: [0, 31] }));
    expect(() => act(s, 0, { type: 'NEXT_SET' })).toThrow(/game is over/i);
  });
});

describe('next set', () => {
  it('only the next dealer (anti-clockwise) may deal, and the dealer rotates', () => {
    const s = finish(oneRoundSet({ callSeat: 1, value: 1, bidTeamWins: true }));
    expect(s.dealer).toBe(0);
    expect(s.turn).toBe(1);
    expect(() => act(s, 2, { type: 'NEXT_SET' })).toThrow();
    const next = act(s, 1, { type: 'NEXT_SET' });
    expect(next.dealer).toBe(1);
    expect(next.cutter).toBe(2);
    expect(next.turn).toBe(2);
    expect(next.phase).toBe('bidding');
    expect(next.setNumber).toBe(s.setNumber + 1);
    expect(next.scores).toEqual(s.scores);
    expect(next.completedTricks).toEqual([]);
    expect(next.tricksWon).toEqual([0, 0]);
    for (const h of next.hands) expect(h).toHaveLength(8);
  });
});
