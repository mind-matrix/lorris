import { describe, expect, it } from 'vitest';
import { JOKER, type Card, type GameEvent } from '../core';
import { ANIMATION_SECONDS, REDUCED_MOTION_MS } from '../ui/seasonal/hauntedPortrait';
import { HALLOWEEN_JOKER_MS, HALLOWEEN_JOKER_PAUSE_MS, isHalloweenSeason, jokerJustPlayed } from './halloween';

describe('isHalloweenSeason', () => {
  it('covers October 18 to November 7 in India time, every year', () => {
    // IST is UTC+5:30, so India's October 18 starts at 18:30 UTC on October 17.
    expect(isHalloweenSeason(new Date('2026-10-17T18:29:59Z'))).toBe(false);
    expect(isHalloweenSeason(new Date('2026-10-17T18:30:00Z'))).toBe(true);
    expect(isHalloweenSeason(new Date('2026-10-31T12:00:00Z'))).toBe(true);
    expect(isHalloweenSeason(new Date('2026-11-01T06:00:00Z'))).toBe(true);
    expect(isHalloweenSeason(new Date('2026-11-07T18:29:59Z'))).toBe(true);
    expect(isHalloweenSeason(new Date('2026-11-07T18:30:00Z'))).toBe(false);
    expect(isHalloweenSeason(new Date('2027-10-20T06:00:00Z'))).toBe(true);
    expect(isHalloweenSeason(new Date('2031-11-05T00:00:00Z'))).toBe(true);
  });

  it('is off the rest of the year', () => {
    for (const d of ['2026-01-28', '2026-09-28', '2026-10-15', '2026-11-10', '2026-12-31']) {
      expect(isHalloweenSeason(new Date(`${d}T06:00:00Z`))).toBe(false);
    }
  });
});

describe('jokerJustPlayed', () => {
  let seq = 0;
  const play = (card: Card): GameEvent => ({ seq: seq++, type: 'CARD_PLAYED', seat: 0, card });
  const won: GameEvent = { seq: 900, type: 'TRICK_WON', seat: 1, trickIndex: 0 };
  const scored = { seq: 901, type: 'SET_SCORED', result: {} } as unknown as GameEvent;

  it('is true right after the Joker, including when it completes a round or the set', () => {
    expect(jokerJustPlayed([play('AS'), play(JOKER)])).toBe(true);
    expect(jokerJustPlayed([play('AS'), play(JOKER), won])).toBe(true);
    expect(jokerJustPlayed([play('AS'), play(JOKER), won, scored])).toBe(true);
  });

  it('is false once another card follows, or for any other last move', () => {
    expect(jokerJustPlayed([play(JOKER), play('KH')])).toBe(false);
    expect(jokerJustPlayed([play(JOKER), won, play('KH')])).toBe(false);
    expect(jokerJustPlayed([play('AS')])).toBe(false);
    expect(jokerJustPlayed([{ seq: 1, type: 'BID', seat: 0, bid: 5 }])).toBe(false);
    expect(jokerJustPlayed([])).toBe(false);
  });
});

describe('timing', () => {
  it('the overlay length matches the animation, and bots wait for it', () => {
    expect(Math.abs(HALLOWEEN_JOKER_MS - ANIMATION_SECONDS * 1000)).toBeLessThan(100);
    expect(HALLOWEEN_JOKER_PAUSE_MS).toBeGreaterThan(HALLOWEEN_JOKER_MS);
    expect(HALLOWEEN_JOKER_PAUSE_MS).toBeGreaterThan(REDUCED_MOTION_MS);
  });
});
