// Looks up games this device can pick back up. Deliberately free of any network code, so the
// start screen can check without loading Trystero.

import type { SavedHostGame } from '../net/HostSession';
import { defaultStore, STORAGE_KEYS } from './storage';

const storage = defaultStore();

/** A game this device was hosting when the app was closed, if it had started and isn't over. */
export async function savedHostedGame(): Promise<SavedHostGame | null> {
  const code = await storage.get<string>(STORAGE_KEYS.currentHosted);
  if (!code) return null;
  const saved = await storage.get<SavedHostGame>(STORAGE_KEYS.hostedGame(code));
  return saved?.game && saved.game.state.phase !== 'gameOver' ? saved : null;
}

/** The last room we joined as a client, if we still hold a seat token for it. */
export async function lastJoinedRoom(): Promise<string | null> {
  const code = await storage.get<string>(STORAGE_KEYS.lastJoined);
  return code && (await storage.get(STORAGE_KEYS.seat(code))) ? code : null;
}

export async function forgetHostedGame(code: string): Promise<void> {
  await storage.delete(STORAGE_KEYS.hostedGame(code));
  await storage.delete(STORAGE_KEYS.currentHosted);
}
