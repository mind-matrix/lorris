// Halloween season: the app switches to its Halloween theme and music, and when the Joker is
// played, every player sees the haunted-portrait animation.
//
// No browser code here: the bot pacing (which may run on an online host) uses this too.

import { JOKER, type GameEvent } from '../core';

/**
 * Halloween season: three weeks, from October 18 to November 7 inclusive. That's the week of
 * Halloween (October 25-31) plus one week before and one week after it.
 */
const SEASON_START = { month: 10, day: 18 };
const SEASON_END = { month: 11, day: 7 };

/**
 * The season is judged in India Standard Time for everyone, not each phone's own time zone,
 * so all players at a table agree on whether the animation plays.
 */
const TIME_ZONE = 'Asia/Kolkata';

/** How long the Joker animation runs. Must match `ANIMATION_SECONDS` in the UI's animation. */
export const HALLOWEEN_JOKER_MS = 5600;

/** Bots wait this long after a Joker is played in Halloween season, so nobody misses a move. */
export const HALLOWEEN_JOKER_PAUSE_MS = HALLOWEEN_JOKER_MS + 300;

const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'numeric', day: 'numeric' });

/** True during Halloween season (Oct 18 – Nov 7, India time), every year. */
export function isHalloweenSeason(now: Date = new Date()): boolean {
  let month = 0;
  let day = 0;
  for (const part of dateParts.formatToParts(now)) {
    if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
  }
  const key = month * 100 + day; // e.g. October 18 -> 1018
  return key >= SEASON_START.month * 100 + SEASON_START.day && key <= SEASON_END.month * 100 + SEASON_END.day;
}

/** The last day of the season, for display ("until November 7"). */
export const HALLOWEEN_SEASON_END_LABEL = 'November 7';

/**
 * Whether the most recent card played was the Joker, and nothing has been played since.
 * The Joker can complete a round (and even a set), so events that follow a card play
 * (the round's winner, the set's score, game over) are skipped.
 */
export function jokerJustPlayed(log: readonly GameEvent[]): boolean {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'CARD_PLAYED') return e.card === JOKER;
    if (e.type !== 'TRICK_WON' && e.type !== 'SET_SCORED' && e.type !== 'GAME_OVER') return false;
  }
  return false;
}
