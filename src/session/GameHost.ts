import {
  applyAction,
  createGame,
  getLegalActions,
  getPlayerView,
  type Action,
  type GameConfig,
  type GameState,
  type PlayerView,
  type RuleError,
  type Seat,
} from '../core';

type Listener = (view: PlayerView) => void;

/**
 * Owns the authoritative game state and hands out per-seat views. It doesn't know
 * whether a seat is a local human, a bot, or a remote peer; that's the session's job.
 */
export class GameHost {
  private state: GameState;
  /** Increases on every accepted action. Sent to clients so they can spot stale views. */
  private stateVersion: number;
  private listeners = new Map<Seat, Set<Listener>>();
  private changeListeners = new Set<() => void>();

  constructor(config: GameConfig, seed: number);
  constructor(snapshot: { state: GameState; version: number });
  constructor(a: GameConfig | { state: GameState; version: number }, seed?: number) {
    if ('state' in a) {
      this.state = a.state;
      this.stateVersion = a.version;
    } else {
      this.state = createGame(a, seed!);
      this.stateVersion = 1;
    }
  }

  get config(): GameConfig {
    return this.state.config;
  }

  get version(): number {
    return this.stateVersion;
  }

  /** Public information only (no hands, no RNG). Used for scheduling bots. */
  get turn(): Seat | null {
    return this.state.turn;
  }

  get phase(): GameState['phase'] {
    return this.state.phase;
  }

  /** The full state, for saving the game so the host can resume it. Never send this to anyone. */
  snapshot(): { state: GameState; version: number } {
    return { state: this.state, version: this.stateVersion };
  }

  view(seat: Seat): PlayerView {
    return getPlayerView(this.state, seat);
  }

  legalActions(seat: Seat): Action[] {
    return getLegalActions(this.state, seat);
  }

  submit(seat: Seat, action: Action): RuleError | null {
    const result = applyAction(this.state, seat, action);
    if (!result.ok) return result.error;
    this.state = result.state;
    this.stateVersion++;
    for (const [s, set] of this.listeners) {
      const view = this.view(s);
      for (const l of set) l(view);
    }
    for (const l of this.changeListeners) l();
    return null;
  }

  subscribe(seat: Seat, listener: Listener): () => void {
    let set = this.listeners.get(seat);
    if (!set) this.listeners.set(seat, (set = new Set()));
    set.add(listener);
    listener(this.view(seat));
    return () => set!.delete(listener);
  }

  /** Called after every accepted action. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }
}
