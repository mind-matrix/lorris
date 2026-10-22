// Runtime validation of everything that arrives over the network. Incoming data is untrusted:
// these functions accept only well-formed messages of known types and return a typed message,
// or a reason it was rejected.

import { SUITS, type Action, type Card, type PlayerView } from '../core';
import { NET_CONFIG } from './config';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type HostMessage,
  type RejectReason,
  type SeatInfo,
} from './protocol';

export type Parsed<T> = { ok: true; message: T } | { ok: false; reason: string };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown, min = -Infinity, max = Infinity): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const isStr = (x: unknown, maxLen: number): x is string => typeof x === 'string' && x.length <= maxLen;
const CARD_RE = /^(?:(?:10|[2-9JQKA])[SHDC]|JK)$/;
export const isCard = (x: unknown): x is Card => typeof x === 'string' && CARD_RE.test(x);
const isCardArray = (x: unknown, max = 64): x is Card[] => Array.isArray(x) && x.length <= max && x.every(isCard);

/** Size of a message as it would travel (JSON). Infinity if it can't be serialized. */
export function messageSize(raw: unknown): number {
  try {
    return JSON.stringify(raw)?.length ?? Infinity;
  } catch {
    return Infinity;
  }
}

/** The protocol version a raw message claims, if any. */
export function versionOf(raw: unknown): number | null {
  return isObj(raw) && isInt(raw.v, 0) ? raw.v : null;
}

function envelope(raw: unknown, maxBytes: number): Parsed<Obj> {
  if (messageSize(raw) > maxBytes) return { ok: false, reason: 'too large' };
  if (!isObj(raw)) return { ok: false, reason: 'not an object' };
  if (raw.v !== PROTOCOL_VERSION) return { ok: false, reason: 'wrong version' };
  if (!isInt(raw.seq, 1)) return { ok: false, reason: 'bad seq' };
  if (typeof raw.type !== 'string') return { ok: false, reason: 'missing type' };
  return { ok: true, message: raw };
}

/** Removes control and invisible/bidi-override characters and trims; returns null if nothing usable is left. */
export function cleanName(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const name = x.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').trim().slice(0, NET_CONFIG.maxNameLength);
  return name.length > 0 ? name : null;
}

export function parseAction(x: unknown): Action | null {
  if (!isObj(x)) return null;
  switch (x.type) {
    case 'BID':
      return isInt(x.value, 0, 99) ? { type: 'BID', value: x.value } : null;
    case 'PASS':
      return { type: 'PASS' };
    case 'CHOOSE_TRUMP':
      return SUITS.includes(x.suit as never) ? { type: 'CHOOSE_TRUMP', suit: x.suit as (typeof SUITS)[number] } : null;
    case 'PLAY_CARD':
      return isCard(x.card) ? { type: 'PLAY_CARD', card: x.card } : null;
    case 'NEXT_SET':
      return { type: 'NEXT_SET' };
    default:
      return null;
  }
}

export function parseClientMessage(raw: unknown): Parsed<ClientMessage> {
  const env = envelope(raw, NET_CONFIG.maxClientMessageBytes);
  if (!env.ok) return env;
  const m = env.message;
  const base = { v: PROTOCOL_VERSION, seq: m.seq as number };
  switch (m.type) {
    case 'HELLO': {
      const name = cleanName(m.name);
      if (!name) return { ok: false, reason: 'bad name' };
      if (m.token !== null && !(isStr(m.token, 64) && /^[A-Za-z0-9_-]{16,64}$/.test(m.token))) {
        return { ok: false, reason: 'bad token' };
      }
      return { ok: true, message: { ...base, type: 'HELLO', name, token: m.token } };
    }
    case 'ACTION': {
      const action = parseAction(m.action);
      if (!isInt(m.requestId, 0) || !action) return { ok: false, reason: 'bad action' };
      return { ok: true, message: { ...base, type: 'ACTION', requestId: m.requestId, action } };
    }
    case 'RESYNC':
      return { ok: true, message: { ...base, type: 'RESYNC' } };
    case 'PING':
      return isInt(m.t, 0) ? { ok: true, message: { ...base, type: 'PING', t: m.t } } : { ok: false, reason: 'bad ping' };
    case 'LEAVE':
      return { ok: true, message: { ...base, type: 'LEAVE' } };
    default:
      return { ok: false, reason: 'unknown type' };
  }
}

const REJECT_REASONS: RejectReason[] = ['VERSION_MISMATCH', 'ROOM_FULL', 'GAME_IN_PROGRESS', 'KICKED', 'RATE_LIMITED'];

function parseSeats(x: unknown): SeatInfo[] | null {
  if (!Array.isArray(x) || x.length > 12) return null;
  const seats: SeatInfo[] = [];
  for (const s of x) {
    if (!isObj(s) || !['empty', 'human', 'bot'].includes(s.kind as string)) return null;
    if (!['connected', 'reconnecting', 'bot-controlled'].includes(s.status as string)) return null;
    if (!isStr(s.name, NET_CONFIG.maxNameLength * 2)) return null;
    seats.push({ kind: s.kind as SeatInfo['kind'], name: cleanName(s.name) ?? '', status: s.status as SeatInfo['status'] });
  }
  return seats;
}

/**
 * Checks the parts of a player view the UI relies on. The host is another player's device,
 * so it's untrusted too: a malformed view must not crash the client.
 */
function isPlayerView(x: unknown): x is PlayerView {
  if (!isObj(x) || !isObj(x.config) || !isInt(x.seat, 0, 11)) return false;
  const n = (x.config as Obj).playerCount;
  if (!isInt(n, 2, 12) || (x.seat as number) >= n) return false;
  if (!isCardArray(x.myHand) || !Array.isArray(x.handCounts) || !x.handCounts.every((c) => isInt(c, 0, 64))) return false;
  if (!['bidding', 'choosingTrump', 'playing', 'setOver', 'gameOver'].includes(x.phase as string)) return false;
  if (!(x.turn === null || isInt(x.turn, 0, n - 1)) || !isInt(x.dealer, 0, n - 1) || !isInt(x.cutter, 0, n - 1)) return false;
  if (!(x.trump === null || SUITS.includes(x.trump as never))) return false;
  if (!isObj(x.trick) || !Array.isArray((x.trick as Obj).plays)) return false;
  const plays = (x.trick as Obj).plays as unknown[];
  if (!plays.every((p) => isObj(p) && isInt(p.seat, 0, n - 1) && isCard(p.card))) return false;
  if (!Array.isArray(x.completedTricks) || !Array.isArray(x.bids) || !Array.isArray(x.log) || !Array.isArray(x.setHistory)) return false;
  if (!Array.isArray(x.scores) || !Array.isArray(x.tricksWon)) return false;
  return true;
}

export function parseHostMessage(raw: unknown): Parsed<HostMessage> {
  const env = envelope(raw, NET_CONFIG.maxHostMessageBytes);
  if (!env.ok) return env;
  const m = env.message;
  const base = { v: PROTOCOL_VERSION, seq: m.seq as number };
  switch (m.type) {
    case 'WELCOME':
      if (!isInt(m.seat, 0, 11) || !isStr(m.token, 64) || !isStr(m.roomCode, 16) || !isObj(m.config)) {
        return { ok: false, reason: 'bad welcome' };
      }
      return { ok: true, message: { ...base, type: 'WELCOME', seat: m.seat, token: m.token, roomCode: m.roomCode, config: m.config as never } };
    case 'REJECTED':
      if (!REJECT_REASONS.includes(m.reason as RejectReason) || !isInt(m.hostVersion, 0)) return { ok: false, reason: 'bad rejection' };
      return { ok: true, message: { ...base, type: 'REJECTED', reason: m.reason as RejectReason, hostVersion: m.hostVersion } };
    case 'LOBBY': {
      const seats = parseSeats(m.seats);
      if (!seats || !isInt(m.lobbyVersion, 0) || typeof m.started !== 'boolean') return { ok: false, reason: 'bad lobby' };
      return { ok: true, message: { ...base, type: 'LOBBY', lobbyVersion: m.lobbyVersion, seats, started: m.started } };
    }
    case 'VIEW':
      if (!isInt(m.stateVersion, 0) || !isPlayerView(m.view)) return { ok: false, reason: 'bad view' };
      return { ok: true, message: { ...base, type: 'VIEW', stateVersion: m.stateVersion, view: m.view } };
    case 'ACTION_RESULT': {
      const e = m.error;
      const okErr = e === null || (isObj(e) && isStr(e.code, 64) && isStr(e.message, 300));
      if (!isInt(m.requestId, 0) || !okErr) return { ok: false, reason: 'bad result' };
      const error = e === null ? null : { code: (e as Obj).code as string, message: (e as Obj).message as string };
      return { ok: true, message: { ...base, type: 'ACTION_RESULT', requestId: m.requestId, error } };
    }
    case 'PONG':
      if (!isInt(m.t, 0) || !isInt(m.stateVersion, 0) || !isInt(m.lobbyVersion, 0)) return { ok: false, reason: 'bad pong' };
      return { ok: true, message: { ...base, type: 'PONG', t: m.t, stateVersion: m.stateVersion, lobbyVersion: m.lobbyVersion } };
    case 'HOST_STATUS':
      if (!['paused', 'ended'].includes(m.status as string) || !isStr(m.message, 300)) return { ok: false, reason: 'bad status' };
      return { ok: true, message: { ...base, type: 'HOST_STATUS', status: m.status as 'paused' | 'ended', message: m.message } };
    default:
      return { ok: false, reason: 'unknown type' };
  }
}
