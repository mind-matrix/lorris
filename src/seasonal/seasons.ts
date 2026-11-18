// Which seasonal theme (if any) is on. Seasons never overlap; Halloween wins if they ever did.
//
// No browser code here: the bot pacing (which may run on an online host) uses this too.

import { HALLOWEEN_JOKER_PAUSE_MS, isHalloweenSeason } from './halloween';
import { LAUNCH_JOKER_PAUSE_MS, isLaunchWeek } from './launchWeek';

/** 'halloween': Oct 18 - Nov 7 every year. 'neon': GTA VI launch week, Nov 18-25 2026. */
export type SeasonId = 'halloween' | 'neon';

export function currentSeason(now: Date = new Date()): SeasonId | null {
  if (isHalloweenSeason(now)) return 'halloween';
  if (isLaunchWeek(now)) return 'neon';
  return null;
}

/** How long every season's Joker animation holds the table (bots wait this long after it). */
export const SEASON_JOKER_PAUSE_MS: Record<SeasonId, number> = {
  halloween: HALLOWEEN_JOKER_PAUSE_MS,
  neon: LAUNCH_JOKER_PAUSE_MS,
};
