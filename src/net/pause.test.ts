import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLegalActionsFromView, type PlayerView } from '../core';
import { STORAGE_KEYS, type ClientGameRef, type MemoryStore } from '../session/storage';
import type { LobbySnapshot, TableInfo } from '../session/types';
import { ClientSession } from './ClientSession';
import { HostSession } from './HostSession';
import type { TableEvent } from './protocol';
import { FAST_PACING, ROOM, TEST_NET, assertNoLeaks, autoplay, hostSnapshot, newClient, savedGame, setupGame, until } from './testHarness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const watchTable = (s: { subscribeTable(l: (t: TableInfo) => void): () => void }) => {
  const box = { t: null as TableInfo | null };
  s.subscribeTable((t) => (box.t = t));
  return box;
};

/** A client "reopening the app": same device storage, new peer, waiting for the host if needed. */
async function reopenClient(game: Awaited<ReturnType<typeof setupGame>>, i: number, id: string) {
  const c = new ClientSession({
    transport: game.network.createTransport(id),
    storage: game.clientStores[i],
    roomCode: ROOM,
    name: `Player ${i + 2}`,
    net: TEST_NET,
    waitForHost: 'Host',
  });
  await c.open();
  return c;
}

async function resumeHost(game: Awaited<ReturnType<typeof setupGame>>, id = 'host-again') {
  const saved = await savedGame(game.saves);
  const host = new HostSession({ transport: game.network.createTransport(id), saves: game.saves, roomCode: ROOM, saved, net: TEST_NET, pacing: FAST_PACING });
  await host.open();
  return { host, saved };
}

describe('pausing', () => {
  it('the host pauses: no moves are accepted, bots stop, everyone sees it; unpausing plays on', async () => {
    const game = await setupGame({ players: 4, clients: 1, targetScore: 32 });
    game.host.start();
    const client = game.clients[0];
    const ct = watchTable(client);
    await vi.advanceTimersByTimeAsync(1_000);

    game.host.pauseGame();
    await until(() => ct.t!.pause?.paused === true, 1_000);
    expect(ct.t!.pause).toEqual({ paused: true, by: 0, resuming: false });
    const v = hostSnapshot(game.host).version;
    await vi.advanceTimersByTimeAsync(5_000); // bots would have played many moves by now
    expect(hostSnapshot(game.host).version).toBe(v);

    // A move from anyone is refused while paused.
    let view: PlayerView | null = null;
    client.subscribe(1, (x) => (view = x));
    const legal = view ? getLegalActionsFromView(view) : [];
    if (legal.length) {
      const pending = client.submit(1, legal[0]);
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toMatchObject({ code: 'PAUSED' });
    }
    expect(await game.host.submit(0, { type: 'PASS' })).toMatchObject({ code: 'PAUSED' });

    game.host.unpauseGame();
    await until(() => ct.t!.pause?.paused === false, 1_000);
    const drivers = [autoplay(game.host, 0), autoplay(client, 1)];
    await vi.advanceTimersByTimeAsync(3_000);
    drivers.forEach((d) => d.stop());
    expect(hostSnapshot(game.host).version).toBeGreaterThan(v);
    assertNoLeaks(game.sent);
  });

  it('a player asks to pause; the host can accept or decline', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    game.host.start();
    const events: TableEvent[] = [];
    game.host.subscribeEvents((e) => events.push(e));
    const clientEvents: TableEvent[] = [];
    game.clients[0].subscribeEvents((e) => clientEvents.push(e));
    await vi.advanceTimersByTimeAsync(300);

    game.clients[0].requestPause();
    await until(() => events.length > 0, 1_000);
    expect(events).toEqual([{ kind: 'pause-requested', seat: 1, name: 'Player 2' }]);
    game.host.declinePause(1);
    await until(() => clientEvents.length > 0, 1_000);
    expect(clientEvents).toEqual([{ kind: 'pause-declined' }]);

    game.clients[0].requestPause();
    await until(() => events.length > 1, 1_000);
    game.host.pauseGame(1);
    const ct = watchTable(game.clients[0]);
    await until(() => ct.t!.pause?.paused === true, 1_000);
    expect(ct.t!.pause).toMatchObject({ paused: true, by: 1 });
  });

  it('while paused, a dropped player keeps their seat: the takeover and reservation clocks are frozen', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    game.host.start();
    await vi.advanceTimersByTimeAsync(300);
    game.host.pauseGame();
    game.network.disconnect('client-1');
    const ht = watchTable(game.host);
    await vi.advanceTimersByTimeAsync(TEST_NET.seatReservationMs * 2);
    expect(ht.t!.seats[1]).toMatchObject({ kind: 'reserved', status: 'reconnecting' });
    game.host.unpauseGame();
    // Fresh grace after unpausing: still reserved for a while.
    await vi.advanceTimersByTimeAsync(TEST_NET.botTakeoverMs / 2);
    expect(ht.t!.seats[1].kind).toBe('reserved');
  });
});

describe('save and leave, then resume', () => {
  it('the host saves and closes; players are told, and keep only a small reference', async () => {
    const game = await setupGame({ players: 4, clients: 2, targetScore: 32 });
    game.host.start();
    const drivers = [autoplay(game.host, 0), ...game.clients.map((c) => autoplay(c, c.seats[0]))];
    await vi.advanceTimersByTimeAsync(2_000);
    drivers.forEach((d) => d.stop());

    const tables = game.clients.map(watchTable);
    game.host.pauseGame();
    const finalState = hostSnapshot(game.host).state;
    await game.host.saveAndClose();
    await until(() => tables.every((t) => t.t!.connection.kind === 'ended'), 2_000);
    for (const t of tables) expect(t.t!.connection).toEqual({ kind: 'ended', message: 'Game saved. Host can resume it later.' });

    // The host's save is complete; each client kept a reference and its seat token, and no game state.
    const saved = await savedGame(game.saves);
    expect(saved.game.state).toEqual(finalState);
    expect(saved.online).toMatchObject({ roomCode: ROOM, hostName: 'Host' });
    expect(JSON.stringify(saved)).not.toMatch(/"token"/);
    for (const store of game.clientStores) {
      const ref = await store.get<ClientGameRef>(STORAGE_KEYS.clientRef(ROOM));
      expect(ref).toMatchObject({ roomCode: ROOM, hostName: 'Host', savedByHost: true, label: saved.label.text });
      expect(await store.get(STORAGE_KEYS.seat(ROOM))).toBeTruthy();
      const everything = JSON.stringify(await Promise.all((await store.keys('')).map((k) => store.get(k))));
      for (const hand of finalState.hands) for (const card of hand) expect(everything).not.toContain(`"${card}"`);
    }
    assertNoLeaks(game.sent);
  });

  it('resume with everyone back: same seats, same hands, and the game plays to the end', async () => {
    const game = await setupGame({ players: 4, clients: 2, targetScore: 20 });
    game.host.start();
    let drivers = [autoplay(game.host, 0), ...game.clients.map((c) => autoplay(c, c.seats[0]))];
    await vi.advanceTimersByTimeAsync(2_000);
    drivers.forEach((d) => d.stop());
    game.host.pauseGame();
    await game.host.saveAndClose();
    await vi.advanceTimersByTimeAsync(500);

    // Players reopen the app before the host is back: they wait instead of failing.
    const back = [await reopenClient(game, 0, 'c1-again'), await reopenClient(game, 1, 'c2-again')];
    const lobbies = back.map((c) => {
      const box = { l: null as LobbySnapshot | null };
      c.subscribeLobby((l) => (box.l = l));
      return box;
    });
    await vi.advanceTimersByTimeAsync(TEST_NET.joinTimeoutMs + 1_000);
    expect(lobbies[0].l!.connection).toEqual({ kind: 'waiting-to-resume', hostName: 'Host' });

    const { host, saved } = await resumeHost(game);
    const ht = watchTable(host);
    await until(() => back.every((c) => c.seats.length === 1), 3_000);
    expect(back.map((c) => c.seats[0])).toEqual([1, 2]);
    expect(ht.t!.pause).toEqual({ paused: true, by: 0, resuming: true });
    expect(ht.t!.seats.map((s) => s.kind)).toEqual(['human', 'human', 'human', 'bot']);
    // Everyone has their own hand back.
    for (const [i, c] of back.entries()) {
      let v: PlayerView | null = null;
      c.subscribe(i + 1, (x) => (v = x));
      await until(() => v !== null, 500);
      expect(v!.myHand).toEqual(saved.game.state.hands[i + 1]);
    }
    host.continueResumed();
    expect(ht.t!.pause).toEqual({ paused: false, by: null, resuming: false });
    drivers = [autoplay(host, 0), ...back.map((c, i) => autoplay(c, i + 1))];
    const done = await until(() => drivers.every((d) => d.latest()?.phase === 'gameOver'), 900_000, 500);
    drivers.forEach((d) => d.stop());
    expect(done).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(await game.saves.list()).toEqual([]); // finished games leave the saved list
    expect(await game.clientStores[0].get(STORAGE_KEYS.clientRef(ROOM))).toBeUndefined();
  });

  it('resume with a missing player: their seat is free for a bot, and they can take it back later', async () => {
    // No bot seats at all, so the missing player's seat is the only one a stranger could want.
    const game = await setupGame({ players: 4, clients: 3, targetScore: 32 });
    game.host.start();
    await vi.advanceTimersByTimeAsync(1_000);
    game.host.pauseGame();
    await game.host.saveAndClose();
    await vi.advanceTimersByTimeAsync(500);

    const { host, saved } = await resumeHost(game);
    const ht = watchTable(host);
    const events: TableEvent[] = [];
    host.subscribeEvents((e) => events.push(e));
    const ben = await reopenClient(game, 0, 'c1-again'); // seats 1 and 3 come back; seat 2 doesn't
    const cleo = await reopenClient(game, 2, 'c3-again');
    await until(() => ben.seats.length === 1 && cleo.seats.length === 1, 3_000);

    // A stranger can't take the missing player's seat while the host is still waiting.
    const stranger = await newClient(game.network, 'stranger', 'Stranger');
    const sl = { l: null as LobbySnapshot | null };
    stranger.subscribeLobby((l) => (sl.l = l));
    await until(() => sl.l!.notice !== null, 1_000);
    expect(sl.l!.notice).toBe('This game is full. You can wait for the next game or ask the host.');
    stranger.takeSeat(2);
    await until(() => sl.l!.notice === 'That seat is being kept for a player who lost their connection.', 1_000);
    expect(stranger.seats).toEqual([]);
    stranger.leave();

    // The host continues without them: a bot plays seat 2 straight away.
    host.continueResumed();
    expect(ht.t!.seats[2].kind).toBe('bot');
    const drivers = [autoplay(host, 0), autoplay(ben, 1), autoplay(cleo, 3)];
    await vi.advanceTimersByTimeAsync(3_000);
    expect(hostSnapshot(host).version).toBeGreaterThan(saved.game.version);
    drivers.forEach((d) => d.stop());

    // The missing player turns up and gets their seat (and its current hand) back from the bot.
    const late = await reopenClient(game, 1, 'c2-late');
    await until(() => late.seats.length === 1, 3_000);
    expect(late.seats).toEqual([2]);
    expect(events).toContainEqual({ kind: 'returned', seat: 2, name: 'Player 3' });
    let v: PlayerView | null = null;
    late.subscribe(2, (x) => (v = x));
    await until(() => v !== null, 500);
    expect(v!.myHand).toEqual(hostSnapshot(host).state.hands[2]);
    expect(ht.t!.seats[2]).toMatchObject({ kind: 'human', name: 'Player 3' });
    assertNoLeaks(game.sent);
  });

  it('host crash: the autosave lets the host reopen the game, and players come back', async () => {
    const game = await setupGame({ players: 4, clients: 1, targetScore: 32 });
    game.host.start();
    const drivers = [autoplay(game.host, 0), autoplay(game.clients[0], 1)];
    await vi.advanceTimersByTimeAsync(2_000);
    drivers.forEach((d) => d.stop());
    const before = hostSnapshot(game.host);
    // Dead battery: no goodbye, no explicit save.
    game.network.disconnect('host');
    game.host.close();
    await vi.advanceTimersByTimeAsync(100);
    const { host, saved } = await resumeHost(game);
    expect(saved.game).toEqual(before);
    await until(() => game.clients[0].seats.length === 1 && watchTable(game.clients[0]).t!.connection.kind === 'connected', 5_000);
    host.continueResumed();
    const d2 = [autoplay(host, 0), autoplay(game.clients[0], 1)];
    await vi.advanceTimersByTimeAsync(3_000);
    d2.forEach((d) => d.stop());
    expect(hostSnapshot(host).version).toBeGreaterThan(before.version);
  });
});

describe('client references', () => {
  it('leaving on purpose forgets the game; the host ending it does too', async () => {
    const game = await setupGame({ players: 4, clients: 2 });
    game.host.start();
    await vi.advanceTimersByTimeAsync(300);
    const refs = (s: MemoryStore) => s.get(STORAGE_KEYS.clientRef(ROOM));
    expect(await refs(game.clientStores[0])).toBeTruthy();
    game.clients[0].leave();
    await vi.advanceTimersByTimeAsync(400);
    expect(await refs(game.clientStores[0])).toBeUndefined();
    game.host.leave();
    await vi.advanceTimersByTimeAsync(400);
    expect(await refs(game.clientStores[1])).toBeUndefined();
  });
});
