import type { Action, PlayerView, Seat } from '../core';
import type { SeatInfo } from '../net/protocol';

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
  /** Couldn't connect at all. `message` is friendly, jargon-free text. */
  | { kind: 'failed'; message: string; canRetry: boolean }
  /** The host refused us (full, kicked, outdated app...). */
  | { kind: 'rejected'; message: string; needsUpdate: boolean }
  | { kind: 'ended'; message: string };

/** Who sits where, and whether they're here. Same for every player. */
export interface TableInfo {
  seats: SeatInfo[];
  connection: ConnectionState;
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
}

/** Extra controls only the host has. */
export interface HostControls {
  addBot(seat: Seat): void;
  freeSeat(seat: Seat): void;
  kick(seat: Seat): void;
  start(): void;
}
