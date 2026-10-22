// Small async key-value store. IndexedDB in the browser (no library), in-memory for tests.

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private data = new Map<string, string>();
  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export class IndexedDbStore implements KeyValueStore {
  private db: Promise<IDBDatabase>;

  constructor(name = 'lorris', private store = 'kv') {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const req = op(db.transaction(this.store, mode).objectStore(this.store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }

  get<T>(key: string): Promise<T | undefined> {
    return this.run('readonly', (s) => s.get(key));
  }
  async set(key: string, value: unknown): Promise<void> {
    // Values are plain JSON data; copying them this way also unwraps reactive UI proxies,
    // which IndexedDB can't store.
    const plain = JSON.parse(JSON.stringify(value));
    await this.run('readwrite', (s) => s.put(plain, key));
  }
  async delete(key: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(key));
  }
}

/** Falls back to memory when IndexedDB isn't available (private mode in some browsers). */
export function defaultStore(): KeyValueStore {
  try {
    if (typeof indexedDB !== 'undefined') return new IndexedDbStore();
  } catch {
    /* fall through */
  }
  return new MemoryStore();
}

// Keys used across the app.
export const STORAGE_KEYS = {
  profile: 'profile',
  /** This device's seat token for a room it joined. */
  seat: (roomCode: string) => `seat:${roomCode}`,
  /** The full saved game for a room this device hosts (so the host can resume). */
  hostedGame: (roomCode: string) => `hosted:${roomCode}`,
  /** Room code of the game this device is currently hosting, if any. */
  currentHosted: 'hosted:current',
  /** Room code of the game this device last joined as a client, for a quick "Rejoin" button. */
  lastJoined: 'joined:last',
};

export interface Profile {
  name: string;
}
