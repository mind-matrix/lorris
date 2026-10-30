import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOKER, getLegalActions, makeConfig, type Action, type PlayerView } from '../core';
import type { Bot } from '../ai';
import { BotRunner, type BotPacing } from './BotRunner';
import { GameHost } from './GameHost';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const PACING: BotPacing = { bid: 500, play: 500, afterRound: 500, nextSet: 500, afterDeal: 500 };

/** A bot whose thinking takes `thinkMs` of (fake) time, and can be cancelled. */
class TimedBot implements Bot {
  readonly name = 'timed';
  started: number[] = [];
  cancelled = 0;
  views: PlayerView[] = [];
  constructor(private thinkMs: number) {}
  chooseAction(view: PlayerView, legal: Action[]): Promise<Action> {
    this.started.push(Date.now());
    this.views.push(view);
    return new Promise((r) => setTimeout(() => r(legal[0]), this.thinkMs));
  }
  cancel() {
    this.cancelled++;
  }
}

function setup(thinkMs: number) {
  const host = new GameHost(makeConfig(4), 3);
  const bot = new TimedBot(thinkMs);
  let botSeats = new Set([0, 1, 2, 3]);
  const runner = new BotRunner(host, (seat) => (botSeats.has(seat) ? bot : null), PACING);
  return { host, bot, runner, setHumans: (seats: number[]) => (botSeats = new Set([0, 1, 2, 3].filter((s) => !seats.includes(s)))) };
}

describe('BotRunner: thinking during the delay', () => {
  it('starts thinking at once, from the view after the last move, but waits out the minimum delay', async () => {
    const { host, bot, runner } = setup(100);
    const t0 = Date.now();
    runner.schedule();
    expect(bot.started).toEqual([t0]); // thinking started immediately
    expect(bot.views[0]).toEqual(host.view(host.turn!)); // from the final, current view
    await vi.advanceTimersByTimeAsync(499);
    expect(host.version).toBe(1); // done thinking at 100ms, but the move waits for the delay
    await vi.advanceTimersByTimeAsync(1);
    expect(host.version).toBe(2);
    runner.close();
  });

  it('a slow decision is applied when the thinking ends (delay already over)', async () => {
    const { host, runner } = setup(800);
    runner.schedule();
    await vi.advanceTimersByTimeAsync(799);
    expect(host.version).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.version).toBe(2);
    runner.close();
  });

  it('any change while thinking cancels the search and discards its result', async () => {
    const { host, bot, runner, setHumans } = setup(300);
    runner.schedule();
    // A human takes this seat back mid-thought.
    setHumans([host.turn!]);
    runner.schedule();
    expect(bot.cancelled).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(host.version).toBe(1); // the bot's move never landed
    runner.close();
  });

  it('pausing cancels too; resuming starts a fresh search', async () => {
    const { host, bot, runner } = setup(200);
    runner.schedule();
    runner.setPaused(true);
    expect(bot.cancelled).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(host.version).toBe(1);
    runner.setPaused(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(host.version).toBe(2);
    runner.close();
  });

  it('a bot that fails still moves (the first legal action), so the game never stalls', async () => {
    const host = new GameHost(makeConfig(4), 3);
    const broken: Bot = { name: 'broken', chooseAction: () => Promise.reject(new Error('crash')) };
    const runner = new BotRunner(host, () => broken, PACING);
    runner.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(host.version).toBe(2);
    runner.close();
  });

  it("never thinks during a human's turn", async () => {
    const { host, bot, runner, setHumans } = setup(10);
    setHumans([host.turn!]);
    runner.schedule();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bot.started).toEqual([]);
    expect(getLegalActions(host.snapshot().state, host.turn!).length).toBeGreaterThan(0);
    runner.close();
  });
});

describe('BotRunner: Halloween Joker pause', () => {
  const HALLOWEEN = new Date('2026-10-30T12:00:00Z');
  const NOVEMBER = new Date('2026-11-10T12:00:00Z');

  /** Bids and picks trump with the first legal actions, then plays until the Joker has just been played. */
  function hostWithJokerJustPlayed() {
    for (let seed = 1; seed < 500; seed++) {
      const host = new GameHost(makeConfig(4), seed);
      for (let steps = 0; steps < 200 && host.turn !== null; steps++) {
        const seat = host.turn;
        const legal = host.legalActions(seat);
        const joker = legal.find((a) => a.type === 'PLAY_CARD' && a.card === JOKER);
        host.submit(seat, joker ?? legal[0]);
        if (joker) {
          if (host.view(host.turn ?? 0).phase === 'playing') return host;
          break; // the Joker ended the set: try another deal for a plain mid-round case
        }
      }
    }
    throw new Error('no deal with a playable Joker found');
  }

  function runnerAt(host: GameHost, now: Date, pacing: BotPacing) {
    const bot = new TimedBot(0);
    return new BotRunner(host, () => bot, pacing, () => now);
  }

  it('during Halloween week, bots wait for the animation after the Joker', async () => {
    const host = hostWithJokerJustPlayed();
    const v0 = host.version;
    const runner = runnerAt(host, HALLOWEEN, { ...PACING, halloweenJoker: 5900 });
    runner.schedule();
    await vi.advanceTimersByTimeAsync(5899);
    expect(host.version).toBe(v0);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.version).toBe(v0 + 1);
    runner.close();
  });

  it('outside Halloween week, or with no pause configured, the usual delay applies', async () => {
    for (const [now, pacing] of [
      [NOVEMBER, { ...PACING, halloweenJoker: 5900 }],
      [HALLOWEEN, PACING],
    ] as const) {
      const host = hostWithJokerJustPlayed();
      const v0 = host.version;
      const runner = runnerAt(host, now, pacing);
      runner.schedule();
      await vi.advanceTimersByTimeAsync(PACING.play);
      expect(host.version).toBe(v0 + 1);
      runner.close();
    }
  });
});
