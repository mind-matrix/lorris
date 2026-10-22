import { defaultStore } from '../session/storage';
import { SaveStore } from './SaveStore';

/** The app's saved games (IndexedDB). One shared instance so writes are serialized. */
export const saveStore = new SaveStore(defaultStore());
