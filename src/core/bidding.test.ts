import { describe, expect, it } from 'vitest';
import { getLegalActions } from './legal';
import { act, biddingGame, expectError } from './testUtils';

describe('bidding', () => {
  it('the minimum call is 4 and the maximum is 8', () => {
    const s = biddingGame();
    expectError(s, 1, { type: 'BID', value: 3 }, 'BID_OUT_OF_RANGE');
    expectError(s, 1, { type: 'BID', value: 9 }, 'BID_OUT_OF_RANGE');
    expectError(s, 1, { type: 'BID', value: 4.5 }, 'BID_OUT_OF_RANGE');
    expect(act(s, 1, { type: 'BID', value: 4 }).bids).toEqual([{ seat: 1, bid: 4 }]);
  });

  it('only the player whose turn it is may call, starting with the cutter', () => {
    const s = biddingGame();
    expectError(s, 2, { type: 'BID', value: 5 }, 'NOT_YOUR_TURN');
    expectError(s, 0, { type: 'PASS' }, 'NOT_YOUR_TURN');
    expect(act(s, 1, { type: 'PASS' }).turn).toBe(2);
  });

  it('each call must be higher than the current highest', () => {
    let s = act(biddingGame(), 1, { type: 'BID', value: 5 });
    expectError(s, 2, { type: 'BID', value: 5 }, 'BID_NOT_HIGHER');
    expectError(s, 2, { type: 'BID', value: 4 }, 'BID_NOT_HIGHER');
    s = act(s, 2, { type: 'BID', value: 6 });
    expect(s.turn).toBe(3);
  });

  it('legal actions list pass plus every higher call', () => {
    const s = act(biddingGame(), 1, { type: 'BID', value: 6 });
    expect(getLegalActions(s, 2)).toEqual([
      { type: 'PASS' },
      { type: 'BID', value: 7 },
      { type: 'BID', value: 8 },
    ]);
    expect(getLegalActions(s, 3)).toEqual([]);
  });

  it('goes around once; the highest caller (even a teammate overcall) wins and picks trump', () => {
    let s = biddingGame();
    s = act(s, 1, { type: 'BID', value: 4 });
    s = act(s, 2, { type: 'PASS' });
    s = act(s, 3, { type: 'BID', value: 5 }); // teammate of seat 1 overcalls
    expect(s.phase).toBe('bidding');
    s = act(s, 0, { type: 'PASS' });
    expect(s.phase).toBe('choosingTrump');
    expect(s.contract).toEqual({ seat: 3, value: 5, forced: false });
    expect(s.turn).toBe(3);
  });

  it('a call of 8 ends bidding immediately', () => {
    let s = biddingGame(6);
    s = act(s, 1, { type: 'BID', value: 4 });
    s = act(s, 2, { type: 'BID', value: 8 });
    expect(s.phase).toBe('choosingTrump');
    expect(s.contract).toMatchObject({ seat: 2, value: 8 });
  });

  it('if everyone passes, the cutter is forced to call 4', () => {
    let s = biddingGame(6);
    for (const seat of [1, 2, 3, 4, 5, 0]) s = act(s, seat, { type: 'PASS' });
    expect(s.phase).toBe('choosingTrump');
    expect(s.contract).toEqual({ seat: 1, value: 4, forced: true });
    expect(s.log.some((e) => e.type === 'FORCED_BID')).toBe(true);
  });

  it('cannot bid outside the bidding phase', () => {
    let s = biddingGame();
    s = act(s, 1, { type: 'BID', value: 8 });
    expectError(s, 2, { type: 'BID', value: 5 }, 'WRONG_PHASE');
  });

  it('rejects unknown actions and seats', () => {
    const s = biddingGame();
    expectError(s, 1, { type: 'NOPE' } as never, 'INVALID_ACTION');
    expectError(s, 7, { type: 'PASS' }, 'INVALID_SEAT');
    expectError(s, -1, { type: 'PASS' }, 'INVALID_SEAT');
  });

  it('never mutates the input state', () => {
    const s = biddingGame();
    const before = JSON.stringify(s);
    act(s, 1, { type: 'BID', value: 5 });
    expect(JSON.stringify(s)).toBe(before);
  });
});
