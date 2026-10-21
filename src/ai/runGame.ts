import { applyAction, createGame, getLegalActions, getPlayerView, type Action, type GameConfig, type GameState, type Seat } from '../core';
import type { Bot } from './bot';

export interface RunResult {
  state: GameState;
  actions: { seat: Seat; action: Action }[];
  finished: boolean;
}

/**
 * Plays a whole game headlessly: each step, the seat on turn gets its player view and
 * legal actions, picks one, and the host applies it. Stops at game over or `maxActions`.
 * `onState` is called after every accepted action (handy for invariant checks).
 */
export async function runGame(
  config: GameConfig,
  seed: number,
  bots: Bot[],
  opts: { maxActions?: number; onState?: (s: GameState) => void } = {},
): Promise<RunResult> {
  const maxActions = opts.maxActions ?? 100_000;
  let state = createGame(config, seed);
  const actions: RunResult['actions'] = [];

  while (state.phase !== 'gameOver' && actions.length < maxActions) {
    const seat = state.turn!;
    const legal = getLegalActions(state, seat);
    const action = await bots[seat].chooseAction(getPlayerView(state, seat), legal);
    const result = applyAction(state, seat, action);
    if (!result.ok) throw new Error(`${bots[seat].name} bot chose an illegal action: ${result.error.message}`);
    state = result.state;
    actions.push({ seat, action });
    opts.onState?.(state);
  }
  return { state, actions, finished: state.phase === 'gameOver' };
}
