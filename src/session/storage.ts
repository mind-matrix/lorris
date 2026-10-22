// Small async key-value store. IndexedDB in the browser (no library), in-memory for tests.

/** One write in an atomic batch: set `key` to `value`, or delete it when `value` is undefined. */
export interface BatchOp {
  key: string;
  value?: unknown;
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** All-or-nothing: either every op is applied, or none is (one IndexedDB transaction). */
  batch(ops: BatchOp[]): Promise<void>;
  /** Keys starting with `prefix`. */
  keys(prefix: string): Promise<string[]>;
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
  async batch(ops: BatchOp[]): Promise<void> {
    // Serialize everything first, so a bad value can't leave a half-applied batch.
    const prepared = ops.map((op) => ({ key: op.key, raw: op.value === undefined ? undefined : JSON.stringify(op.value) }));
    for (const { key, raw } of prepared) {
      if (raw === undefined) this.data.delete(key);
      else this.data.set(key, raw);
    }
  }
  async keys(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
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

  async batch(ops: BatchOp[]): Promise<void> {
    const plain = ops.map((op) => ({ key: op.key, value: op.value === undefined ? undefined : JSON.parse(JSON.stringify(op.value)) }));
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      // One transaction: IndexedDB commits all of it or none of it, even if the app dies mid-way.
      const tx = db.transaction(this.store, 'readwrite');
      const store = tx.objectStore(this.store);
      for (const op of plain) {
        if (op.value === undefined) store.delete(op.key);
        else store.put(op.value, op.key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async keys(prefix: string): Promise<string[]> {
    const all = await this.run<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    return all.map(String).filter((k) => k.startsWith(prefix));
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
  /** A client's reference to an online game it's seated in (no game state, ever). */
  clientRef: (roomCode: string) => `ref:${roomCode}`,
};

export interface Profile {
  name: string;
}

/** What a client keeps about an online game it's part of: enough to find it again, nothing secret about others. */
export interface ClientGameRef {
  roomCode: string;
  hostName: string;
  /** e.g. "Asha, Ben + 2 bots · 12–4 · Set 5" */
  label: string;
  savedAt: number;
  /** True once the host has saved and closed the room (vs. still playing, or crashed). */
  savedByHost: boolean;
}
