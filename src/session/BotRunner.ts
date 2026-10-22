import type { Bot } from '../ai';
import type { GameEvent, PlayerView, Seat } from '../core';
import type { GameHost } from './GameHost';

/** How long bots wait before acting, so humans can follow along. */
export interface BotPacing {
  bid: number;
  play: number;
  /** Extra pause after a round completes, so everyone can see who won it. */
  afterRound: number;
  /** Pause before a bot deals the next set, so humans can read the set result. */
  nextSet: number;
  /** Pause after cards are dealt (covers the UI's deal animation) before the first call. */
  afterDeal: number;
}

export const DEFAULT_PACING: BotPacing = { bid: 700, play: 650, afterRound: 1100, nextSet: 4500, afterDeal: 1800 };

/**
 * Plays bot turns on a GameHost. Which seats are bots can change at any time (an online
 * player drops out and a bot takes over, then they come back); call `schedule()` after such
 * a change. Bots only ever see their own player view.
 */
export class BotRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private paused = false;
  private unsubscribe: () => void;

  constructor(
    private host: GameHost,
    private botFor: (seat: Seat) => Bot | null,
    private pacing: BotPacing = DEFAULT_PACING,
  ) {
    this.unsubscribe = host.onChange(() => this.schedule());
  }

  /** Stop all bot play (a pending or in-progress move is dropped), or start again. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.schedule();
  }

  /** If a bot is on turn, let it act after a short, human-friendly delay. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const seat = this.host.turn;
    if (this.closed || this.paused || seat === null || !this.botFor(seat)) return;

    const view = this.host.view(seat);
    const version = this.host.version;
    this.timer = setTimeout(async () => {
      this.timer = null;
      const bot = this.botFor(seat);
      if (this.closed || this.paused || !bot) return;
      const action = await bot.chooseAction(view, this.host.legalActions(seat));
      // Act only if nothing changed while the bot was thinking (its human came back, or a pause).
      if (!this.closed && !this.paused && this.host.version === version && this.botFor(seat) === bot) this.host.submit(seat, action);
    }, this.delayFor(view));
  }

  close(): void {
    this.closed = true;
    this.unsubscribe();
    if (this.timer) clearTimeout(this.timer);
  }

  private delayFor(view: PlayerView): number {
    const last: GameEvent | undefined = view.log.at(-1);
    if (view.phase === 'setOver') return this.pacing.nextSet;
    if (view.phase === 'bidding' || view.phase === 'choosingTrump') {
      return last?.type === 'SET_STARTED' ? this.pacing.afterDeal : this.pacing.bid;
    }
    return last?.type === 'TRICK_WON' ? this.pacing.afterRound : this.pacing.play;
  }
}
