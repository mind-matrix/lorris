import { describe, expect, it } from 'vitest';
import { makeConfig } from '../core';
import { HOST_SEAT, addBot, claimSeat, createLobby, freeSeat, kickSeat, publicSeats, seatForToken, startLobby } from './lobby';

const lobby = () => createLobby(makeConfig(4), 'Host', 'host-token');

describe('lobby', () => {
  it('the host sits in seat 0 and the rest start empty', () => {
    const l = lobby();
    expect(l.seats.map((s) => s.kind)).toEqual(['human', 'empty', 'empty', 'empty']);
    expect(seatForToken(l, 'host-token')).toBe(HOST_SEAT);
  });

  it('players fill seats in order until the room is full', () => {
    let l = lobby();
    const seats: number[] = [];
    for (const name of ['A', 'B', 'C']) {
      const r = claimSeat(l, name, `token-${name}`)!;
      l = r.lobby;
      seats.push(r.seat);
    }
    expect(seats).toEqual([1, 2, 3]);
    expect(claimSeat(l, 'D', 'token-D')).toBeNull();
    expect(seatForToken(l, 'token-B')).toBe(2);
    expect(seatForToken(l, 'nope')).toBeNull();
  });

  it('bots can go in empty seats and be removed again', () => {
    let l = addBot(lobby(), 2);
    expect(l.seats[2]).toMatchObject({ kind: 'bot', name: 'Bot 3', token: null });
    expect(claimSeat(l, 'A', 'tok-A')!.seat).toBe(1);
    l = freeSeat(l, 2);
    expect(l.seats[2].kind).toBe('empty');
    expect(addBot(claimSeat(l, 'A', 't')!.lobby, 1).seats[1].kind).toBe('human'); // can't replace a human
  });

  it('kicking empties the seat in the lobby, hands it to a bot in game, and voids the token', () => {
    const joined = claimSeat(lobby(), 'A', 'tok-A')!.lobby;
    const kicked = kickSeat(joined, 1);
    expect(kicked.seats[1].kind).toBe('empty');
    expect(seatForToken(kicked, 'tok-A')).toBeNull();
    const inGame = kickSeat(startLobby(joined), 1);
    expect(inGame.seats[1]).toMatchObject({ kind: 'bot', token: null });
  });

  it('the host cannot be kicked or removed', () => {
    const l = lobby();
    expect(kickSeat(l, HOST_SEAT)).toBe(l);
    expect(freeSeat(l, HOST_SEAT)).toBe(l);
  });

  it('starting fills empty seats with bots', () => {
    const l = startLobby(claimSeat(lobby(), 'A', 'tok-A')!.lobby);
    expect(l.started).toBe(true);
    expect(l.seats.map((s) => s.kind)).toEqual(['human', 'human', 'bot', 'bot']);
    expect(claimSeat(l, 'Late', 'tok')).toBeNull();
  });

  it('public seat info never includes tokens', () => {
    const l = claimSeat(lobby(), 'A', 'tok-A')!.lobby;
    const info = publicSeats(l, () => 'connected');
    expect(JSON.stringify(info)).not.toContain('tok');
    expect(info[1]).toEqual({ kind: 'human', name: 'A', status: 'connected' });
  });
});
