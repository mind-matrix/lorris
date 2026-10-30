// Player settings, kept on this device. Read synchronously at startup (localStorage), so the
// very first sound already respects them.

export interface Settings {
  /** Sound effects, such as the Joker's laugh in Halloween season. */
  soundEffects: boolean;
  /** Background music (Halloween season). */
  music: boolean;
}

export const DEFAULT_SETTINGS: Settings = { soundEffects: true, music: true };
const KEY = 'lorris:settings';

/** Minimal storage interface, so tests can pass a fake. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage blocked (private mode, some embedded browsers)
  }
}

/** Reads saved settings; anything missing or damaged falls back to the default. */
export function loadSettings(storage: SettingsStorage | null = browserStorage()): Settings {
  try {
    const raw = storage?.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return {
      soundEffects: typeof saved.soundEffects === 'boolean' ? saved.soundEffects : DEFAULT_SETTINGS.soundEffects,
      music: typeof saved.music === 'boolean' ? saved.music : DEFAULT_SETTINGS.music,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, storage: SettingsStorage | null = browserStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not saved (storage full or blocked): the setting still applies until the app closes.
  }
}

/** The live settings. Change them only through `updateSettings`, so they're saved. */
export const settings: Settings = $state(loadSettings());

export function updateSettings(change: Partial<Settings>): void {
  Object.assign(settings, change);
  saveSettings({ soundEffects: settings.soundEffects, music: settings.music });
}
