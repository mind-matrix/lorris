import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeConfig, type Card, type GameState } from '../core';
import { MemoryStore } from '../session/storage';
import type { LobbySnapshot, TableInfo } from '../session/types';
import { ClientSession } from './ClientSession';
import { HostSession } from './HostSession';
import { InMemoryNetwork } from './inMemoryTransport';
import { Outbox, PROTOCOL_VERSION } from './protocol';
import { roomPassword } from './roomCode';
import { ROOM, TEST_NET, assertNoLeaks, autoplay, savedGame, setupGame, until } from './testHarness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function playToEnd(game: Awaited<ReturnType<typeof setupGame>>, limitMs = 600_000) {
  const drivers = [autoplay(game.host, 0), ...game.clients.map((c) => autoplay(c, c.seats[0]))];
  // Done when every seat (host and clients) has seen the end of the game.
  const finished = await until(() => drivers.every((d) => d.latest()?.phase === 'gameOver'), limitMs, 200);
  drivers.forEach((d) => d.stop());
  return { finished, drivers };
}

describe('online play over the in-memory network', () => {
  it('4 players: host + 1 client + 2 bots play a full game; nobody sees hidden cards', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    expect(game.clients[0].seats).toEqual([1]);
    game.host.start();
    const { finished, drivers } = await playToEnd(game);
    expect(finished).toBe(true);
    // The client ends on the same final view as the host.
    expect(drivers[1].latest()!.scores).toEqual(drivers[0].latest()!.scores);
    expect(drivers[1].latest()!.phase).toBe('gameOver');
    expect(assertNoLeaks(game.sent)).toBeGreaterThan(50);
  });

  it('6 players: host + 3 clients + 2 bots play a full game; nobody sees hidden cards', async () => {
    const game = await setupGame({ players: 6, clients: 3 });
    expect(game.clients.map((c) => c.seats[0])).toEqual([1, 2, 3]);
    game.host.start();
    const { finished, drivers } = await playToEnd(game);
    expect(finished).toBe(true);
    for (const d of drivers) expect(d.latest()!.winner).toBe(drivers[0].latest()!.winner);
    assertNoLeaks(game.sent);
  });

  it('survives 10% dropped messages (clients resync and retry)', async () => {
    const game = await setupGame({ players: 4, clients: 3, network: { dropRate: 0.1, seed: 9 } });
    game.host.start();
    const { finished, drivers } = await playToEnd(game);
    expect(finished).toBe(true);
    // The network really did lose messages, and players had to retry.
    expect(drivers.some((d) => d.errors.includes('TIMEOUT'))).toBe(true);
    for (const d of drivers) expect(d.latest()!.scores).toEqual(drivers[0].latest()!.scores);
    assertNoLeaks(game.sent);
  });

  it('a client who drops mid-game is replaced by a bot, then gets the same seat and hand back', async () => {
    const game = await setupGame({ players: 4, clients: 1, targetScore: 32 });
    const [client] = game.clients;
    let table: TableInfo | null = null;
    game.host.subscribeTable((t) => (table = t));
    game.host.start();
    const hostDriver = autoplay(game.host, 0);
    let clientDriver = autoplay(client, 1);
    await vi.advanceTimersByTimeAsync(3_000);
    clientDriver.stop();

    game.network.disconnect('client-1');
    await until(() => table!.seats[1].status === 'reconnecting', 2_000);
    expect(table!.seats[1].status).toBe('reconnecting');
    // After the takeover timeout a bot plays seat 1, and the game keeps moving.
    await until(() => table!.seats[1].status === 'bot-controlled', 3_000);
    expect(table!.seats[1].status).toBe('bot-controlled');
    const before = game.sent.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(game.sent.length).toBeGreaterThan(before);

    // Back online (e.g. the phone came back to the foreground).
    client.resume();
    await until(() => table!.seats[1].status === 'connected', 3_000);
    expect(table!.seats[1].status).toBe('connected');
    clientDriver = autoplay(client, 1);
    await vi.advanceTimersByTimeAsync(1_000);
    const state = game.sent.at(-1)!.state as GameState;
    expect(clientDriver.latest()!.myHand).toEqual(state.hands[1]);
    hostDriver.stop();
    clientDriver.stop();
    assertNoLeaks(game.sent);
  });

  it('reloading the app (new peer, same stored token) reclaims the seat', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    game.host.start();
    await vi.advanceTimersByTimeAsync(500);
    // Same storage (IndexedDB survives a reload), new transport (new peer ID).
    const storage = (game.clients[0] as unknown as { storage: MemoryStore }).storage;
    game.network.disconnect('client-1');
    game.clients[0].close();
    const again = new ClientSession({ transport: game.network.createTransport('client-1-reloaded'), storage, roomCode: ROOM, name: 'Player 2', net: TEST_NET });
    await again.open();
    await until(() => again.seats.length === 1, 3_000);
    expect(again.seats).toEqual([1]);
    let view = null as unknown;
    again.subscribe(1, (v) => (view = v));
    await until(() => view !== null, 2_000);
    expect(view).not.toBeNull();
  });

  it('rejects illegal, wrong-turn, forged and malformed actions, and cuts off a flooding peer', async () => {
    const game = await setupGame({ players: 4, clients: 0 });
    const rogue = game.network.createTransport('rogue');
    const inbox: { type: string; [k: string]: unknown }[] = [];
    rogue.onMessage((_, m) => inbox.push(m as never));
    await rogue.connect(ROOM, roomPassword(ROOM));
    await vi.advanceTimersByTimeAsync(50);
    const out = new Outbox();
    const send = (body: object) => rogue.send('host', out.wrap(body));
    send({ type: 'HELLO', name: 'Rogue', token: null });
    await vi.advanceTimersByTimeAsync(50);
    expect(inbox.find((m) => m.type === 'WELCOME')).toMatchObject({ seat: 1 });
    game.host.start();
    await vi.advanceTimersByTimeAsync(50);
    const stateBefore = JSON.stringify(game.sent.at(-1)!.state);
    const results = () => inbox.filter((m) => m.type === 'ACTION_RESULT').map((m) => (m.error as { code: string } | null)?.code);

    // Not in hand / not our turn (the host never takes a seat number from the message).
    send({ type: 'ACTION', requestId: 1, action: { type: 'PLAY_CARD', card: 'AS' } });
    send({ type: 'ACTION', requestId: 2, action: { type: 'BID', value: 5 }, seat: 0 });
    send({ type: 'ACTION', requestId: 3, action: { type: 'CHOOSE_TRUMP', suit: 'H' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(results().every((code) => code === 'WRONG_PHASE' || code === 'NOT_YOUR_TURN')).toBe(true);
    expect(results()).toHaveLength(3);

    // Malformed and unknown messages are ignored without a reply.
    rogue.send('host', { v: PROTOCOL_VERSION, seq: 999, type: 'ACTION', requestId: 4, action: { type: 'STEAL' } });
    rogue.send('host', { v: PROTOCOL_VERSION, seq: 1000, type: 'GIVE_ME_STATE' });
    rogue.send('host', 'not even an object');
    await vi.advanceTimersByTimeAsync(50);
    expect(results()).toHaveLength(3);
    // The game didn't move because of any of this (only bots/host can act; none has yet).
    expect(JSON.stringify(game.sent.filter((s) => s.state).at(-1)!.state)).toBe(stateBefore);

    // Flooding gets the peer cut off.
    for (let i = 0; i < 500; i++) send({ type: 'PING', t: i });
    await vi.advanceTimersByTimeAsync(100);
    expect(inbox.some((m) => m.type === 'REJECTED' && m.reason === 'RATE_LIMITED')).toBe(true);
  });

  it('tells an outdated client to update, in both directions', async () => {
    const game = await setupGame({ players: 4, clients: 0 });
    const old = game.network.createTransport('old');
    const inbox: { type: string; reason?: string }[] = [];
    old.onMessage((_, m) => inbox.push(m as never));
    await old.connect(ROOM, roomPassword(ROOM));
    await vi.advanceTimersByTimeAsync(50);
    old.send('host', { v: PROTOCOL_VERSION + 1, seq: 1, type: 'HELLO', name: 'Future', token: null });
    await vi.advanceTimersByTimeAsync(50);
    expect(inbox).toEqual([expect.objectContaining({ type: 'REJECTED', reason: 'VERSION_MISMATCH', hostVersion: PROTOCOL_VERSION })]);

    // A client facing a newer host is told to update its app.
    const fakeHost = game.network.createTransport('newer-host');
    fakeHost.onMessage((from, m) => {
      if ((m as { type: string }).type === 'HELLO') fakeHost.send(from, { v: PROTOCOL_VERSION + 1, seq: 1, type: 'REJECTED', reason: 'VERSION_MISMATCH', hostVersion: PROTOCOL_VERSION + 1 });
    });
    game.host.close();
    await fakeHost.connect(ROOM, roomPassword(ROOM));
    const client = new ClientSession({ transport: game.network.createTransport('c'), storage: new MemoryStore(), roomCode: ROOM, name: 'Me', net: TEST_NET });
    let lobby: LobbySnapshot | null = null;
    client.subscribeLobby((l) => (lobby = l));
    await client.open();
    await until(() => lobby!.connection.kind === 'rejected', 1_000);
    expect(lobby!.connection).toMatchObject({ kind: 'rejected', needsUpdate: true });
  });

  it('lobby: full rooms, kicks, leaving, and bots', async () => {
    const game = await setupGame({ players: 4, clients: 2 });
    let lobby: LobbySnapshot | null = null;
    game.host.subscribeLobby((l) => (lobby = l));
    expect(lobby!.seats.map((s) => s.kind)).toEqual(['human', 'human', 'human', 'empty']);

    // Clients see the same seats in real time.
    let clientLobby: LobbySnapshot | null = null;
    game.clients[0].subscribeLobby((l) => (clientLobby = l));
    game.host.addBot(3);
    await until(() => clientLobby!.seats[3].kind === 'bot', 1_000);
    expect(clientLobby!.seats.map((s) => s.name)).toEqual(['Host', 'Player 2', 'Player 3', 'Bot 4']);

    // Before the start, a newcomer can take the host's bot seat...
    const late = new ClientSession({ transport: game.network.createTransport('late'), storage: new MemoryStore(), roomCode: ROOM, name: 'Late', net: TEST_NET });
    await late.open();
    await until(() => late.seats.length === 1, 1_000);
    expect(late.seats).toEqual([3]);
    // ...and once every seat has a human, the next one is told the game is full but stays connected.
    const full = new ClientSession({ transport: game.network.createTransport('full'), storage: new MemoryStore(), roomCode: ROOM, name: 'Full', net: TEST_NET });
    let fullLobby: LobbySnapshot | null = null;
    full.subscribeLobby((l) => (fullLobby = l));
    await full.open();
    await until(() => fullLobby!.notice !== null, 1_000);
    expect(fullLobby!.connection.kind).toBe('connected');
    expect(fullLobby!.mySeat).toBeNull();
    expect(fullLobby!.notice).toBe('This game is full. You can wait for the next game or ask the host.');
    late.leave();
    await until(() => full.seats.length === 1, 2_000); // a seat opened: the waiting player gets it
    expect(full.seats).toEqual([3]);
    full.leave();
    await until(() => lobby!.seats[3].kind === 'empty', 1_000);
    game.host.addBot(3);

    // Kick seat 2; the kicked client is told, and the seat opens up.
    let kickedLobby: LobbySnapshot | null = null;
    game.clients[1].subscribeLobby((l) => (kickedLobby = l));
    game.host.kick(2);
    await until(() => kickedLobby!.connection.kind === 'rejected', 1_000);
    expect(kickedLobby!.connection).toMatchObject({ message: 'The host removed you from the game.' });
    expect(lobby!.seats[2].kind).toBe('empty');

    // Leaving frees the seat too.
    game.clients[0].leave();
    await until(() => lobby!.seats[1].kind === 'empty', 1_000);
    expect(lobby!.seats[1].kind).toBe('empty');

    game.host.start();
    expect(lobby!.seats.map((s) => s.kind)).toEqual(['human', 'bot', 'bot', 'bot']);
  });

  it('a client looking for a room with no host gets a clear message, not an endless spinner', async () => {
    const network = new InMemoryNetwork();
    const client = new ClientSession({ transport: network.createTransport('alone'), storage: new MemoryStore(), roomCode: 'ZZZZZZ', name: 'Me', net: TEST_NET });
    let lobby: LobbySnapshot | null = null;
    client.subscribeLobby((l) => (lobby = l));
    await client.open();
    expect(lobby!.connection.kind).toBe('connecting');
    await until(() => lobby!.connection.kind === 'failed', TEST_NET.joinTimeoutMs + 500);
    expect(lobby!.connection).toMatchObject({ kind: 'failed', message: expect.stringContaining("Couldn't find that game") });
  });

  it('host disappears: clients wait, and the host resumes from its saved game', async () => {
    const game = await setupGame({ players: 4, clients: 2, targetScore: 32 });
    game.host.start();
    const drivers = [autoplay(game.host, 0), ...game.clients.map((c) => autoplay(c, c.seats[0]))];
    await vi.advanceTimersByTimeAsync(3_000);
    drivers.forEach((d) => d.stop());

    // The host's app is killed: no goodbye, just gone.
    game.network.disconnect('host');
    game.host.close();
    let table: TableInfo | null = null;
    game.clients[0].subscribeTable((t) => (table = t));
    await until(() => table!.connection.kind === 'waiting-for-host', 3_000);
    expect(table!.connection.kind).toBe('waiting-for-host');

    // The host reopens the app: same storage, new peer ID.
    const saved = await savedGame(game.saves);
    const resumed = new HostSession({ transport: game.network.createTransport('host-again'), saves: game.saves, roomCode: ROOM, saved, net: TEST_NET, pacing: { bid: 5, play: 5, afterRound: 5, nextSet: 5, afterDeal: 5 } });
    await resumed.open();
    await until(() => table!.connection.kind === 'connected', 3_000);
    expect(table!.connection.kind).toBe('connected');
    // A reopened game waits, paused, until the host continues.
    expect(table!.pause).toMatchObject({ paused: true, resuming: true });
    await until(() => game.clients.every((c) => c.seats.length === 1), 3_000);
    resumed.continueResumed();

    // Everyone picks up where they left off and can finish the game.
    const again = [autoplay(resumed, 0), ...game.clients.map((c) => autoplay(c, c.seats[0]))];
    const lastBefore = saved.game!.state;
    await vi.advanceTimersByTimeAsync(500);
    expect(again[1].latest()!.scores).toEqual(lastBefore.scores);
    const finished = await until(() => again[0].latest()?.phase === 'gameOver', 900_000, 500);
    again.forEach((d) => d.stop());
    expect(finished).toBe(true);
  });

  it('when the host waits too long, clients are asked whether to keep waiting', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    game.host.start();
    await vi.advanceTimersByTimeAsync(200);
    game.network.disconnect('host');
    game.host.close();
    let table: TableInfo | null = null;
    game.clients[0].subscribeTable((t) => (table = t));
    await until(() => table!.connection.kind === 'host-timeout', TEST_NET.hostWaitMs + 2_000);
    expect(table!.connection.kind).toBe('host-timeout');
    game.clients[0].keepWaiting();
    expect(table!.connection.kind).toBe('waiting-for-host');
  });

  it('the host ending the game tells everyone', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    game.host.start();
    let table: TableInfo | null = null;
    game.clients[0].subscribeTable((t) => (table = t));
    game.host.leave();
    await until(() => table!.connection.kind === 'ended', 1_000);
    expect(table!.connection).toMatchObject({ kind: 'ended', message: 'The host ended the game.' });
  });

  it('ignores stale views', async () => {
    const network = new InMemoryNetwork({ latencyMs: 1 });
    const fake = network.createTransport('fake-host');
    const out = new Outbox();
    await fake.connect(ROOM, roomPassword(ROOM));
    const { createGame, getPlayerView } = await import('../core');
    const s1 = createGame(makeConfig(4), 1);
    const s2 = createGame(makeConfig(4), 2);
    fake.onMessage((from, m) => {
      if ((m as { type: string }).type !== 'HELLO') return;
      fake.send(from, out.wrap({ type: 'WELCOME', seat: 1, token: 'abcdefghijklmnopqrstuv', roomCode: ROOM, config: s1.config }));
      fake.send(from, out.wrap({ type: 'VIEW', stateVersion: 5, view: getPlayerView(s1, 1) }));
      fake.send(from, out.wrap({ type: 'VIEW', stateVersion: 3, view: getPlayerView(s2, 1) }));
    });
    const client = new ClientSession({ transport: network.createTransport('c'), storage: new MemoryStore(), roomCode: ROOM, name: 'Me', net: TEST_NET });
    await client.open();
    let view = null as null | { myHand: Card[] };
    await until(() => client.seats.length === 1, 1_000);
    client.subscribe(1, (v) => (view = v));
    await vi.advanceTimersByTimeAsync(20);
    expect(view!.myHand).toEqual(s1.hands[1]);
  });
});
