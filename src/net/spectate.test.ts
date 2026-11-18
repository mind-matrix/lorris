import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, getSpectatorView, makeConfig, type PlayerView } from '../core';
import { MemoryStore } from '../session/storage';
import type { LobbySnapshot } from '../session/types';
import { ClientSession } from './ClientSession';
import { ROOM, TEST_NET, assertNoLeaks, autoplay, hostSnapshot, setupGame, until } from './testHarness';
import type { InMemoryNetwork } from './inMemoryTransport';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function spectator(network: InMemoryNetwork, id = 'watcher', name = 'Zoe'): Promise<ClientSession> {
  const c = new ClientSession({ transport: network.createTransport(id), storage: new MemoryStore(), roomCode: ROOM, name, net: TEST_NET, spectate: true });
  await c.open();
  return c;
}

describe('getSpectatorView', () => {
  it('is a player view with no hand at all', () => {
    const state = createGame(makeConfig(4), 7);
    const view = getSpectatorView(state);
    expect(view.myHand).toEqual([]);
    expect(view.handCounts).toEqual(state.hands.map((h) => h.length));
    const json = JSON.stringify(view);
    for (const hand of state.hands) for (const card of hand) expect(json).not.toContain(`"${card}"`);
    expect(json).not.toContain('"rng"');
  });
});

describe('spectators', () => {
  it('a spectator joining mid-game watches the table, never sees a hand, and is never seated', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    game.host.start();
    const drivers = [autoplay(game.host, 0), autoplay(game.clients[0], 1)];
    await vi.advanceTimersByTimeAsync(2_000);

    const watcher = await spectator(game.network);
    let lobby: LobbySnapshot | null = null;
    watcher.subscribeLobby((l) => (lobby = l));
    const views: PlayerView[] = [];
    watcher.watch((v) => views.push(v));
    await until(() => views.length > 0, 3_000);

    expect(watcher.spectating).toBe(true);
    expect(watcher.seats).toEqual([]);
    expect(lobby!.spectating).toBe(true);
    expect(lobby!.mySeat).toBeNull();
    // The bots keep their seats: auto-seating never pulls a spectator into the game.
    expect(lobby!.seats.filter((s) => s.kind === 'bot')).toHaveLength(2);
    let hostLobby: LobbySnapshot | null = null;
    game.host.subscribeLobby((l) => (hostLobby = l));
    expect(hostLobby!.spectators).toEqual(['Zoe']);

    // Views keep coming as the game moves, with the same public table as the players see.
    const before = views.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(views.length).toBeGreaterThan(before);
    expect(views.every((v) => v.myHand.length === 0)).toBe(true);
    // Let play settle (no move in flight), then the spectator's table matches the host's.
    drivers.forEach((d) => d.stop());
    await vi.advanceTimersByTimeAsync(3_000);
    const { state } = hostSnapshot(game.host);
    expect(views.at(-1)!.handCounts).toEqual(state.hands.map((h) => h.length));

    // A spectator can't play.
    expect((await watcher.submit(0, { type: 'PASS' }))?.code).toBe('NOT_SEATED');
    assertNoLeaks(game.sent);
  });

  it('a spectator can take a free seat before the start, and then plays', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    const watcher = await spectator(game.network);
    await until(() => watcher.spectating, 3_000);
    expect(watcher.seats).toEqual([]);

    watcher.takeSeat(null);
    await until(() => watcher.seats.length === 1, 3_000);
    expect(watcher.seats).toEqual([2]);
    expect(watcher.spectating).toBe(false);
    let hostLobby: LobbySnapshot | null = null;
    game.host.subscribeLobby((l) => (hostLobby = l));
    expect(hostLobby!.spectators).toEqual([]);
    expect(hostLobby!.seats[2]).toMatchObject({ kind: 'human', name: 'Zoe' });
  });

  it('leaving, or going quiet, takes a spectator off the list', async () => {
    const game = await setupGame({ players: 4, clients: 0 });
    let hostLobby: LobbySnapshot | null = null;
    game.host.subscribeLobby((l) => (hostLobby = l));
    const a = await spectator(game.network, 'w1', 'Ann');
    const b = await spectator(game.network, 'w2', 'Bo');
    await until(() => hostLobby!.spectators.length === 2, 3_000);
    expect(hostLobby!.spectators.sort()).toEqual(['Ann', 'Bo']);

    a.leave();
    await until(() => hostLobby!.spectators.length === 1, 3_000);
    expect(hostLobby!.spectators).toEqual(['Bo']);

    game.network.disconnect('w2');
    b.close();
    await until(() => hostLobby!.spectators.length === 0, 5_000);
    expect(hostLobby!.spectators).toEqual([]);
  });

  it('spectators hear when the host ends the game', async () => {
    const game = await setupGame({ players: 4, clients: 0 });
    const watcher = await spectator(game.network);
    let lobby: LobbySnapshot | null = null;
    watcher.subscribeLobby((l) => (lobby = l));
    await until(() => watcher.spectating, 3_000);
    game.host.leave();
    await until(() => lobby!.connection.kind === 'ended', 3_000);
    expect(lobby!.connection.kind).toBe('ended');
  });
});
