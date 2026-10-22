// Pure lobby logic: who holds which seat. The host keeps this alongside the game state.
// Seat tokens are secret and never leave the host (see publicSeats).

import type { GameConfig, Seat } from '../core';
import type { SeatInfo } from './protocol';

export interface LobbySeat {
  kind: 'empty' | 'human' | 'bot';
  name: string;
  /** Secret that lets a human reclaim this seat. Null for empty and bot seats. */
  token: string | null;
}

export interface Lobby {
  config: GameConfig;
  seats: LobbySeat[];
  started: boolean;
}

/** The host always sits in seat 0. */
export const HOST_SEAT: Seat = 0;

const EMPTY: LobbySeat = { kind: 'empty', name: '', token: null };
export const botName = (seat: Seat) => `Bot ${seat + 1}`;

export function createLobby(config: GameConfig, hostName: string, hostToken: string): Lobby {
  const seats = Array.from({ length: config.playerCount }, (): LobbySeat => ({ ...EMPTY }));
  seats[HOST_SEAT] = { kind: 'human', name: hostName, token: hostToken };
  return { config, seats, started: false };
}

export function seatForToken(lobby: Lobby, token: string): Seat | null {
  const seat = lobby.seats.findIndex((s) => s.kind === 'human' && s.token === token);
  return seat >= 0 ? seat : null;
}

const withSeat = (lobby: Lobby, seat: Seat, value: LobbySeat): Lobby => ({
  ...lobby,
  seats: lobby.seats.map((s, i) => (i === seat ? value : s)),
});

/** Gives a new player the first empty seat (seats fill in order). Null if the room is full or started. */
export function claimSeat(lobby: Lobby, name: string, token: string): { lobby: Lobby; seat: Seat } | null {
  if (lobby.started) return null;
  const seat = lobby.seats.findIndex((s) => s.kind === 'empty');
  if (seat < 0) return null;
  return { lobby: withSeat(lobby, seat, { kind: 'human', name, token }), seat };
}

export function renameSeat(lobby: Lobby, seat: Seat, name: string): Lobby {
  const s = lobby.seats[seat];
  return s?.kind === 'human' ? withSeat(lobby, seat, { ...s, name }) : lobby;
}

/** Puts a bot in an empty seat (lobby only). */
export function addBot(lobby: Lobby, seat: Seat): Lobby {
  if (lobby.started || lobby.seats[seat]?.kind !== 'empty') return lobby;
  return withSeat(lobby, seat, { kind: 'bot', name: botName(seat), token: null });
}

/** Empties a seat (lobby only): removes a bot, or frees a human's seat when they leave. Never the host's. */
export function freeSeat(lobby: Lobby, seat: Seat): Lobby {
  if (lobby.started || seat === HOST_SEAT || !lobby.seats[seat]) return lobby;
  return withSeat(lobby, seat, { ...EMPTY });
}

/**
 * Removes a human (never the host). In the lobby their seat becomes empty; mid-game a bot
 * takes it for good. Either way their token stops working.
 */
export function kickSeat(lobby: Lobby, seat: Seat): Lobby {
  if (seat === HOST_SEAT || lobby.seats[seat]?.kind !== 'human') return lobby;
  return withSeat(lobby, seat, lobby.started ? { kind: 'bot', name: botName(seat), token: null } : { ...EMPTY });
}

/** Starts the game; any seats still empty get bots. */
export function startLobby(lobby: Lobby): Lobby {
  return {
    ...lobby,
    started: true,
    seats: lobby.seats.map((s, seat) => (s.kind === 'empty' ? { kind: 'bot', name: botName(seat), token: null } : s)),
  };
}

/** What everyone may see about the seats: no tokens. */
export function publicSeats(lobby: Lobby, status: (seat: Seat) => SeatInfo['status']): SeatInfo[] {
  return lobby.seats.map((s, seat) => ({
    kind: s.kind,
    name: s.kind === 'empty' ? '' : s.name,
    status: s.kind === 'human' ? status(seat) : 'connected',
  }));
}
