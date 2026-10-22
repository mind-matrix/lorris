import { cleanName } from '../net/validate';
import { defaultStore, STORAGE_KEYS, type Profile } from './storage';

// The display name is stored locally (IndexedDB) so players don't retype it every time.
const store = defaultStore();

export async function loadName(): Promise<string> {
  return (await store.get<Profile>(STORAGE_KEYS.profile))?.name ?? '';
}

export async function saveName(name: string): Promise<string | null> {
  const clean = cleanName(name);
  if (clean) await store.set(STORAGE_KEYS.profile, { name: clean } satisfies Profile);
  return clean;
}
