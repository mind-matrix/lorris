import type { Action, GameConfig, GameState, PlayerView, Seat } from '../core';
import type { Bot } from '../ai';
import { BotRunner, DEFAULT_PACING, type BotPacing } from './BotRunner';
import { GameHost } from './GameHost';
import type { GameSession, SessionError, TableInfo } from './types';

export { DEFAULT_PACING, type BotPacing };

export type LocalStart = { config: GameConfig; seed: number } | { snapshot: { state: GameState; version: number } };

/**
 * Offline play: an in-process host, bots for some seats, and humans for the rest.
 * The UI only gets player views through `subscribe`, exactly like it would online.
 */
export class LocalSession implements GameSession {
  readonly seats: Seat[];
  private host: GameHost;
  private runner: BotRunner;
  private table: TableInfo;

  constructor(
    start: LocalStart,
    bots: (Bot | null)[],
    readonly names: string[],
    pacing: BotPacing = DEFAULT_PACING,
  ) {
    this.host = 'snapshot' in start ? new GameHost(start.snapshot) : new GameHost(start.config, start.seed);
    if (bots.length !== this.host.config.playerCount) throw new Error('Need one entry (bot or null for human) per seat');
    this.seats = bots.flatMap((b, seat) => (b ? [] : [seat]));
    this.table = {
      seats: bots.map((b, seat) => ({ kind: b ? 'bot' : 'human', name: names[seat], status: 'connected' })),
      connection: { kind: 'local' },
    };
    this.runner = new BotRunner(this.host, (seat) => bots[seat], pacing);
    this.runner.schedule();
  }

  /** Which seats are bots (for saving). */
  get botSeats(): boolean[] {
    return this.table.seats.map((s) => s.kind === 'bot');
  }

  /** The full state, for saving. */
  snapshot(): { state: GameState; version: number } {
    return this.host.snapshot();
  }

  /** Called after every accepted action. */
  onChange(listener: () => void): () => void {
    return this.host.onChange(listener);
  }

  subscribe(seat: Seat, listener: (view: PlayerView) => void): () => void {
    return this.host.subscribe(seat, listener);
  }

  subscribeTable(listener: (table: TableInfo) => void): () => void {
    listener(this.table);
    return () => {};
  }

  async submit(seat: Seat, action: Action): Promise<SessionError | null> {
    if (!this.seats.includes(seat)) return { code: 'INVALID_SEAT', message: 'That seat is not yours' };
    return this.host.submit(seat, action);
  }

  close(): void {
    this.runner.close();
  }
}
