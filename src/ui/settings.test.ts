import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type SettingsStorage } from './settings.svelte';
import { SCORE } from './seasonal/halloweenMusic';

function fakeStorage(initial: Record<string, string> = {}): SettingsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('settings', () => {
  it('defaults to sound effects and music on', () => {
    expect(loadSettings(fakeStorage())).toEqual({ soundEffects: true, music: true });
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('saves and loads', () => {
    const storage = fakeStorage();
    saveSettings({ soundEffects: false, music: true }, storage);
    expect(loadSettings(storage)).toEqual({ soundEffects: false, music: true });
  });

  it('falls back to defaults for damaged or partial data', () => {
    expect(loadSettings(fakeStorage({ 'lorris:settings': '{not json' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(fakeStorage({ 'lorris:settings': '{"music":false,"soundEffects":"yes"}' }))).toEqual({
      soundEffects: true,
      music: false,
    });
  });

  it('survives storage that throws (blocked or full)', () => {
    const broken: SettingsStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
  });
});

describe('Halloween music score', () => {
  it('is 8 bars of 8 eighth notes, all in D minor (with its raised 7th, C#)', () => {
    expect(SCORE).toHaveLength(8);
    // D natural/harmonic minor plus Bb, G: pitch classes D E F G A Bb C C#.
    const allowed = new Set([2, 4, 5, 7, 9, 10, 0, 1]);
    for (const bar of SCORE) {
      expect(bar.melody).toHaveLength(8);
      for (const note of bar.melody) if (note !== null) expect(allowed.has(note % 12)).toBe(true);
      expect(allowed.has(bar.bass % 12)).toBe(true);
    }
  });
});
