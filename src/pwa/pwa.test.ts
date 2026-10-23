import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeuristicBot } from '../ai';
import { makeConfig } from '../core';
import { newSaveId } from '../save/envelope';
import { autosaveOffline } from '../save/offline';
import { SaveStore } from '../save/SaveStore';
import { LocalSession } from '../session/LocalSession';
import { MemoryStore } from '../session/storage';
import { MIN_CHECK_GAP_MS, UPDATE_CHECK_INTERVAL_MS, UpdateChecker } from './UpdateChecker';
import { saveThenUpdate } from './updateFlow';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

class FakeDocument {
  visibilityState = 'visible';
  private listeners = new Set<() => void>();
  addEventListener(_: 'visibilitychange', l: () => void) {
    this.listeners.add(l);
  }
  removeEventListener(_: 'visibilitychange', l: () => void) {
    this.listeners.delete(l);
  }
  set(state: 'visible' | 'hidden') {
    this.visibilityState = state;
    this.listeners.forEach((l) => l());
  }
}

describe('update checks', () => {
  it('checks on launch, on returning to the foreground, and every 30 minutes', async () => {
    const update = vi.fn(async () => {});
    const doc = new FakeDocument();
    const checker = new UpdateChecker(update, doc);
    checker.start();
    expect(update).toHaveBeenCalledTimes(1); // launch

    await vi.advanceTimersByTimeAsync(MIN_CHECK_GAP_MS + 1);
    doc.set('hidden');
    expect(update).toHaveBeenCalledTimes(1); // going to the background doesn't check
    doc.set('visible');
    expect(update).toHaveBeenCalledTimes(2); // coming back does

    doc.set('hidden');
    doc.set('visible'); // flipping straight back doesn't hammer the network
    expect(update).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(3); // the 30-minute timer
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(4);

    checker.stop();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 3);
    doc.set('visible');
    expect(update).toHaveBeenCalledTimes(4);
  });

  it('a failed check (offline) is harmless, and the manual check always runs', async () => {
    const update = vi.fn(async () => {
      throw new Error('offline');
    });
    const checker = new UpdateChecker(update, new FakeDocument());
    checker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(await checker.check(true)).toBe(false);
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe('saving before an update', () => {
  it('an offline game is fully saved before the page reloads', async () => {
    const store = new SaveStore(new MemoryStore());
    const fast = { bid: 1, play: 1, afterRound: 1, nextSet: 1, afterDeal: 1 };
    const session = new LocalSession({ config: makeConfig(4), seed: 3 }, Array.from({ length: 4 }, () => new HeuristicBot()), ['A', 'B', 'C', 'D'], fast);
    const id = newSaveId();
    const { autosaver } = autosaveOffline(store, id, session);
    await vi.advanceTimersByTimeAsync(30); // some moves, with saves still in flight
    session.close();
    let savedAtApply: unknown = null;
    await saveThenUpdate({ offline: autosaver }, async () => {
      const loaded = await store.load(id);
      savedAtApply = loaded.ok && loaded.save.game;
    });
    expect(savedAtApply).toEqual(session.snapshot());
  });

  it('an online host pauses and saves (telling everyone) before updating', async () => {
    const order: string[] = [];
    const host = {
      pauseGame: () => order.push('pause'),
      saveAndClose: async () => {
        order.push('save');
      },
    };
    await saveThenUpdate({ host }, async () => {
      order.push('update');
    });
    expect(order).toEqual(['pause', 'save', 'update']);
  });
});
