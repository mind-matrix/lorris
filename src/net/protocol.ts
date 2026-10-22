// Wire protocol between the host and clients. See PROTOCOL.md for the full description.

import type { Action, GameConfig, Phase, PlayerView, Seat, Suit } from '../core';

/** Bump whenever a message changes shape. HELLO and REJECTED must never change. */
export const PROTOCOL_VERSION = 3;

/** Fields every message carries. `seq` increases per sender. */
export interface Envelope {
  v: number;
  seq: number;
}

/**
 * Public, per-seat lobby/table information. Never contains seat tokens.
 * - empty:    nobody (lobby only). Open to newcomers.
 * - bot:      a bot from the start, or a seat a human left for good. Open to newcomers mid-game.
 * - reserved: a disconnected human's seat (they hold its token). Closed until the reservation runs out.
 * - human:    a connected human. Never open.
 */
export interface SeatInfo {
  kind: 'empty' | 'bot' | 'reserved' | 'human';
  name: string;
  /** For reserved seats: 'reconnecting', or 'bot-controlled' once a bot covers their turns. */
  status: 'connected' | 'reconnecting' | 'bot-controlled';
  /** Reserved seats: ms until the seat opens up (relative, so clocks needn't agree). */
  reservedMs?: number;
  /** Not on the wire: local time the reservation ends, filled in by the receiver for countdowns. */
  reservedUntil?: number;
}

/** The host's rules for newcomers. */
export interface JoinPolicy {
  /** Newcomers may take open bot seats after the game has started. */
  midGameJoins: boolean;
  /** Seat newcomers automatically instead of letting them pick. */
  autoAssign: boolean;
}

/** What anyone in the room may know about a game in progress. No cards. */
export interface TableSummary {
  setNumber: number;
  phase: Phase;
  scores: [number, number];
  tricksWon: [number, number];
  trump: Suit | null;
  contract: { seat: Seat; value: number } | null;
  handCounts: number[];
  turn: Seat | null;
}

export type SeatDeniedReason =
  /** Someone else took it first. */
  | 'SEAT_TAKEN'
  /** A disconnected player still has it reserved. */
  | 'RESERVED'
  /** Not a seat a newcomer can take (a connected human's, or out of range). */
  | 'NOT_OPEN'
  | 'JOINS_DISABLED'
  | 'NO_OPEN_SEATS'
  /** Sent on HELLO with a token for a seat that was given up (reservation ran out, or released). */
  | 'SEAT_EXPIRED';

/** Pause state, part of LOBBY so a resync always gets it right. */
export interface PauseState {
  paused: boolean;
  /** Who paused (the host, or the player whose request the host accepted). */
  by: Seat | null;
  /** The host reopened a saved game and is waiting for players before continuing. */
  resuming: boolean;
}

/** Things players should hear about. Clients write their own wording. */
export type TableEvent =
  | { kind: 'took-seat'; seat: Seat; name: string }
  /** A player came back to a saved game after the host had continued without them. */
  | { kind: 'returned'; seat: Seat; name: string }
  /** Host only (never sent over the network): a player asked to pause. */
  | { kind: 'pause-requested'; seat: Seat; name: string }
  /** To the player who asked: the host wants to keep playing. */
  | { kind: 'pause-declined' };

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
  | { type: 'LEAVE' }
  /** Take a seat in a game in progress: a specific open seat, or null for any open seat. */
  | { type: 'TAKE_SEAT'; seat: Seat | null }
  /** "Can we pause?" The host decides. */
  | { type: 'PAUSE_REQUEST' };

// ---------- Host -> client ----------

/** 'ended': the host closed the game. 'saved': the host saved it and will resume it later. */
export type HostStatus = 'paused' | 'ended' | 'saved';

export type HostMessageBody =
  | { type: 'WELCOME'; seat: Seat; token: string; roomCode: string; config: GameConfig }
  /** Shape frozen across versions so old clients can always show "please update". */
  | { type: 'REJECTED'; reason: RejectReason; hostVersion: number }
  /**
   * Who sits where and whether they're connected, the join rules, and (once started) a public
   * summary of the game. Sent whenever that changes, to seated players and to newcomers choosing a seat.
   */
  | {
      type: 'LOBBY';
      lobbyVersion: number;
      seats: SeatInfo[];
      started: boolean;
      policy: JoinPolicy;
      table: TableSummary | null;
      pause: PauseState;
    }
  /** A TAKE_SEAT that didn't work. The newcomer stays connected and can try another seat. */
  | { type: 'SEAT_DENIED'; reason: SeatDeniedReason }
  | { type: 'EVENT'; event: TableEvent }
  /** This client's view of the game; nothing about other players' hidden cards. */
  | { type: 'VIEW'; stateVersion: number; view: PlayerView }
  | { type: 'ACTION_RESULT'; requestId: number; error: { code: string; message: string } | null }
  /** Carries the latest versions so a client can tell it missed something and ask to RESYNC. */
  | { type: 'PONG'; t: number; stateVersion: number; lobbyVersion: number }
  /** For 'saved': a short label (names and score) the client keeps to show "Saved game with ...". */
  | { type: 'HOST_STATUS'; status: HostStatus; message: string; label?: string };

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
