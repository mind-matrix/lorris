import type { Action, PlayerView } from '../../core';

/** Main thread -> worker. The bot gets exactly what a human gets: its view and legal actions. */
export interface ThinkRequest {
  id: number;
  /** Identifies the bot (one RNG stream per bot). */
  botId: number;
  seed: number;
  view: PlayerView;
  legal: Action[];
}

/** Worker -> main thread. */
export interface ThinkResponse {
  id: number;
  action: Action;
  iterations: number;
  ms: number;
}
