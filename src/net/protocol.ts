// Interfaces for online play (later phase). Nothing here is implemented yet.
//
// Model: one peer is the host and runs GameHost with the full GameState. Every other
// peer only ever receives its own PlayerView and sends actions back. The host
// validates every action with the core reducer, so a modified client can't cheat.
// A Trystero-based Transport will implement `Transport` below.

import type { Action, GameConfig, PlayerView, RuleError, Seat } from '../core';

/** What the UI talks to. Implemented by LocalSession now, and by a networked session later. */
export interface GameSession {
  /** Seats this device controls (more than one for pass-and-play). */
  readonly seats: Seat[];
  /** Receive the latest view for a seat. Called immediately with the current view. Returns an unsubscribe function. */
  subscribe(seat: Seat, listener: (view: PlayerView) => void): () => void;
  /** Ask the host to apply an action for a seat. Resolves to null on success or the rule error. */
  submit(seat: Seat, action: Action): Promise<RuleError | null>;
  /** Stop timers and release resources. */
  close(): void;
}

export type PeerId = string;

/** Messages from the host to one peer. */
export type HostMessage =
  | { type: 'WELCOME'; seat: Seat; config: GameConfig }
  | { type: 'VIEW'; view: PlayerView }
  | { type: 'ACTION_RESULT'; requestId: number; error: RuleError | null }
  | { type: 'SEAT_STATUS'; connected: boolean[] };

/** Messages from a peer to the host. */
export type PeerMessage =
  | { type: 'JOIN'; name: string }
  | { type: 'ACTION'; requestId: number; action: Action };

/** Minimal message channel between peers. */
export interface Transport<Out, In> {
  send(to: PeerId, message: Out): void;
  onMessage(handler: (from: PeerId, message: In) => void): void;
  onPeerJoin(handler: (peer: PeerId) => void): void;
  onPeerLeave(handler: (peer: PeerId) => void): void;
  close(): void;
}
