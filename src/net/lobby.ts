// Pure lobby logic: who holds which seat. The host keeps this alongside the game state.
// Seats keep only a SHA-256 hash of their token: the real token lives with the player, so
// neither the host's memory, its saves, nor exported files can hand someone else a seat.

import type { GameConfig, Seat } from '../core';
import { hashToken } from '../save/sha256';
import type { JoinPolicy, SeatInfo } from './protocol';

export interface LobbySeat {
  kind: 'empty' | 'human' | 'bot';
  name: string;
  /** Hash of the secret token that lets a human reclaim this seat. Null for empty and bot seats. */
  tokenHash: string | null;
  /**
   * Bot seats a human gave up only because a saved game was resumed without them: if that
   * player comes back while it's still a bot, they get it back.
   */
  formerTokenHash?: string | null;
}

export interface Lobby {
  config: GameConfig;
  seats: LobbySeat[];
  started: boolean;
  policy: JoinPolicy;
}

export const DEFAULT_POLICY: JoinPolicy = { midGameJoins: true, autoAssign: true };

/** The host always sits in seat 0. */
export const HOST_SEAT: Seat = 0;

const EMPTY: LobbySeat = { kind: 'empty', name: '', tokenHash: null };
const botSeat = (seat: Seat): LobbySeat => ({ kind: 'bot', name: botName(seat), tokenHash: null });
export const botName = (seat: Seat) => `Bot ${seat + 1}`;

export function createLobby(config: GameConfig, hostName: string, hostToken: string): Lobby {
  const seats = Array.from({ length: config.playerCount }, (): LobbySeat => ({ ...EMPTY }));
  seats[HOST_SEAT] = { kind: 'human', name: hostName, tokenHash: hashToken(hostToken) };
  return { config, seats, started: false, policy: { ...DEFAULT_POLICY } };
}

export function seatForToken(lobby: Lobby, token: string): Seat | null {
  const hash = hashToken(token);
  const seat = lobby.seats.findIndex((s) => s.kind === 'human' && s.tokenHash === hash);
  return seat >= 0 ? seat : null;
}

/** A bot seat this token's owner left behind when a saved game resumed without them. */
export function formerSeatForToken(lobby: Lobby, token: string): Seat | null {
  const hash = hashToken(token);
  const seat = lobby.seats.findIndex((s) => s.kind === 'bot' && s.formerTokenHash === hash);
  return seat >= 0 ? seat : null;
}

/** The returning player gets their old seat back from the bot, with the same token. */
export function reclaimFormerSeat(lobby: Lobby, seat: Seat, name: string, token: string): Lobby {
  return withSeat(lobby, seat, { kind: 'human', name, tokenHash: hashToken(token) });
}

const withSeat = (lobby: Lobby, seat: Seat, value: LobbySeat): Lobby => ({
  ...lobby,
  seats: lobby.seats.map((s, i) => (i === seat ? value : s)),
});

/**
 * Before the start: gives a new player the first empty seat, or else the first seat the host
 * put a bot in. Null if every seat has a human, or the game has started (see takeBotSeat).
 */
export function claimSeat(lobby: Lobby, name: string, token: string): { lobby: Lobby; seat: Seat } | null {
  if (lobby.started) return null;
  let seat = lobby.seats.findIndex((s) => s.kind === 'empty');
  if (seat < 0) seat = lobby.seats.findIndex((s) => s.kind === 'bot');
  if (seat < 0) return null;
  return { lobby: withSeat(lobby, seat, { kind: 'human', name, tokenHash: hashToken(token) }), seat };
}

/** Bot seats a newcomer may take mid-game (bots from the start, or seats humans left for good). */
export function openBotSeats(lobby: Lobby): Seat[] {
  return lobby.seats.flatMap((s, seat) => (s.kind === 'bot' ? [seat] : []));
}

/**
 * A newcomer takes a specific seat: before the start an empty or bot seat; mid-game an open bot
 * seat, taking over the bot. Only the seat's owner changes; the game state (hand, team,
 * position) stays exactly as it is. Null if that seat isn't open.
 */
export function takeSeat(lobby: Lobby, seat: Seat, name: string, token: string): Lobby | null {
  const kind = lobby.seats[seat]?.kind;
  const open = lobby.started ? kind === 'bot' : kind === 'empty' || kind === 'bot';
  return open ? withSeat(lobby, seat, { kind: 'human', name, tokenHash: hashToken(token) }) : null;
}

/**
 * Mid-game: a human's seat becomes an open bot seat (they left, timed out, or the host released
 * it). With `keepClaim`, the player can still take it back while it's a bot (used when a saved
 * game resumes without them).
 */
export function releaseSeat(lobby: Lobby, seat: Seat, keepClaim = false): Lobby {
  const s = lobby.seats[seat];
  if (!lobby.started || seat === HOST_SEAT || s?.kind !== 'human') return lobby;
  return withSeat(lobby, seat, { ...botSeat(seat), ...(keepClaim ? { formerTokenHash: s.tokenHash } : {}) });
}

export function setPolicy(lobby: Lobby, policy: Partial<JoinPolicy>): Lobby {
  return { ...lobby, policy: { ...lobby.policy, ...policy } };
}

export function renameSeat(lobby: Lobby, seat: Seat, name: string): Lobby {
  const s = lobby.seats[seat];
  return s?.kind === 'human' ? withSeat(lobby, seat, { ...s, name }) : lobby;
}

/** Puts a bot in an empty seat (lobby only). */
export function addBot(lobby: Lobby, seat: Seat): Lobby {
  if (lobby.started || lobby.seats[seat]?.kind !== 'empty') return lobby;
  return withSeat(lobby, seat, botSeat(seat));
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
  return withSeat(lobby, seat, lobby.started ? botSeat(seat) : { ...EMPTY });
}

/** Starts the game; any seats still empty get bots. */
export function startLobby(lobby: Lobby): Lobby {
  return {
    ...lobby,
    started: true,
    seats: lobby.seats.map((s, seat) => (s.kind === 'empty' ? botSeat(seat) : s)),
  };
}

/**
 * What everyone may see about the seats: no tokens. Mid-game, a human seat whose player is away
 * is shown as 'reserved', with the time left before it opens up.
 */
export function publicSeats(
  lobby: Lobby,
  status: (seat: Seat) => SeatInfo['status'],
  reservedMs: (seat: Seat) => number | null = () => null,
): SeatInfo[] {
  return lobby.seats.map((s, seat): SeatInfo => {
    if (s.kind !== 'human') return { kind: s.kind, name: s.kind === 'empty' ? '' : s.name, status: 'connected' };
    const st = status(seat);
    const left = lobby.started && st !== 'connected' ? reservedMs(seat) : null;
    return left === null ? { kind: 'human', name: s.name, status: st } : { kind: 'reserved', name: s.name, status: st, reservedMs: left };
  });
}
