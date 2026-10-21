import { describe, expect, it } from 'vitest';
import { makeConfig } from './config';
import { createGame } from './deal';
import { getLegalActions, getLegalActionsFromView } from './legal';
import { getPlayerView } from './view';

describe('player view', () => {
  for (const n of [4, 6]) {
    it(`${n} players: shows only my hand, card counts, and public state`, () => {
      const s = createGame(makeConfig(n), 9);
      const view = getPlayerView(s, 2);
      expect(view.seat).toBe(2);
      expect(view.myHand).toEqual(s.hands[2]);
      expect(view.handCounts).toEqual(Array(n).fill(8));
      expect(view).not.toHaveProperty('hands');
      expect(view).not.toHaveProperty('rng');
      // No other player's card appears anywhere in the serialized view.
      const json = JSON.stringify(view);
      for (let seat = 0; seat < n; seat++) {
        if (seat === 2) continue;
        for (const card of s.hands[seat]) expect(json).not.toMatch(new RegExp(`"${card}"`));
      }
    });
  }

  it('is a copy: changing it does not touch the state', () => {
    const s = createGame(makeConfig(4), 9);
    const view = getPlayerView(s, 0);
    view.myHand.pop();
    view.scores[0] = 99;
    expect(s.hands[0]).toHaveLength(8);
    expect(s.scores[0]).toBe(0);
  });

  it('legal actions from a view match legal actions from full state', () => {
    const s = createGame(makeConfig(6), 3);
    for (let seat = 0; seat < 6; seat++) {
      expect(getLegalActionsFromView(getPlayerView(s, seat))).toEqual(getLegalActions(s, seat));
    }
  });

  it('is JSON round-trippable', () => {
    const view = getPlayerView(createGame(makeConfig(4), 1), 1);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
