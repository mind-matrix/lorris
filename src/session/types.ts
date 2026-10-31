import type { Action, PlayerView, Seat } from '../core';
import type { JoinPolicy, PauseState, SeatInfo, TableEvent, TableSummary } from '../net/protocol';
import type { LinkStats } from '../net/transport';
import type { ReceivedClip, VoiceClip } from '../net/voiceMessages';

/** Connection state of this device, shown in the UI. Local games are always 'local'. */
export type ConnectionState =
  | { kind: 'local' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  /** We lost contact (our network or the host's) and are trying to get it back. */
  | { kind: 'reconnecting' }
  /** The host is gone; waiting for them to come back until `deadline` (ms since epoch). */
  | { kind: 'waiting-for-host'; deadline: number }
  /** The wait ran out; the player can keep waiting or leave. */
  | { kind: 'host-timeout' }
  /** Rejoining a saved game: the host hasn't reopened it yet. We keep trying until they do. */
  | { kind: 'waiting-to-resume'; hostName: string }
  /** Couldn't connect at all. `message` is friendly, jargon-free text. */
  | { kind: 'failed'; message: string; canRetry: boolean }
  /** The host refused us (full, kicked, outdated app...). */
  | { kind: 'rejected'; message: string; needsUpdate: boolean }
  | { kind: 'ended'; message: string };

/** Who sits where, and whether they're here. Same for every player. */
export interface TableInfo {
  seats: SeatInfo[];
  connection: ConnectionState;
  /** Online games: whether play is paused (or the host is reopening a saved game). */
  pause?: PauseState;
}

export interface SessionError {
  code: string;
  message: string;
}

/** What the game screen talks to. Implemented by LocalSession, HostSession and ClientSession. */
export interface GameSession {
  /** Seats this device controls (more than one for pass-and-play). */
  readonly seats: Seat[];
  /** Receive the latest view for a seat. Called immediately if a view exists. Returns an unsubscribe function. */
  subscribe(seat: Seat, listener: (view: PlayerView) => void): () => void;
  /** Receive table info (names, seat statuses, connection). Called immediately. */
  subscribeTable(listener: (table: TableInfo) => void): () => void;
  /** Apply an action for a seat. Resolves to null on success, or an error to show. */
  submit(seat: Seat, action: Action): Promise<SessionError | null>;
  /** Stop timers and release resources. */
  close(): void;
}

/** Lobby screen data, the same shape for host and clients. */
export interface LobbySnapshot {
  roomCode: string;
  seats: SeatInfo[];
  started: boolean;
  /** This device's seat, or null until the host has seated us. */
  mySeat: Seat | null;
  isHost: boolean;
  connection: ConnectionState;
  policy: JoinPolicy;
  /** Public summary of a game in progress (scores, set, call); null before the start. */
  table: TableSummary | null;
  /** A short message for a newcomer choosing a seat (seat taken, seat expired...). */
  notice: string | null;
  pause: PauseState;
}

/** A game played over the network, as host or client. */
export interface OnlineSession extends GameSession {
  readonly isHost: boolean;
  readonly roomCode: string;
  subscribeLobby(listener: (lobby: LobbySnapshot) => void): () => void;
  /** Call when the page becomes visible again (phones pause background tabs). */
  resume(): void;
  /** Client: leave the room. Host: end the game for everyone. */
  leave(): void;
  /** Client only: start over after a failed connection. */
  retry?(): void;
  /** Client only: wait another full period for a missing host. */
  keepWaiting?(): void;
  /** Client only: take a seat in a game in progress (null = any open seat). */
  takeSeat?(seat: Seat | null): void;
  /** Client only: ask the host to pause. */
  requestPause?(): void;
  /** Table-wide happenings, like someone taking over a bot seat. */
  subscribeEvents(listener: (event: TableEvent) => void): () => void;
  /** Voice messages, or null when the connection can't carry them. */
  voiceMessages(): VoiceMessaging | null;
}

/** Voice messages for one player: sending clips to the table, hearing everyone else's. */
export interface VoiceMessaging {
  /** Sends a clip to everyone else at the table. False if refused (too long, too often...). */
  send(clip: VoiceClip): boolean;
  /** Clips from everyone else at the table. */
  subscribe(listener: (clip: ReceivedClip) => void): () => void;
  /** This device's connection to the table, read locally (sends nothing). */
  linkStats(): Promise<LinkStats | null>;
}

/** Extra controls only the host has. */
export interface HostControls {
  addBot(seat: Seat): void;
  freeSeat(seat: Seat): void;
  kick(seat: Seat): void;
  start(): void;
  setPolicy(policy: Partial<JoinPolicy>): void;
  /** Gives up a disconnected player's reservation now: their seat becomes an open bot seat. */
  releaseSeat(seat: Seat): void;
  pauseGame(by?: Seat): void;
  unpauseGame(): void;
  declinePause(seat: Seat): void;
  /** After reopening a saved game: carry on, with bots in any seats whose players haven't returned. */
  continueResumed(): void;
  saveAndClose(): Promise<void>;
}
