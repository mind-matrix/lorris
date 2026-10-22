// Wire protocol between the host and clients. See PROTOCOL.md for the full description.

import type { Action, GameConfig, PlayerView, Seat } from '../core';

/** Bump whenever a message changes shape. HELLO and REJECTED must never change. */
export const PROTOCOL_VERSION = 1;

/** Fields every message carries. `seq` increases per sender. */
export interface Envelope {
  v: number;
  seq: number;
}

/** Public, per-seat lobby/table information. Never contains seat tokens. */
export interface SeatInfo {
  kind: 'empty' | 'human' | 'bot';
  name: string;
  /** Only meaningful for human seats. */
  status: 'connected' | 'reconnecting' | 'bot-controlled';
}

export type RejectReason =
  | 'VERSION_MISMATCH'
  | 'ROOM_FULL'
  | 'GAME_IN_PROGRESS'
  | 'KICKED'
  | 'RATE_LIMITED';

// ---------- Client -> host ----------

export type ClientMessageBody =
  /** Join, or rejoin with a seat token. Shape frozen across versions. */
  | { type: 'HELLO'; name: string; token: string | null }
  | { type: 'ACTION'; requestId: number; action: Action }
  /** Ask for a fresh copy of my view (after a gap in state versions). */
  | { type: 'RESYNC' }
  | { type: 'PING'; t: number }
  /** Leaving on purpose. */
  | { type: 'LEAVE' };

// ---------- Host -> client ----------

export type HostStatus = 'paused' | 'ended';

export type HostMessageBody =
  | { type: 'WELCOME'; seat: Seat; token: string; roomCode: string; config: GameConfig }
  /** Shape frozen across versions so old clients can always show "please update". */
  | { type: 'REJECTED'; reason: RejectReason; hostVersion: number }
  /** Who sits where and whether they're connected. Sent whenever that changes, in the lobby and in game. */
  | { type: 'LOBBY'; lobbyVersion: number; seats: SeatInfo[]; started: boolean }
  /** This client's view of the game; nothing about other players' hidden cards. */
  | { type: 'VIEW'; stateVersion: number; view: PlayerView }
  | { type: 'ACTION_RESULT'; requestId: number; error: { code: string; message: string } | null }
  /** Carries the latest versions so a client can tell it missed something and ask to RESYNC. */
  | { type: 'PONG'; t: number; stateVersion: number; lobbyVersion: number }
  | { type: 'HOST_STATUS'; status: HostStatus; message: string };

export type ClientMessage = Envelope & ClientMessageBody;
export type HostMessage = Envelope & HostMessageBody;
export type ClientMessageType = ClientMessage['type'];
export type HostMessageType = HostMessage['type'];

/** Adds the envelope to outgoing messages. */
export class Outbox {
  private seq = 0;
  wrap<B extends object>(body: B): Envelope & B {
    return { v: PROTOCOL_VERSION, seq: ++this.seq, ...body };
  }
}
