// Which seasonal theme is on right now. Re-checked periodically and whenever the app comes
// back to the foreground, so a game left open overnight switches on the right day.

import { currentSeason, type SeasonId } from '../seasonal/seasons';

function read(): { id: SeasonId | null; halloween: boolean; neon: boolean } {
  const id = currentSeason();
  return { id, halloween: id === 'halloween', neon: id === 'neon' };
}

/** `id` is the theme on now (or null); `halloween` and `neon` are shortcuts for templates. */
export const season = $state(read());

const RECHECK_MS = 10 * 60 * 1000;

/** Starts watching the date. Returns a function that stops it. */
export function watchSeason(): () => void {
  const check = () => Object.assign(season, read());
  const timer = setInterval(check, RECHECK_MS);
  document.addEventListener('visibilitychange', check);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', check);
  };
}

/** The browser bar color for each theme. */
const THEME_COLOR: Record<SeasonId | 'none', string> = { halloween: '#140d1a', neon: '#120726', none: '#1b6e48' };

/** Puts the theme on the page: data-season on <html> (read by theme.css) and the browser bar color. */
export function applySeason(id: SeasonId | null): void {
  const root = document.documentElement;
  if (id) root.dataset.season = id;
  else delete root.dataset.season;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[id ?? 'none']);
}
