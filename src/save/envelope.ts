// The versioned save format, shared by offline saves, the host's online saves, and .lorris files.

import type { GameState } from '../core';
import { PROTOCOL_VERSION, type JoinPolicy } from '../net/protocol';
import { canonicalJson } from './canonical';
import { sha256 } from './sha256';
import { gameStateProblem } from './validateState';

export const SAVE_FORMAT = 'lorris-save';
/** 2: the deal generator's state became four words (sfc32) instead of one number. */
export const SAVE_FORMAT_VERSION = 2;
/** Oldest format we can still migrate. */
export const MIN_SAVE_FORMAT_VERSION = 0;


export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export interface SavedSeat {
  name: string;
  kind: 'human' | 'bot';
  /** Informational only: whatever bot kind wrote the save. On load, seats are played by the current in-game bot. */
  bot?: { difficulty: string };
  /** Online games: SHA-256 of the seat token (never the token itself). */
  tokenHash?: string;
}

export interface SaveLabel {
  players: string[];
  scores: [number, number];
  setNumber: number;
  /** e.g. "Asha, Ben + 2 bots · 12–4 · Set 5" */
  text: string;
}

export interface OnlineSaveInfo {
  roomCode: string;
  roomPassword: string;
  hostName: string;
  policy: JoinPolicy;
  lobbyVersion: number;
}

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  formatVersion: number;
  appVersion: string;
  protocolVersion: number;
  /** Same for every autosave of one game. */
  id: string;
  savedAt: number;
  mode: 'offline' | 'online';
  label: SaveLabel;
  /** The full game state, including its RNG state (state.rng). */
  game: { state: GameState; version: number };
  seats: SavedSeat[];
  online?: OnlineSaveInfo;
  checksum: string;
}

export type SaveErrorCode = 'NOT_A_SAVE' | 'CORRUPT' | 'TOO_OLD' | 'TOO_NEW' | 'INVALID_GAME';
export interface SaveError {
  code: SaveErrorCode;
  message: string;
}
export type LoadResult = { ok: true; save: SaveEnvelope; migrated: boolean } | { ok: false; error: SaveError };

const MESSAGES: Record<SaveErrorCode, string> = {
  NOT_A_SAVE: "That isn't a Lorris saved game.",
  CORRUPT: "This saved game is damaged and can't be opened.",
  TOO_OLD: 'This saved game is from a much older version of Lorris and can no longer be opened.',
  TOO_NEW: 'This saved game is from a newer version of Lorris. Update the app to open it.',
  INVALID_GAME: "This saved game doesn't add up (it may have been edited), so it can't be opened.",
};
const fail = (code: SaveErrorCode): LoadResult => ({ ok: false, error: { code, message: MESSAGES[code] } });

export function newSaveId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeLabel(seats: { name: string; kind: 'human' | 'bot' }[], state: GameState): SaveLabel {
  const humans = seats.filter((s) => s.kind === 'human').map((s) => s.name);
  const bots = seats.length - humans.length;
  const who = `${humans.join(', ')}${bots ? ` + ${bots} bot${bots > 1 ? 's' : ''}` : ''}`;
  return {
    players: seats.map((s) => s.name),
    scores: [state.scores[0], state.scores[1]],
    setNumber: state.setNumber,
    text: `${who} · ${state.scores[0]}–${state.scores[1]} · Set ${state.setNumber}`,
  };
}

export function checksumOf(envelope: Omit<SaveEnvelope, 'checksum'> | SaveEnvelope): string {
  const { checksum: _c, ...rest } = envelope as SaveEnvelope;
  return sha256(canonicalJson(rest));
}

export function createEnvelope(fields: Omit<SaveEnvelope, 'format' | 'formatVersion' | 'appVersion' | 'protocolVersion' | 'checksum' | 'label'>): SaveEnvelope {
  const body = {
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    appVersion: APP_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    ...fields,
    label: makeLabel(fields.seats, fields.game.state),
  } as Omit<SaveEnvelope, 'checksum'>;
  return { ...body, checksum: checksumOf(body) };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown, max = 200) => typeof x === 'string' && x.length > 0 && x.length <= max;

function schemaProblem(e: Record<string, unknown>): boolean {
  if (!isStr(e.id, 64) || typeof e.savedAt !== 'number' || !['offline', 'online'].includes(e.mode as string)) return true;
  if (!isStr(e.appVersion, 40) || typeof e.protocolVersion !== 'number' || !isStr(e.checksum, 64)) return true;
  if (!isObj(e.game) || typeof e.game.version !== 'number' || !isObj(e.label) || !Array.isArray(e.seats)) return true;
  const n = (e.game.state as GameState | undefined)?.config?.playerCount;
  if (e.seats.length !== n) return true;
  for (const s of e.seats) {
    if (!isObj(s) || !isStr(s.name, 60) || !['human', 'bot'].includes(s.kind as string)) return true;
    if (s.tokenHash !== undefined && !(typeof s.tokenHash === 'string' && /^[0-9a-f]{64}$/.test(s.tokenHash))) return true;
  }
  if (e.mode === 'online') {
    const o = e.online;
    if (!isObj(o) || !isStr(o.roomCode, 16) || !isStr(o.roomPassword, 100) || !isStr(o.hostName, 60) || !isObj(o.policy)) return true;
  }
  return false;
}

/**
 * Turns raw stored or imported data into a trusted save: checks it's a Lorris save, refuses
 * versions we can't handle, verifies the checksum, migrates old formats, and validates the game.
 */
export function loadEnvelope(raw: unknown, migrate: (e: Record<string, unknown>, from: number) => Record<string, unknown>): LoadResult {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return fail('CORRUPT');
    }
  }
  if (!isObj(data)) return fail('NOT_A_SAVE');
  // Format 0 (before this envelope existed) is recognised by shape; it has no tag or checksum.
  const isLegacy = data.format === undefined && isObj(data.lobby) && 'roomCode' in data;
  if (!isLegacy && data.format !== SAVE_FORMAT) return fail('NOT_A_SAVE');
  const version = isLegacy ? 0 : data.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) return fail('CORRUPT');
  if (version > SAVE_FORMAT_VERSION) return fail('TOO_NEW');
  if (version < MIN_SAVE_FORMAT_VERSION) return fail('TOO_OLD');
  if (version >= 1 && data.checksum !== checksumOf(data as unknown as SaveEnvelope)) return fail('CORRUPT');

  let envelope = data;
  try {
    if (version < SAVE_FORMAT_VERSION) envelope = migrate(data, version);
  } catch {
    return fail('CORRUPT');
  }
  if (schemaProblem(envelope)) return fail('CORRUPT');
  const save = envelope as unknown as SaveEnvelope;
  if (gameStateProblem(save.game.state)) return fail('INVALID_GAME');
  return { ok: true, save, migrated: version < SAVE_FORMAT_VERSION };
}
