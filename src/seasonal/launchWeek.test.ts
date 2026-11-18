import { describe, expect, it } from 'vitest';
import { isLaunchWeek } from './launchWeek';
import { currentSeason } from './seasons';

describe('isLaunchWeek', () => {
  it('covers November 18 to 25, 2026, in India time', () => {
    // IST is UTC+5:30, so India's November 18 starts at 18:30 UTC on November 17.
    expect(isLaunchWeek(new Date('2026-11-17T18:29:59Z'))).toBe(false);
    expect(isLaunchWeek(new Date('2026-11-17T18:30:00Z'))).toBe(true);
    expect(isLaunchWeek(new Date('2026-11-22T12:00:00Z'))).toBe(true);
    expect(isLaunchWeek(new Date('2026-11-25T18:29:59Z'))).toBe(true);
    expect(isLaunchWeek(new Date('2026-11-25T18:30:00Z'))).toBe(false);
  });

  it('is a one-off: not the same week in other years', () => {
    expect(isLaunchWeek(new Date('2027-11-20T06:00:00Z'))).toBe(false);
    expect(isLaunchWeek(new Date('2025-11-20T06:00:00Z'))).toBe(false);
  });
});

describe('currentSeason', () => {
  it('picks the season for the date, or none', () => {
    expect(currentSeason(new Date('2026-10-30T12:00:00Z'))).toBe('halloween');
    expect(currentSeason(new Date('2026-11-20T12:00:00Z'))).toBe('neon');
    expect(currentSeason(new Date('2026-11-12T12:00:00Z'))).toBeNull();
    expect(currentSeason(new Date('2026-12-25T12:00:00Z'))).toBeNull();
  });
});

describe('Joker heist timing', () => {
  it('the overlay length matches the bots pause', async () => {
    const { HEIST_MS, HEIST_REDUCED_MS } = await import('../ui/seasonal/neonHeist');
    const { LAUNCH_JOKER_MS, LAUNCH_JOKER_PAUSE_MS } = await import('./launchWeek');
    expect(HEIST_MS).toBe(LAUNCH_JOKER_MS);
    expect(LAUNCH_JOKER_PAUSE_MS).toBeGreaterThan(HEIST_MS);
    expect(LAUNCH_JOKER_PAUSE_MS).toBeGreaterThan(HEIST_REDUCED_MS);
  });
});
