import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLegalActions, getPlayerView, createGame, makeConfig, type Action } from '../../core';
import { SEARCH_BUDGET } from '../ismcts/config';

type Mode = 'answer' | 'error' | 'silent';
let mode: Mode = 'answer';
let created = 0;

/** A stand-in Web Worker: answers with the first legal action, errors, or never answers. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor() {
    created++;
  }
  postMessage(msg: { id: number; legal: Action[] }) {
    setTimeout(() => {
      if (this.terminated) return;
      if (mode === 'answer') this.onmessage?.({ data: { id: msg.id, action: msg.legal[0], iterations: 10, ms: 1 } } as MessageEvent);
      if (mode === 'error') this.onerror?.({ message: 'boom' } as ErrorEvent);
    }, 5);
  }
  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
  vi.resetModules(); // a fresh worker pool per test
  created = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function decision() {
  const s = createGame(makeConfig(4), 5);
  const seat = s.turn!;
  return { view: getPlayerView(s, seat), legal: getLegalActions(s, seat) };
}

describe('WorkerBot never stalls a game', () => {
  it('uses the worker when it answers', async () => {
    mode = 'answer';
    const { WorkerBot } = await import('./WorkerBot');
    const { view, legal } = decision();
    const p = new WorkerBot(1).chooseAction(view, legal);
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toEqual(legal[0]);
    expect(created).toBe(1);
  });

  it('falls back to the main thread when the worker crashes, and stops using it', async () => {
    mode = 'error';
    const { WorkerBot, workerPool } = await import('./WorkerBot');
    const { view, legal } = decision();
    const bot = new WorkerBot(1);
    const p = bot.chooseAction(view, legal);
    await vi.advanceTimersByTimeAsync(10);
    expect(legal).toContainEqual(await p);
    expect(workerPool.broken).toBe(true);
    // Next decisions go straight to the main thread: no new worker, no waiting.
    expect(legal).toContainEqual(await bot.chooseAction(view, legal));
    expect(created).toBe(1);
  });

  it('falls back when the worker never answers', async () => {
    mode = 'silent';
    const { WorkerBot, WORKER_GRACE_MS } = await import('./WorkerBot');
    const { view, legal } = decision();
    const p = new WorkerBot(1).chooseAction(view, legal);
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(SEARCH_BUDGET.timeMs + WORKER_GRACE_MS - 10);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(legal).toContainEqual(await p);
  });

  it('falls back when Workers are not supported at all', async () => {
    vi.stubGlobal('Worker', undefined);
    const { WorkerBot } = await import('./WorkerBot');
    const { view, legal } = decision();
    expect(legal).toContainEqual(await new WorkerBot(1).chooseAction(view, legal));
  });

  it('a cancelled decision is dropped, not replaced by a fallback move', async () => {
    mode = 'silent';
    const { WorkerBot } = await import('./WorkerBot');
    const { view, legal } = decision();
    const bot = new WorkerBot(1);
    const p = bot.chooseAction(view, legal);
    bot.cancel();
    await expect(p).rejects.toThrow('cancelled');
  });
});
