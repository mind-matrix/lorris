// GTA VI launch week: a one-week neon "sunset city" theme celebrating the release of Grand Theft
// Auto VI on November 19, 2026. An original fan theme: no Rockstar logos, artwork, fonts,
// characters or music, just a nod to the release with our own neon-and-palms look.
//
// During the week the app switches to the neon theme and music, and when the Joker is played,
// every player sees the "Joker heist" animation.
//
// No browser code here: the bot pacing (which may run on an online host) uses this too.

/** From the day before release (launch eve) to a week after: November 18-25, 2026 inclusive. Not yearly. */
export const LAUNCH_WEEK_START = '2026-11-18';
export const LAUNCH_WEEK_END = '2026-11-25';

/** Judged in India Standard Time for everyone (like Halloween), so a whole table agrees. */
const TIME_ZONE = 'Asia/Kolkata';

/** How long the Joker heist animation runs. Must match `HEIST_MS` in the UI's animation. */
export const LAUNCH_JOKER_MS = 4200;

/** Bots wait this long after a Joker is played in launch week, so nobody misses a move. */
export const LAUNCH_JOKER_PAUSE_MS = LAUNCH_JOKER_MS + 300;

/** The last day of the theme, for display ("until November 25"). */
export const LAUNCH_WEEK_END_LABEL = 'November 25';

// en-CA formats dates as YYYY-MM-DD, which compares correctly as a string.
const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The date in India as YYYY-MM-DD. */
function indiaDate(now: Date): string {
  const parts = Object.fromEntries(isoDate.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** True during GTA VI launch week (November 18-25, 2026, India time). */
export function isLaunchWeek(now: Date = new Date()): boolean {
  const today = indiaDate(now);
  return today >= LAUNCH_WEEK_START && today <= LAUNCH_WEEK_END;
}
