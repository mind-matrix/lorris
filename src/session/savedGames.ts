// Looks up games this device can pick back up. Deliberately free of any network code, so the
// start screen can check without loading Trystero.

import { saveStore } from '../save/appStore';
import { loadSave } from '../save/migrations';
import type { SaveIndexEntry } from '../save/SaveStore';
import { defaultStore, STORAGE_KEYS, type ClientGameRef } from './storage';

const storage = defaultStore();

/** Online games this device is hosting (saved by the host, or autosaved before a crash). */
export async function hostedSaves(): Promise<SaveIndexEntry[]> {
  return (await saveStore.list()).filter((e) => e.role === 'host');
}

/** Online games this device joined as a client and still holds a seat in. */
export async function clientRefs(): Promise<ClientGameRef[]> {
  const refs: ClientGameRef[] = [];
  for (const key of await storage.keys('ref:')) {
    const ref = await storage.get<ClientGameRef>(key);
    if (ref && (await storage.get(STORAGE_KEYS.seat(ref.roomCode)))) refs.push(ref);
  }
  return refs.sort((a, b) => b.savedAt - a.savedAt);
}

export async function forgetClientRef(roomCode: string): Promise<void> {
  await storage.batch([{ key: STORAGE_KEYS.clientRef(roomCode) }, { key: STORAGE_KEYS.seat(roomCode) }]);
}

/**
 * One-time upgrade: Phase 2 kept a hosted game as a 'hosted:<code>' record (save format 0).
 * Move any such record into the saved games list (migrating it), then remove the old keys.
 */
export async function migrateLegacyHostedGames(): Promise<void> {
  for (const key of await storage.keys('hosted:')) {
    if (key !== 'hosted:current') {
      const loaded = loadSave(await storage.get(key));
      if (loaded.ok && !(await saveStore.has(loaded.save.id))) await saveStore.save(loaded.save, 'host').catch(() => {});
    }
    await storage.delete(key);
  }
}
