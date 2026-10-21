import type { Action, GameConfig, GameEvent, PlayerView, RuleError, Seat } from '../core';
import type { Bot } from '../ai';
import type { GameSession } from '../net/protocol';
import { GameHost } from './GameHost';

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
 * Offline play: an in-process host, bots for some seats, and humans for the rest.
 * The UI only gets player views through `subscribe`, exactly like it would online.
 */
export class LocalSession implements GameSession {
  readonly seats: Seat[];
  private host: GameHost;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    config: GameConfig,
    seed: number,
    private bots: (Bot | null)[],
    private pacing: BotPacing = DEFAULT_PACING,
  ) {
    if (bots.length !== config.playerCount) throw new Error('Need one entry (bot or null for human) per seat');
    this.host = new GameHost(config, seed);
    this.seats = bots.flatMap((b, seat) => (b ? [] : [seat]));
    this.host.onChange(() => this.scheduleBot());
    this.scheduleBot();
  }

  subscribe(seat: Seat, listener: (view: PlayerView) => void): () => void {
    return this.host.subscribe(seat, listener);
  }

  async submit(seat: Seat, action: Action): Promise<RuleError | null> {
    if (!this.seats.includes(seat)) return { code: 'INVALID_SEAT', message: 'That seat is not yours' };
    return this.host.submit(seat, action);
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** If a bot is on turn, let it act after a short, human-friendly delay. */
  private scheduleBot(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const seat = this.host.turn;
    if (this.closed || seat === null) return;
    const bot = this.bots[seat];
    if (!bot) return;

    const view = this.host.view(seat);
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (this.closed) return;
      const legal = this.host.legalActions(seat);
      const action = await bot.chooseAction(view, legal);
      // Only the seat on turn can act, so nothing else can have changed while this bot waited.
      if (!this.closed && this.host.turn === seat) this.host.submit(seat, action);
    }, this.delayFor(view));
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
