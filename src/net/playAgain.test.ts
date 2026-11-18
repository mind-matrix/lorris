import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../session/storage';
import type { LobbySnapshot } from '../session/types';
import { ClientSession } from './ClientSession';
import { ROOM, TEST_NET, assertNoLeaks, autoplay, setupGame, until } from './testHarness';
import type { PlayerView } from '../core';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('playing again in the same room', () => {
  it('after game over everyone returns to the lobby in their seats, and a new game starts in the same room', async () => {
    const game = await setupGame({ players: 4, clients: 1, targetScore: 6 });
    const [client] = game.clients;
    const watcher = new ClientSession({ transport: game.network.createTransport('watcher'), storage: new MemoryStore(), roomCode: ROOM, name: 'Zoe', net: TEST_NET, spectate: true });
    await watcher.open();
    await until(() => watcher.spectating, 3_000);

    let clientLobby: LobbySnapshot | null = null;
    client.subscribeLobby((l) => (clientLobby = l));
    let watcherLobby: LobbySnapshot | null = null;
    watcher.subscribeLobby((l) => (watcherLobby = l));

    game.host.start();
    const drivers = [autoplay(game.host, 0), autoplay(client, 1)];
    const finished = await until(() => drivers.every((d) => d.latest()?.phase === 'gameOver'), 600_000, 200);
    drivers.forEach((d) => d.stop());
    expect(finished).toBe(true);

    // Only once the game is over.
    game.host.playAgain();
    await until(() => clientLobby!.started === false && watcherLobby!.started === false, 3_000);
    expect(clientLobby!.started).toBe(false);
    expect(clientLobby!.mySeat).toBe(1);
    expect(client.seats).toEqual([1]);
    expect(watcherLobby!.spectating).toBe(true);
    expect(clientLobby!.spectators).toEqual(['Zoe']);
    expect(clientLobby!.roomCode).toBe(ROOM);
    // Seats are as they were: the host, the player, and the bots.
    expect(clientLobby!.seats.map((s) => s.kind)).toEqual(['human', 'human', 'bot', 'bot']);

    // A fresh game: new views reach the client and the spectator even though they saw a finished
    // game with high state versions (versions carry on across games).
    let clientView: PlayerView | null = null;
    client.subscribe(1, (v) => (clientView = v));
    let watcherView: PlayerView | null = null;
    watcher.watch((v) => (watcherView = v));
    game.host.start();
    await until(() => clientView?.phase === 'bidding' && watcherView?.phase === 'bidding', 3_000);
    expect(clientView!.phase).toBe('bidding');
    expect(clientView!.scores).toEqual([0, 0]);
    expect(clientView!.setNumber).toBe(1);
    expect(watcherView!.myHand).toEqual([]);

    // And it plays through again.
    const again = [autoplay(game.host, 0), autoplay(client, 1)];
    const finishedAgain = await until(() => again.every((d) => d.latest()?.phase === 'gameOver'), 600_000, 200);
    again.forEach((d) => d.stop());
    expect(finishedAgain).toBe(true);
    assertNoLeaks(game.sent);
  });

  it('does nothing while a game is still being played', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    let lobby: LobbySnapshot | null = null;
    game.host.subscribeLobby((l) => (lobby = l));
    game.host.start();
    await vi.advanceTimersByTimeAsync(500);
    game.host.playAgain();
    expect(lobby!.started).toBe(true);
  });
});
