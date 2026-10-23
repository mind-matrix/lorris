// The in-game bot in the browser: same Bot interface, but the search runs in a Web Worker.

import type { Action, PlayerView } from '../../core';
import type { Bot } from '../bot';
import { SEARCH_BUDGET } from '../ismcts/config';
import { IsmctsBot } from '../ismcts/IsmctsBot';
import type { ThinkRequest, ThinkResponse } from './protocol';

/**
 * If the worker can't start, crashes, or doesn't answer within the search budget plus this
 * grace period, the bot thinks on the main thread instead, so a game can never stall.
 */
export const WORKER_GRACE_MS = 3_000;
/** The main-thread fallback thinks briefly, so the UI stays responsive. */
export const FALLBACK_BUDGET = { timeMs: 150, maxIterations: 300, deterministic: false };

class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

interface Pending {
  resolve: (r: ThinkResponse) => void;
  reject: (e: Error) => void;
}

/** One worker for all bots: only one bot is ever on turn, so searches run one at a time. */
class WorkerPool {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** Set after the worker failed once: for the rest of this session, bots think on the main thread. */
  broken = typeof Worker === 'undefined';
  /** Last decision's stats (benchmarks and the About screen can read these). */
  lastStats: { iterations: number; ms: number } | null = null;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./ismcts.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<ThinkResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      this.lastStats = { iterations: e.data.iterations, ms: e.data.ms };
      p.resolve(e.data);
    };
    w.onerror = (e) => {
      this.broken = true;
      this.failAll(new Error(e.message || 'Bot worker failed'));
    };
    this.worker = w;
    return w;
  }

  think(req: Omit<ThinkRequest, 'id'>): { id: number; done: Promise<ThinkResponse> } {
    const id = this.nextId++;
    const done = new Promise<ThinkResponse>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    let worker: Worker;
    try {
      worker = this.ensure();
    } catch (e) {
      this.broken = true; // e.g. module workers unsupported or blocked: use the main thread from now on
      this.pending.delete(id);
      throw e;
    }
    worker.postMessage({ ...req, id } satisfies ThinkRequest);
    return { id, done };
  }

  /** Really stop a search that's no longer wanted: end the worker (a new one starts on demand). */
  cancel(id: number): void {
    if (!this.pending.has(id)) return;
    this.failAll(new CancelledError());
  }

  /** The worker didn't answer in time: give up on it for this session. */
  abandon(): void {
    this.broken = true;
    this.failAll(new Error('Bot worker timed out'));
  }

  private failAll(e: Error): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }
}

export const workerPool = new WorkerPool();
let nextBotId = 1;

export class WorkerBot implements Bot {
  readonly name = 'ISMCTS';
  private botId = nextBotId++;
  private current: number | null = null;
  private fallback: IsmctsBot | null = null;

  constructor(private seed: number) {}

  async chooseAction(view: PlayerView, legal: Action[]): Promise<Action> {
    if (legal.length === 1) return legal[0];
    if (workerPool.broken) return this.onMainThread(view, legal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Plain data only crosses to the worker: the view and the legal actions, nothing else.
      const { id, done } = workerPool.think({ botId: this.botId, seed: this.seed, view: structuredClone(view), legal });
      this.current = id;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          workerPool.abandon();
          reject(new Error('timeout'));
        }, SEARCH_BUDGET.timeMs + WORKER_GRACE_MS);
      });
      return (await Promise.race([done, timeout])).action;
    } catch (e) {
      // A cancelled decision is meant to be dropped; anything else must still produce a move.
      if (e instanceof CancelledError) throw e;
      return this.onMainThread(view, legal);
    } finally {
      clearTimeout(timer);
      this.current = null;
    }
  }

  private onMainThread(view: PlayerView, legal: Action[]): Action {
    this.fallback ??= new IsmctsBot(this.seed, { budget: FALLBACK_BUDGET });
    return this.fallback.decide(view, legal).action;
  }

  /** Not part of the Bot interface: BotRunner calls it (if present) when a decision goes stale. */
  cancel(): void {
    if (this.current !== null) workerPool.cancel(this.current);
  }
}
