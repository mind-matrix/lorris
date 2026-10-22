// Moving a save between devices as a .lorris file (the host's or offline player's own backup).

import type { LoadResult, SaveEnvelope } from './envelope';
import { loadSave } from './migrations';

export const SAVE_FILE_EXTENSION = '.lorris';
export const SAVE_FILE_TYPE = 'application/json';

export function saveFileName(save: SaveEnvelope): string {
  const who = save.label.players.filter((n) => !/^Bot \d+$/.test(n)).join('-') || 'game';
  const day = new Date(save.savedAt).toISOString().slice(0, 10);
  return `lorris-${who.toLowerCase().replace(/[^a-z0-9-]+/g, '')}-${day}${SAVE_FILE_EXTENSION}`;
}

export function saveFileContents(save: SaveEnvelope): string {
  return JSON.stringify(save);
}

/** Imports go through exactly the same validation and migration as loading from storage. */
export function parseSaveFile(text: string): LoadResult {
  if (text.length > 2_000_000) return { ok: false, error: { code: 'NOT_A_SAVE', message: "That file is too big to be a Lorris saved game." } };
  return loadSave(text);
}
