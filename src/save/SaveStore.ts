// Saved games in IndexedDB (through KeyValueStore).
//
// Layout (all in the 'kv' store):
//   save:<id>:a, save:<id>:b   two slots per game: { seq, envelope }
//   saves:index                [{ id, label, mode, role, savedAt }] for the saved games list
//
// Each write goes to the slot that does NOT hold the newest good save, together with the index,
// in one atomic batch. Loading takes the newest slot that passes validation. So a crash, or a
// write that somehow lands damaged, can only ever cost the newest save; the previous one loads.

import type { KeyValueStore } from '../session/storage';
import type { LoadResult, SaveEnvelope, SaveLabel } from './envelope';
import { loadSave } from './migrations';

export const MAX_SAVES = 10;
const INDEX_KEY = 'saves:index';
const slotKey = (id: string, slot: 'a' | 'b') => `save:${id}:${slot}`;

export type SaveRole = 'offline' | 'host';

export interface SaveIndexEntry {
  id: string;
  label: SaveLabel;
  mode: SaveEnvelope['mode'];
  role: SaveRole;
  savedAt: number;
}

interface Slot {
  seq: number;
  envelope: unknown;
}

export class SaveLimitError extends Error {
  constructor() {
    super(`You have ${MAX_SAVES} saved games. Delete one to save another.`);
  }
}

export class SaveStore {
  /** Writes run one after another, so two games saving at once can't overwrite each other's index. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private kv: KeyValueStore,
    readonly maxSaves = MAX_SAVES,
  ) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async list(): Promise<SaveIndexEntry[]> {
    const index = (await this.kv.get<SaveIndexEntry[]>(INDEX_KEY)) ?? [];
    return [...index].sort((a, b) => b.savedAt - a.savedAt);
  }

  async has(id: string): Promise<boolean> {
    return (await this.list()).some((e) => e.id === id);
  }

  /** Whether a brand-new game can be saved (existing games can always keep saving). */
  async canCreate(): Promise<boolean> {
    return (await this.list()).length < this.maxSaves;
  }

  /** Reads both slots and returns the newest one that validates, migrating if needed. */
  async load(id: string): Promise<LoadResult> {
    const best = await this.readSlots(id);
    if (best.good) return best.good.result;
    return best.firstError ?? { ok: false, error: { code: 'NOT_A_SAVE', message: 'That saved game no longer exists.' } };
  }

  /** Atomically writes a save (and its index entry). Throws SaveLimitError for a new game when full. */
  save(envelope: SaveEnvelope, role: SaveRole): Promise<void> {
    return this.exclusive(() => this.write(envelope, role));
  }

  private async write(envelope: SaveEnvelope, role: SaveRole): Promise<void> {
    const index = (await this.kv.get<SaveIndexEntry[]>(INDEX_KEY)) ?? [];
    const exists = index.some((e) => e.id === envelope.id);
    if (!exists && index.length >= this.maxSaves) throw new SaveLimitError();

    const { good, slots } = await this.readSlots(envelope.id);
    const seq = Math.max(slots.a?.seq ?? 0, slots.b?.seq ?? 0) + 1;
    // Never overwrite the slot holding the newest good save.
    const target: 'a' | 'b' = good?.slot === 'a' ? 'b' : good?.slot === 'b' ? 'a' : (slots.a?.seq ?? 0) <= (slots.b?.seq ?? 0) ? 'a' : 'b';
    const entry: SaveIndexEntry = { id: envelope.id, label: envelope.label, mode: envelope.mode, role, savedAt: envelope.savedAt };
    const nextIndex = [...index.filter((e) => e.id !== envelope.id), entry];
    await this.kv.batch([
      { key: slotKey(envelope.id, target), value: { seq, envelope } satisfies Slot },
      { key: INDEX_KEY, value: nextIndex },
    ]);
  }

  delete(id: string): Promise<void> {
    return this.exclusive(() => this.remove(id));
  }

  private async remove(id: string): Promise<void> {
    const index = (await this.kv.get<SaveIndexEntry[]>(INDEX_KEY)) ?? [];
    await this.kv.batch([
      { key: slotKey(id, 'a') },
      { key: slotKey(id, 'b') },
      { key: INDEX_KEY, value: index.filter((e) => e.id !== id) },
    ]);
  }

  private async readSlots(id: string) {
    const slots = {
      a: await this.kv.get<Slot>(slotKey(id, 'a')).catch(() => undefined),
      b: await this.kv.get<Slot>(slotKey(id, 'b')).catch(() => undefined),
    };
    let good: { slot: 'a' | 'b'; seq: number; result: LoadResult } | null = null;
    let firstError: LoadResult | null = null;
    for (const slot of ['a', 'b'] as const) {
      const s = slots[slot];
      if (!s || typeof s !== 'object' || typeof s.seq !== 'number') continue;
      const result = loadSave(s.envelope);
      if (!result.ok) {
        firstError ??= result;
        continue;
      }
      if (!good || s.seq > good.seq) good = { slot, seq: s.seq, result };
    }
    return { good, firstError, slots };
  }
}

/**
 * Saves after every change without piling up writes: at most one write runs at a time, and while
 * it runs only the newest pending envelope is kept. `flush()` waits for everything to be on disk.
 */
export class Autosaver {
  private pending: SaveEnvelope | null = null;
  private running: Promise<void> | null = null;
  /** Set when the save list was full and this game couldn't be saved. */
  limitReached = false;
  lastError: unknown = null;

  constructor(
    private store: SaveStore,
    private role: SaveRole,
  ) {}

  request(envelope: SaveEnvelope): void {
    this.pending = envelope;
    if (!this.running) this.running = this.drain();
  }

  async flush(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const next = this.pending;
        this.pending = null;
        try {
          await this.store.save(next, this.role);
          this.lastError = null;
        } catch (e) {
          if (e instanceof SaveLimitError) this.limitReached = true;
          this.lastError = e;
        }
      }
    } finally {
      this.running = null;
    }
  }
}
