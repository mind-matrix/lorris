// Dev-only benchmark (not part of the app): measures the real Web Worker bot in the browser.
// Run from the dev server, e.g. under Chrome's CPU throttling to mimic a low-end phone.

import { applyAction, createGame, getLegalActions, getPlayerView, makeConfig } from '../../core';
import { HeuristicBot } from '../heuristicBot';
import { WorkerBot, workerPool } from './WorkerBot';

export interface BenchResult {
  players: number;
  decisions: number;
  msPerMove: { mean: number; p95: number; max: number };
  iterationsPerMove: { mean: number; min: number };
  iterationsPerSecond: number;
  /** Total bot thinking time for one whole Set (seat 0 played by a quick stand-in "human"). */
  setThinkSeconds: number;
  /** Longest gap the main thread was blocked during the run (should stay near 0). */
  mainThreadMaxBlockMs: number;
}

export async function benchmark(players: number, sets = 2): Promise<BenchResult> {
  const human = new HeuristicBot();
  const bots = Array.from({ length: players }, (_, i) => new WorkerBot(1000 + i));
  const ms: number[] = [];
  const its: number[] = [];
  let think = 0;
  // Watch the main thread: a timer that should fire every 16 ms.
  let maxBlock = 0;
  let last = performance.now();
  const watch = setInterval(() => {
    const now = performance.now();
    maxBlock = Math.max(maxBlock, now - last - 16);
    last = now;
  }, 16);

  for (let set = 0; set < sets; set++) {
    let s = createGame(makeConfig(players), 77 + set);
    const startSet = s.setNumber;
    while (s.phase !== 'setOver' && s.phase !== 'gameOver' && s.setNumber === startSet) {
      const seat = s.turn!;
      const legal = getLegalActions(s, seat);
      let action = legal[0];
      if (legal.length > 1) {
        if (seat === 0) action = await human.chooseAction(getPlayerView(s, seat), legal);
        else {
          const t0 = performance.now();
          action = await bots[seat].chooseAction(getPlayerView(s, seat), legal);
          const dt = performance.now() - t0;
          ms.push(dt);
          its.push(workerPool.lastStats?.iterations ?? 0);
          think += dt;
        }
      }
      const r = applyAction(s, seat, action);
      if (!r.ok) throw new Error(r.error.message);
      s = r.state;
    }
  }
  clearInterval(watch);
  const sorted = [...ms].sort((a, b) => a - b);
  const totalIt = its.reduce((a, b) => a + b, 0);
  return {
    players,
    decisions: ms.length,
    msPerMove: { mean: think / ms.length, p95: sorted[Math.floor(0.95 * (sorted.length - 1))], max: sorted.at(-1)! },
    iterationsPerMove: { mean: totalIt / its.length, min: Math.min(...its) },
    iterationsPerSecond: (totalIt / think) * 1000,
    setThinkSeconds: think / 1000 / sets,
    mainThreadMaxBlockMs: Math.max(0, maxBlock),
  };
}
