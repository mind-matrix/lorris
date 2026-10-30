// Which seasonal theme is on right now. Re-checked periodically and whenever the app comes
// back to the foreground, so a game left open overnight switches on the right day.

import { isHalloweenSeason } from '../seasonal/halloween';

export const season = $state({ halloween: isHalloweenSeason() });

const RECHECK_MS = 10 * 60 * 1000;

/** Starts watching the date. Returns a function that stops it. */
export function watchSeason(): () => void {
  const check = () => (season.halloween = isHalloweenSeason());
  const timer = setInterval(check, RECHECK_MS);
  document.addEventListener('visibilitychange', check);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', check);
  };
}

/** Puts the theme on the page: data-season on <html> (read by theme.css) and the browser bar color. */
export function applySeason(halloween: boolean): void {
  const root = document.documentElement;
  if (halloween) root.dataset.season = 'halloween';
  else delete root.dataset.season;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', halloween ? '#140d1a' : '#1b6e48');
}
