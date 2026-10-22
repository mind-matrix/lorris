import { describe, expect, it } from 'vitest';
import { HeuristicBot, runGame } from '../ai';
import { applyAction, createGame, makeConfig, type Action, type GameState, type Seat } from '../core';
import { MemoryStore, type BatchOp } from '../session/storage';
import { canonicalJson } from './canonical';
import { SAVE_FORMAT_VERSION, createEnvelope, newSaveId, type SaveEnvelope, type SavedSeat } from './envelope';
import { loadSave } from './migrations';
import { autosaveOffline, offlineEnvelope, restoreOffline } from './offline';
import { Autosaver, MAX_SAVES, SaveLimitError, SaveStore } from './SaveStore';
import { hashToken, sha256 } from './sha256';
import { LocalSession } from '../session/LocalSession';

const seatsFor = (n: number): SavedSeat[] =>
  Array.from({ length: n }, (_, i) => (i === 0 ? { name: 'Asha', kind: 'human' } : { name: `Bot ${i + 1}`, kind: 'bot', bot: { difficulty: 'heuristic' } }));

/** Plays `actions` actions of a bot game and returns the state plus the actions taken. */
async function partialGame(players: number, actions: number, seed = 7) {
  const bots = Array.from({ length: players }, () => new HeuristicBot());
  const run = await runGame(makeConfig(players), seed, bots, { maxActions: actions });
  return run;
}

function envelopeFor(state: GameState, version = 10): SaveEnvelope {
  return createEnvelope({ id: newSaveId(), savedAt: 1_700_000_000_000, mode: 'offline', game: { state, version }, seats: seatsFor(state.config.playerCount) });
}

describe('sha256', () => {
  it('matches Web Crypto, including block-boundary lengths and unicode', async () => {
    for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'Lorris ♠♥♦♣ 🃏']) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const expected = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      expect(sha256(text)).toBe(expected);
    }
  });

  it('hashes tokens with a fixed prefix, never returning the token', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).not.toBe(sha256('abc'));
  });
});

describe('canonical JSON', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe('save round trips', () => {
  for (const players of [4, 6]) {
    it(`${players} players, mid-round: save then load gives the identical state`, async () => {
      const store = new SaveStore(new MemoryStore());
      let run = await partialGame(players, 40);
      // Make sure we stopped in the middle of a round (some cards on the table).
      for (let k = 41; run.state.trick.plays.length === 0 || run.state.phase !== 'playing'; k++) run = await partialGame(players, k);
      const env = envelopeFor(run.state);
      await store.save(env, 'offline');
      const loaded = await store.load(env.id);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.save.game.state).toEqual(run.state);
      expect(loaded.save.game.state.rng).toBe(run.state.rng);
      expect(loaded.save.label.text).toMatch(/Asha \+ \d bots/);
    });

    it(`${players} players, between Sets, with a first loss recorded: round trip is exact`, async () => {
      let n = 30;
      let run = await partialGame(players, n);
      while (run.state.phase !== 'setOver' || !run.state.hasFailedBefore.some(Boolean)) {
        run = await partialGame(players, ++n, 3);
        if (n > 4000) throw new Error('no failed call found');
      }
      const env = envelopeFor(run.state);
      // Through a file and back, as an export/import would.
      const loaded = loadSave(JSON.stringify(env));
      expect(loaded.ok && loaded.save.game.state).toEqual(run.state);
      expect(loaded.ok && loaded.save.game.state.hasFailedBefore).toEqual(run.state.hasFailedBefore);
    });
  }
});

describe('determinism', () => {
  it('saving and resuming partway, then playing the same actions, ends in exactly the same state', async () => {
    const full = await partialGame(4, 100_000, 11);
    expect(full.finished).toBe(true);
    const cut = Math.floor(full.actions.length / 2);

    // Play the first half, save, load, then play the second half from the loaded state.
    let s = createGame(makeConfig(4), 11);
    const apply = (state: GameState, { seat, action }: { seat: Seat; action: Action }) => {
      const r = applyAction(state, seat, action);
      if (!r.ok) throw new Error(r.error.message);
      return r.state;
    };
    for (const a of full.actions.slice(0, cut)) s = apply(s, a);
    const store = new SaveStore(new MemoryStore());
    const env = envelopeFor(s, cut);
    await store.save(env, 'offline');
    const loaded = await store.load(env.id);
    if (!loaded.ok) throw new Error(loaded.error.message);
    let resumed = loaded.save.game.state;
    for (const a of full.actions.slice(cut)) resumed = apply(resumed, a);
    expect(resumed).toEqual(full.state);
  });
});

/** A store whose next batch fails like a crash: either nothing lands, or the slot lands damaged. */
class CrashingStore extends MemoryStore {
  mode: 'none' | 'abort' | 'torn' = 'none';
  async batch(ops: BatchOp[]): Promise<void> {
    if (this.mode === 'abort') {
      this.mode = 'none';
      throw new Error('app killed mid-transaction'); // IndexedDB rolls the whole batch back
    }
    if (this.mode === 'torn') {
      this.mode = 'none';
      const torn = ops.map((op) => (op.key.startsWith('save:') ? { key: op.key, value: { seq: 99, envelope: '{"format":"lorris-save","formatVer' } } : op));
      return super.batch(torn);
    }
    return super.batch(ops);
  }
}

describe('crash safety', () => {
  it('a crash during a write leaves the previous save loadable', async () => {
    const kv = new CrashingStore();
    const store = new SaveStore(kv);
    const first = await partialGame(4, 20);
    const later = await partialGame(4, 60);
    const env1 = envelopeFor(first.state);
    await store.save(env1, 'offline');

    kv.mode = 'abort';
    await expect(store.save({ ...envelopeFor(later.state), id: env1.id }, 'offline')).rejects.toThrow();
    let loaded = await store.load(env1.id);
    expect(loaded.ok && loaded.save.game.state).toEqual(first.state);

    // Even if the write "landed" but is damaged, the other slot still holds the previous save.
    kv.mode = 'torn';
    await store.save(createEnvelope({ ...envelopeFor(later.state), id: env1.id }), 'offline');
    loaded = await store.load(env1.id);
    expect(loaded.ok && loaded.save.game.state).toEqual(first.state);

    // And the next good write wins again.
    const env3 = createEnvelope({ ...envelopeFor(later.state), id: env1.id });
    await store.save(env3, 'offline');
    loaded = await store.load(env1.id);
    expect(loaded.ok && loaded.save.game.state).toEqual(later.state);
  });

  it('the autosaver coalesces rapid saves and ends with the latest', async () => {
    const store = new SaveStore(new MemoryStore());
    const autosaver = new Autosaver(store, 'offline');
    const id = newSaveId();
    const runs = await Promise.all([10, 20, 30, 40].map((n) => partialGame(4, n)));
    for (const r of runs) autosaver.request({ ...createEnvelope({ id, savedAt: Date.now(), mode: 'offline', game: { state: r.state, version: 1 }, seats: seatsFor(4) }) });
    await autosaver.flush();
    const loaded = await store.load(id);
    expect(loaded.ok && loaded.save.game.state).toEqual(runs[3].state);
  });
});

describe('validation and migration', () => {
  it('migrates a hand-made format-0 save (the Phase 2 hosted game record)', async () => {
    const state = (await partialGame(4, 30)).state;
    const legacy = {
      roomCode: 'ABCDEF',
      lobbyVersion: 7,
      lobby: {
        config: state.config,
        started: true,
        seats: [
          { kind: 'human', name: 'Asha', token: 'host-token-aaaaaaaaaaaa' },
          { kind: 'human', name: 'Ben', token: 'ben-token-bbbbbbbbbbbbbb' },
          { kind: 'bot', name: 'Bot 3', token: null },
          { kind: 'bot', name: 'Bot 4', token: null },
        ],
      },
      game: { state, version: 30 },
    };
    const loaded = loadSave(JSON.stringify(legacy));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.migrated).toBe(true);
    expect(loaded.save.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(loaded.save.mode).toBe('online');
    expect(loaded.save.online).toMatchObject({ roomCode: 'ABCDEF', hostName: 'Asha', lobbyVersion: 7 });
    expect(loaded.save.seats[1]).toEqual({ name: 'Ben', kind: 'human', tokenHash: hashToken('ben-token-bbbbbbbbbbbbbb') });
    expect(JSON.stringify(loaded.save)).not.toContain('ben-token'); // tokens are only kept hashed
    expect(loaded.save.game.state).toEqual(state);
    // The migrated save is a valid current-format save in its own right.
    expect(loadSave(JSON.stringify(loaded.save)).ok).toBe(true);
  });

  it('rejects saves from newer versions, and impossibly old ones, with clear messages', async () => {
    const env = envelopeFor((await partialGame(4, 10)).state);
    const newer = { ...env, formatVersion: SAVE_FORMAT_VERSION + 1 };
    expect(loadSave(newer)).toMatchObject({ ok: false, error: { code: 'TOO_NEW', message: expect.stringContaining('Update the app') } });
    const older = { ...env, formatVersion: -1 };
    expect(loadSave(older)).toMatchObject({ ok: false, error: { code: 'TOO_OLD' } });
  });

  it('rejects corrupt and tampered saves with clear messages', async () => {
    const state = (await partialGame(4, 30)).state;
    const env = envelopeFor(state);
    // Truncated file.
    expect(loadSave(JSON.stringify(env).slice(0, 500))).toMatchObject({ ok: false, error: { code: 'CORRUPT' } });
    // Something else entirely.
    expect(loadSave({ hello: 'world' })).toMatchObject({ ok: false, error: { code: 'NOT_A_SAVE' } });
    expect(loadSave('[1,2,3]')).toMatchObject({ ok: false, error: { code: 'NOT_A_SAVE' } });
    // Edited hand: the checksum no longer matches.
    const edited = structuredClone(env);
    edited.game.state.hands[0][0] = edited.game.state.hands[1][0];
    expect(loadSave(edited)).toMatchObject({ ok: false, error: { code: 'CORRUPT', message: "This saved game is damaged and can't be opened." } });
    // Edited hand with a recomputed checksum: the game itself doesn't add up (duplicate card).
    const forged = createEnvelope({ id: env.id, savedAt: env.savedAt, mode: 'offline', game: edited.game, seats: env.seats });
    expect(loadSave(forged)).toMatchObject({ ok: false, error: { code: 'INVALID_GAME' } });
    // Scores that don't match the history.
    const cheat = structuredClone(env);
    cheat.game.state.scores = [31, 0];
    const cheatForged = createEnvelope({ id: env.id, savedAt: env.savedAt, mode: 'offline', game: cheat.game, seats: env.seats });
    expect(loadSave(cheatForged)).toMatchObject({ ok: false, error: { code: 'INVALID_GAME' } });
  });
});

describe('save list', () => {
  it(`holds at most ${MAX_SAVES} games, but existing ones keep saving`, async () => {
    const store = new SaveStore(new MemoryStore());
    const state = createGame(makeConfig(4), 1);
    const ids: string[] = [];
    for (let i = 0; i < MAX_SAVES; i++) {
      const env = envelopeFor(state);
      ids.push(env.id);
      await store.save(env, 'offline');
    }
    expect(await store.canCreate()).toBe(false);
    await expect(store.save(envelopeFor(state), 'offline')).rejects.toBeInstanceOf(SaveLimitError);
    await store.save(createEnvelope({ ...envelopeFor(state), id: ids[0] }), 'offline'); // updating is fine
    await store.delete(ids[1]);
    expect(await store.canCreate()).toBe(true);
    expect((await store.list()).map((e) => e.id)).not.toContain(ids[1]);
  });
});

describe('offline autosave and resume', () => {
  it('autosaves after every move, resumes with everything intact, and removes finished games', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const store = new SaveStore(new MemoryStore());
      const fast = { bid: 1, play: 1, afterRound: 1, nextSet: 1, afterDeal: 1 };
      const bots = [new HeuristicBot(), new HeuristicBot(), new HeuristicBot(), new HeuristicBot()];
      // All bots: the game plays itself.
      const session = new LocalSession({ config: makeConfig(4, { targetScore: 10 }), seed: 5 }, bots, ['A', 'B', 'C', 'D'], fast);
      const id = newSaveId();
      const { autosaver, stop } = autosaveOffline(store, id, session);
      await vi.advanceTimersByTimeAsync(40); // a few moves in, far from the end
      await autosaver.flush();
      expect(session.snapshot().version).toBeGreaterThan(3);
      expect(session.snapshot().state.phase).not.toBe('gameOver');
      const mid = await store.load(id);
      expect(mid.ok && mid.save.game.state).toEqual(session.snapshot().state);
      // "The app closes": resume from the save in a fresh session; it carries on to the end.
      session.close();
      stop();
      if (!mid.ok) return;
      const resumed = restoreOffline(mid.save, fast);
      expect(resumed.snapshot()).toEqual(mid.save.game);
      const again = autosaveOffline(store, id, resumed);
      for (let i = 0; i < 2000 && resumed.snapshot().state.phase !== 'gameOver'; i++) await vi.advanceTimersByTimeAsync(50);
      expect(resumed.snapshot().state.phase).toBe('gameOver');
      await again.autosaver.flush();
      await vi.advanceTimersByTimeAsync(10);
      expect(await store.list()).toEqual([]); // finished games leave the saved list
      expect(offlineEnvelope(id, resumed).seats.every((s) => s.kind === 'bot')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
