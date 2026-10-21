import type { Action, PlayerView } from '../core';

/**
 * A bot sees exactly what a human in its seat would see: its own player view and the
 * list of legal actions. It must return one of the legal actions.
 *
 * The method is async so heavier bots (e.g. a future ISMCTS bot running in a Web Worker)
 * fit the same interface. An ISMCTS bot would sample hidden hands consistent with the
 * view (its own hand, card counts, played cards, and suits others failed to follow),
 * then simulate with the pure core reducer.
 */
export interface Bot {
  readonly name: string;
  chooseAction(view: PlayerView, legal: Action[]): Promise<Action>;
}
