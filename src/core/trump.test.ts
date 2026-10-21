import { describe, expect, it } from 'vitest';
import { misdealTeam } from './rules';
import { makeConfig } from './config';
import { act, biddingGame, expectError } from './testUtils';
import type { Card, GameState } from './types';

function choosingTrump(hands?: Card[][]): GameState {
  const s = act(biddingGame(), 1, { type: 'BID', value: 8 });
  return hands ? { ...s, hands } : s;
}

describe('choosing trump', () => {
  it('only the highest caller may choose, and only a real suit', () => {
    const s = choosingTrump();
    expectError(s, 2, { type: 'CHOOSE_TRUMP', suit: 'H' }, 'NOT_YOUR_TURN');
    expectError(s, 1, { type: 'CHOOSE_TRUMP', suit: 'X' as never }, 'INVALID_SUIT');
  });

  it('starts play with the cutter leading', () => {
    const s = act(choosingTrump(), 1, { type: 'CHOOSE_TRUMP', suit: 'D' });
    expect(s.phase).toBe('playing');
    expect(s.trump).toBe('D');
    expect(s.turn).toBe(s.cutter);
    expect(s.trick).toEqual({ leader: s.cutter, plays: [] });
  });
});

describe('misdeal (rule 6)', () => {
  // Team 0 (seats 0 and 2) holds every heart plus the Joker.
  const hands: Card[][] = [
    ['AH', 'KH', 'QH', 'JH', '10H', '9H', '8H', '7H'],
    ['AS', 'KS', 'QS', 'JS', '10S', '9S', '8S', 'AD'],
    ['JK', 'KD', 'QD', 'JD', '10D', '9D', '8D', '7D'],
    ['AC', 'KC', 'QC', 'JC', '10C', '9C', '8C', '7C'],
  ];

  it('detects a team holding all trumps and the Joker', () => {
    expect(misdealTeam(makeConfig(4), hands, 'H')).toBe(0);
    expect(misdealTeam(makeConfig(4), hands, 'D')).toBeNull(); // AD is with team 1
    // All trumps without the Joker is not a misdeal.
    const noJoker = hands.map((h) => h.map((c) => (c === 'JK' ? '7D' : c === '7D' ? 'JK' : c)) as Card[]);
    noJoker[2] = ['7D', 'KD', 'QD', 'JD', '10D', '9D', '8D', 'AD'];
    noJoker[1] = ['AS', 'KS', 'QS', 'JS', '10S', '9S', '8S', 'JK'];
    expect(misdealTeam(makeConfig(4), noJoker, 'H')).toBeNull();
  });

  it('works for spades, which has one card fewer', () => {
    const spades: Card[][] = [
      ['AS', 'KS', 'QS', 'JS', '10S', '9S', '8S', 'JK'],
      ['AH', 'KH', 'QH', 'JH', '10H', '9H', '8H', '7H'],
      ['AD', 'KD', 'QD', 'JD', '10D', '9D', '8D', '7D'],
      ['AC', 'KC', 'QC', 'JC', '10C', '9C', '8C', '7C'],
    ];
    expect(misdealTeam(makeConfig(4), spades, 'S')).toBe(0);
  });

  it('cancels and re-deals with the same dealer when trump is chosen', () => {
    const s0 = choosingTrump(hands);
    const s = act(s0, 1, { type: 'CHOOSE_TRUMP', suit: 'H' });
    expect(s.phase).toBe('bidding');
    expect(s.dealer).toBe(s0.dealer);
    expect(s.setNumber).toBe(s0.setNumber);
    expect(s.bids).toEqual([]);
    expect(s.contract).toBeNull();
    expect(s.trump).toBeNull();
    expect(s.turn).toBe(s.cutter);
    expect(s.hands).not.toEqual(hands);
    for (const h of s.hands) expect(h).toHaveLength(8);
    expect(s.log.map((e) => e.type)).toEqual(expect.arrayContaining(['MISDEAL', 'SET_STARTED']));
  });

  it('works for 6 players with teams of three', () => {
    const config = makeConfig(6);
    const hands6: Card[][] = [
      ['AH', 'KH', 'QH', 'JH'],
      ['AS'],
      ['10H', '9H', '8H', '7H'],
      ['KS'],
      ['6H', '5H', '4H', '3H', 'JK'],
      ['QS'],
    ];
    expect(misdealTeam(config, hands6, 'H')).toBe(0);
    hands6[1].push('3H');
    hands6[4] = ['6H', '5H', '4H', 'JK'];
    expect(misdealTeam(config, hands6, 'H')).toBeNull();
  });
});
