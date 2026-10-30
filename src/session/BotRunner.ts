import type { Bot } from '../ai';
import type { GameEvent, PlayerView, Seat } from '../core';
import type { GameHost } from './GameHost';
import { HALLOWEEN_JOKER_PAUSE_MS, isHalloweenSeason, jokerJustPlayed } from '../seasonal/halloween';

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
  /**
   * Pause after the Joker is played during Halloween season, while every player watches the
   * Joker animation. Omitted or 0: no extra pause.
   */
  halloweenJoker?: number;
}

export const DEFAULT_PACING: BotPacing = {
  bid: 700,
  play: 650,
  afterRound: 1100,
  nextSet: 4500,
  afterDeal: 1800,
  halloweenJoker: HALLOWEEN_JOKER_PAUSE_MS,
};

/** Bots that can abandon a search in progress (e.g. the Web Worker bot). Optional. */
interface Cancellable {
  cancel?: () => void;
}

/**
 * Plays bot turns on a GameHost. Which seats are bots can change at any time (an online
 * player drops out and a bot takes over, then they come back); call `schedule()` after such
 * a change. Bots only ever see their own player view.
 *
 * A bot starts thinking as soon as it's on turn (from the view after the last, animated
 * action), while the minimum visible delay runs. Its move is applied once BOTH are done, and
 * only if nothing changed meanwhile; any change (a move, a human taking the seat back, a
 * pause, a disconnect) cancels the search and its result is thrown away. Bots never think
 * during a human's turn.
 */
export class BotRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private paused = false;
  /** Bumped on every (re)schedule, so a stale decision can tell it's stale. */
  private token = 0;
  private thinking: Cancellable | null = null;
  private unsubscribe: () => void;

  constructor(
    private host: GameHost,
    private botFor: (seat: Seat) => Bot | null,
    private pacing: BotPacing = DEFAULT_PACING,
    /** The current time, for the Halloween check (replaceable in tests). */
    private now: () => Date = () => new Date(),
  ) {
    this.unsubscribe = host.onChange(() => this.schedule());
  }

  /** Stop all bot play (a pending or in-progress move is dropped), or start again. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.schedule();
  }

  /** If a bot is on turn, let it think now and act after a short, human-friendly delay. */
  schedule(): void {
    this.cancelPending();
    const seat = this.host.turn;
    const bot = seat === null ? null : this.botFor(seat);
    if (this.closed || this.paused || seat === null || !bot) return;

    const token = this.token;
    const view = this.host.view(seat);
    const version = this.host.version;
    const delay = new Promise<void>((resolve) => (this.timer = setTimeout(resolve, this.delayFor(view))));
    this.thinking = bot as Cancellable;
    const decision = bot.chooseAction(view, this.host.legalActions(seat));
    Promise.all([decision, delay]).then(
      ([action]) => {
        if (token !== this.token) return; // superseded: discard
        this.thinking = null;
        // Apply only if nothing changed while the bot was thinking (its human came back, a pause...).
        if (!this.closed && !this.paused && this.host.version === version && this.botFor(seat) === bot) this.host.submit(seat, action);
      },
      async () => {
        // Cancelled (superseded): nothing to do. A real failure must not stall the game: once the
        // minimum delay has passed, play the first legal move instead.
        if (token !== this.token) return;
        await delay;
        if (token !== this.token) return;
        this.thinking = null;
        if (!this.closed && !this.paused && this.host.version === version && this.botFor(seat) === bot) {
          this.host.submit(seat, this.host.legalActions(seat)[0]);
        }
      },
    );
  }

  close(): void {
    this.closed = true;
    this.unsubscribe();
    this.cancelPending();
  }

  private cancelPending(): void {
    this.token++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.thinking?.cancel?.();
    this.thinking = null;
  }

  private delayFor(view: PlayerView): number {
    const base = this.baseDelay(view);
    // Halloween season: hold off while everyone watches the Joker animation.
    const joker = this.pacing.halloweenJoker ?? 0;
    if (joker > 0 && jokerJustPlayed(view.log) && isHalloweenSeason(this.now())) return Math.max(base, joker);
    return base;
  }

  private baseDelay(view: PlayerView): number {
    const last: GameEvent | undefined = view.log.at(-1);
    if (view.phase === 'setOver') return this.pacing.nextSet;
    if (view.phase === 'bidding' || view.phase === 'choosingTrump') {
      return last?.type === 'SET_STARTED' ? this.pacing.afterDeal : this.pacing.bid;
    }
    return last?.type === 'TRICK_WON' ? this.pacing.afterRound : this.pacing.play;
  }
}
