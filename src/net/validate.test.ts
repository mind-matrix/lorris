import { describe, expect, it } from 'vitest';
import { createGame, getPlayerView, makeConfig } from '../core';
import { PROTOCOL_VERSION } from './protocol';
import { cleanName, parseAction, parseClientMessage, parseHostMessage, versionOf } from './validate';

const msg = (body: object, extra: object = {}) => ({ v: PROTOCOL_VERSION, seq: 1, ...body, ...extra });
const reject = (raw: unknown) => {
  const r = parseClientMessage(raw);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.reason;
};

describe('client message validation', () => {
  it('accepts every well-formed message type', () => {
    for (const body of [
      { type: 'HELLO', name: 'Asha', token: null },
      { type: 'HELLO', name: 'Asha', token: 'abcdefghijklmnop_-1234' },
      { type: 'ACTION', requestId: 3, action: { type: 'PLAY_CARD', card: '10H' } },
      { type: 'ACTION', requestId: 4, action: { type: 'BID', value: 5 } },
      { type: 'ACTION', requestId: 5, action: { type: 'CHOOSE_TRUMP', suit: 'S' } },
      { type: 'RESYNC' },
      { type: 'PING', t: 123 },
      { type: 'LEAVE' },
    ]) {
      expect(parseClientMessage(msg(body)).ok, JSON.stringify(body)).toBe(true);
    }
  });

  it('rejects malformed messages', () => {
    for (const raw of [null, 42, 'HELLO', [], { type: 'PING', t: 1 }]) reject(raw);
    expect(reject(msg({ type: 'HELLO', name: '', token: null }))).toBe('bad name');
    expect(reject(msg({ type: 'HELLO', name: 'x', token: 'short' }))).toBe('bad token');
    expect(reject(msg({ type: 'HELLO', name: 'x', token: '../../etc/passwd!!!!!!' }))).toBe('bad token');
    expect(reject(msg({ type: 'ACTION', requestId: 1, action: { type: 'PLAY_CARD', card: 'ZZ' } }))).toBe('bad action');
    expect(reject(msg({ type: 'ACTION', requestId: 1, action: { type: 'BID', value: 4.5 } }))).toBe('bad action');
    expect(reject(msg({ type: 'ACTION', requestId: 1, action: { type: 'CHOOSE_TRUMP', suit: 'X' } }))).toBe('bad action');
    expect(reject(msg({ type: 'ACTION', requestId: -1, action: { type: 'PASS' } }))).toBe('bad action');
    expect(reject(msg({ type: 'ACTION', requestId: 1, action: { type: 'CLAIM' } }))).toBe('bad action');
    expect(reject(msg({ type: 'PING', t: 'now' }))).toBe('bad ping');
    expect(reject({ v: PROTOCOL_VERSION, type: 'PING', t: 1 })).toBe('bad seq');
  });

  it('rejects unknown message types', () => {
    expect(reject(msg({ type: 'VIEW', view: {} }))).toBe('unknown type'); // host-only type
    expect(reject(msg({ type: 'GIVE_ME_ALL_THE_CARDS' }))).toBe('unknown type');
  });

  it('rejects oversized messages', () => {
    expect(reject(msg({ type: 'HELLO', name: 'x', token: null, junk: 'x'.repeat(10_000) }))).toBe('too large');
  });

  it('rejects other protocol versions, but can still read the version', () => {
    const old = { v: PROTOCOL_VERSION + 1, seq: 1, type: 'HELLO', name: 'x', token: null };
    expect(reject(old)).toBe('wrong version');
    expect(versionOf(old)).toBe(PROTOCOL_VERSION + 1);
    expect(versionOf('nonsense')).toBeNull();
  });

  it('never carries a seat: extra fields are dropped', () => {
    const r = parseClientMessage(msg({ type: 'ACTION', requestId: 1, seat: 3, action: { type: 'PASS', seat: 3 } }));
    expect(r.ok && r.message).toEqual({ v: PROTOCOL_VERSION, seq: 1, type: 'ACTION', requestId: 1, action: { type: 'PASS' } });
  });

  it('cleans names: trims, strips control and invisible characters, caps length', () => {
    expect(cleanName('  Asha  ')).toBe('Asha');
    expect(cleanName('A\u0000s​h‮a')).toBe('Asha');
    expect(cleanName('x'.repeat(50))).toHaveLength(20);
    expect(cleanName('​​')).toBeNull();
    expect(cleanName(7)).toBeNull();
  });

  it('parseAction only knows real actions', () => {
    expect(parseAction({ type: 'NEXT_SET' })).toEqual({ type: 'NEXT_SET' });
    expect(parseAction({ type: 'PLAY_CARD', card: 'JK' })).toEqual({ type: 'PLAY_CARD', card: 'JK' });
    expect(parseAction({ type: 'PLAY_CARD', card: '11H' })).toBeNull();
    expect(parseAction(null)).toBeNull();
  });
});

describe('host message validation', () => {
  const view = getPlayerView(createGame(makeConfig(4), 1), 2);
  const seats = [{ kind: 'human', name: 'A', status: 'connected' }, ...Array(3).fill({ kind: 'bot', name: 'Bot', status: 'connected' })];

  it('accepts a real view and a real lobby', () => {
    expect(parseHostMessage(msg({ type: 'VIEW', stateVersion: 3, view })).ok).toBe(true);
    expect(parseHostMessage(msg({ type: 'LOBBY', lobbyVersion: 2, seats, started: false })).ok).toBe(true);
  });

  it('rejects views that would break the client', () => {
    for (const bad of [
      { ...view, myHand: ['ZZ'] },
      { ...view, seat: 9 },
      { ...view, phase: 'hacking' },
      { ...view, trick: { leader: 0, plays: [{ seat: 0, card: 'nope' }] } },
      { ...view, handCounts: 'all' },
    ]) {
      expect(parseHostMessage(msg({ type: 'VIEW', stateVersion: 3, view: bad })).ok).toBe(false);
    }
    expect(parseHostMessage(msg({ type: 'LOBBY', lobbyVersion: 1, started: false, seats: [{ kind: 'alien', name: 'x', status: 'connected' }] })).ok).toBe(false);
  });

  it('accepts a rejection and validates its reason', () => {
    expect(parseHostMessage(msg({ type: 'REJECTED', reason: 'ROOM_FULL', hostVersion: 1 })).ok).toBe(true);
    expect(parseHostMessage(msg({ type: 'REJECTED', reason: 'BECAUSE', hostVersion: 1 })).ok).toBe(false);
  });

  it('rejects unknown types and oversized messages', () => {
    expect(parseHostMessage(msg({ type: 'HELLO', name: 'x', token: null })).ok).toBe(false);
    expect(parseHostMessage(msg({ type: 'PONG', t: 1, stateVersion: 1, lobbyVersion: 1, pad: 'x'.repeat(70_000) })).ok).toBe(false);
  });
});
