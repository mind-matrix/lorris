import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeuristicBot, type Bot } from '../ai';
import { createGame, makeConfig, type Action, type PlayerView } from '../core';
import type { LobbySnapshot, TableInfo } from '../session/types';
import type { TableEvent } from './protocol';
import { assertNoLeaks, autoplay, hostSnapshot, newClient, setupGame, until, TEST_NET } from './testHarness';
import type { ClientSession } from './ClientSession';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function watchLobby(c: { subscribeLobby(l: (s: LobbySnapshot) => void): () => void }) {
  const box = { lobby: null as LobbySnapshot | null };
  c.subscribeLobby((l) => (box.lobby = l));
  return box;
}

/** A bot that takes a long time to decide, so a human can arrive mid-thought. */
class SlowBot implements Bot {
  readonly name = 'Slow';
  thinking = false;
  decided = 0;
  async chooseAction(view: PlayerView, legal: Action[]): Promise<Action> {
    this.thinking = true;
    await new Promise((r) => setTimeout(r, 3_000));
    this.decided++;
    return new HeuristicBot().chooseAction(view, legal);
  }
}

describe('joining a game in progress', () => {
  it('a newcomer takes over a bot seat: same hand, team and position; no new cards; everyone is told', async () => {
    const game = await setupGame({ players: 4, clients: 1, targetScore: 32 });
    game.host.start();
    const drivers = [autoplay(game.host, 0), autoplay(game.clients[0], 1)];
    await vi.advanceTimersByTimeAsync(2_000);
    drivers.forEach((d) => d.stop());

    const events: TableEvent[] = [];
    game.host.subscribeEvents((e) => events.push(e));
    const clientEvents: TableEvent[] = [];
    game.clients[0].subscribeEvents((e) => clientEvents.push(e));
    let hostTable: TableInfo | null = null;
    game.host.subscribeTable((t) => (hostTable = t));

    const before = hostSnapshot(game.host);
    const priya = await newClient(game.network, 'priya', 'Priya');
    const box = watchLobby(priya);
    await until(() => priya.seats.length === 1, 2_000);
    expect(priya.seats).toEqual([2]); // auto-assigned to the first open bot seat
    // Before being seated, the newcomer saw the public table (scores, set), but no cards.
    expect(box.lobby!.table).toMatchObject({ setNumber: before.state.setNumber, scores: before.state.scores });

    // Taking the seat didn't touch the game: same state, same version, nothing re-dealt.
    const after = hostSnapshot(game.host);
    expect(after.version).toBe(before.version);
    expect(after.state.hands).toEqual(before.state.hands);

    let view: PlayerView | null = null;
    priya.subscribe(2, (v) => (view = v));
    await until(() => view !== null, 1_000);
    expect(view!.myHand).toEqual(before.state.hands[2]);
    expect(view!.seat).toBe(2);

    expect(events).toEqual([{ kind: 'took-seat', seat: 2, name: 'Priya' }]);
    await until(() => clientEvents.length === 1, 1_000);
    expect(clientEvents).toEqual(events);
    expect(hostTable!.seats[2]).toMatchObject({ kind: 'human', name: 'Priya', status: 'connected' });

    // Priya now plays seat 2 herself through to the end of the game.
    const all = [autoplay(game.host, 0), autoplay(game.clients[0], 1), autoplay(priya, 2)];
    await until(() => all.every((d) => d.latest()?.phase === 'gameOver'), 900_000, 500);
    all.forEach((d) => d.stop());
    expect(all[2].latest()!.phase).toBe('gameOver');
    expect(assertNoLeaks(game.sent)).toBeGreaterThan(20);
  });

  it("taking a seat while its bot is thinking cancels the bot's move; the human plays it", async () => {
    const bots = new Map<number, SlowBot>();
    // Nobody plays the host's seat here, so pick a deal where a bot acts first.
    let seed = 1;
    while (createGame(makeConfig(4), seed).turn === 0) seed++;
    const game = await setupGame({
      players: 4,
      clients: 0,
      seed,
      makeBot: (seat) => {
        const b = new SlowBot();
        bots.set(seat, b);
        return b;
      },
    });
    game.host.setPolicy({ autoAssign: false });
    game.host.start();
    // Wait for a bot seat to be on turn and thinking.
    let hostView: PlayerView | null = null;
    game.host.subscribe(0, (v) => (hostView = v));
    await until(() => hostView!.turn !== 0 && !!bots.get(hostView!.turn!)?.thinking, 3_000, 10);
    const seat = hostView!.turn!;
    const bot = bots.get(seat)!;
    expect(bot.thinking).toBe(true);
    const versionBefore = hostSnapshot(game.host).version;

    const ravi = await newClient(game.network, 'ravi', 'Ravi');
    const box = watchLobby(ravi);
    await until(() => box.lobby?.table !== null && box.lobby?.table !== undefined, 1_000);
    ravi.takeSeat(seat);
    await until(() => ravi.seats.length === 1, 1_000);
    expect(ravi.seats).toEqual([seat]);

    // The bot finishes thinking, but its move is thrown away.
    await vi.advanceTimersByTimeAsync(3_500);
    expect(bot.decided).toBe(1);
    expect(hostSnapshot(game.host).version).toBe(versionBefore);
    expect(hostSnapshot(game.host).state.turn).toBe(seat);

    // The human makes the move instead.
    let view: PlayerView | null = null;
    ravi.subscribe(seat, (v) => (view = v));
    await until(() => view !== null, 500);
    const { getLegalActionsFromView } = await import('../core');
    const pending = ravi.submit(seat, getLegalActionsFromView(view!)[0]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeNull();
    expect(hostSnapshot(game.host).version).toBe(versionBefore + 1);
    assertNoLeaks(game.sent);
  });

  it("a disconnected player's seat is reserved; it opens to newcomers after the timeout", async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    game.host.setPolicy({ autoAssign: false });
    game.host.start();
    await vi.advanceTimersByTimeAsync(300);
    game.network.disconnect('client-1');
    let hostTable: TableInfo | null = null;
    game.host.subscribeTable((t) => (hostTable = t));
    await until(() => hostTable!.seats[1].kind === 'reserved', 2_000);
    expect(hostTable!.seats[1]).toMatchObject({ kind: 'reserved', name: 'Player 2' });

    const priya = await newClient(game.network, 'priya', 'Priya');
    const box = watchLobby(priya);
    await until(() => box.lobby!.seats.length > 0, 1_000);
    expect(box.lobby!.seats[1].kind).toBe('reserved');
    expect(box.lobby!.seats[1].reservedUntil).toBeGreaterThan(Date.now());
    priya.takeSeat(1);
    await until(() => box.lobby!.notice !== null, 1_000);
    expect(box.lobby!.notice).toBe('That seat is being kept for a player who lost their connection.');
    expect(priya.seats).toEqual([]);

    // After the reservation runs out, the seat is an open bot seat.
    await until(() => hostTable!.seats[1].kind === 'bot', TEST_NET.seatReservationMs + 1_000);
    priya.takeSeat(1);
    await until(() => priya.seats.length === 1, 1_000);
    expect(priya.seats).toEqual([1]);

    // The original player comes back with their old token: it no longer works, and they're told why.
    const back = game.clients[0];
    const backBox = watchLobby(back);
    back.resume();
    await until(() => backBox.lobby!.notice !== null, 3_000);
    expect(backBox.lobby!.notice).toMatch(/old seat was given up/);
    expect(back.seats).toEqual([]); // a newcomer again; they can pick an open seat
    back.takeSeat(null);
    await until(() => back.seats.length === 1, 1_000);
    expect(back.seats).toEqual([2]);
    assertNoLeaks(game.sent);
  });

  it('the host can release a reserved seat early', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    game.host.setPolicy({ autoAssign: false });
    game.host.start();
    await vi.advanceTimersByTimeAsync(300);
    game.network.disconnect('client-1');
    let hostTable: TableInfo | null = null;
    game.host.subscribeTable((t) => (hostTable = t));
    await until(() => hostTable!.seats[1].kind === 'reserved', 2_000);
    game.host.releaseSeat(1);
    expect(hostTable!.seats[1].kind).toBe('bot');
    const priya = await newClient(game.network, 'priya', 'Priya');
    await vi.advanceTimersByTimeAsync(100);
    priya.takeSeat(1);
    await until(() => priya.seats.length === 1, 1_000);
    expect(priya.seats).toEqual([1]);
  });

  it('the host can turn mid-game joins off and on again', async () => {
    const game = await setupGame({ players: 4, clients: 0 });
    game.host.start();
    game.host.setPolicy({ midGameJoins: false });
    const priya = await newClient(game.network, 'priya', 'Priya');
    const box = watchLobby(priya);
    await until(() => box.lobby!.seats.length > 0, 1_000);
    expect(box.lobby!.policy.midGameJoins).toBe(false);
    expect(priya.seats).toEqual([]); // not auto-seated
    priya.takeSeat(2);
    await until(() => box.lobby!.notice !== null, 1_000);
    expect(box.lobby!.notice).toBe("The host isn't letting new players join right now.");
    expect(priya.seats).toEqual([]);

    // Turned back on (auto-assign is on by default): the waiting newcomer gets a seat shortly.
    game.host.setPolicy({ midGameJoins: true });
    await until(() => priya.seats.length === 1, 1_000);
    expect(priya.seats).toEqual([1]);
  });

  it('a full table gives a clear message, not a silent failure', async () => {
    const game = await setupGame({ players: 4, clients: 3 });
    game.host.start();
    const late = await newClient(game.network, 'late', 'Late');
    const box = watchLobby(late);
    await until(() => box.lobby!.notice !== null, 1_000);
    expect(box.lobby!.connection.kind).toBe('connected');
    expect(box.lobby!.started).toBe(true);
    expect(box.lobby!.notice).toBe('This game is full. You can wait for the next game or ask the host.');
    expect(box.lobby!.seats.every((s) => s.kind === 'human')).toBe(true);
    assertNoLeaks(game.sent);
  });

  it('two newcomers grabbing the same seat at once: exactly one gets it', async () => {
    const game = await setupGame({ players: 4, clients: 0 });
    game.host.setPolicy({ autoAssign: false });
    game.host.start();
    const a = await newClient(game.network, 'a', 'Asha');
    const b = await newClient(game.network, 'b', 'Ben');
    const boxes = [watchLobby(a), watchLobby(b)];
    await until(() => boxes.every((x) => x.lobby!.seats.length > 0), 1_000);
    a.takeSeat(2);
    b.takeSeat(2); // same moment
    await until(() => a.seats.length + b.seats.length === 1 && boxes.some((x) => x.lobby!.notice), 1_000);
    const winners = [a, b].filter((c) => c.seats[0] === 2);
    expect(winners).toHaveLength(1);
    const loser = winners[0] === a ? boxes[1] : boxes[0];
    expect(loser.lobby!.notice).toBe('Someone else just took that seat. Pick another one.');
    // The loser can still pick a different open seat.
    const loserSession = (winners[0] === a ? b : a) as ClientSession;
    loserSession.takeSeat(null);
    await until(() => loserSession.seats.length === 1, 1_000);
    expect(loserSession.seats[0]).not.toBe(2);
    assertNoLeaks(game.sent);
  });

  it('cannot take a connected human seat or the host seat', async () => {
    const game = await setupGame({ players: 4, clients: 1 });
    game.host.setPolicy({ autoAssign: false });
    game.host.start();
    const c = await newClient(game.network, 'c', 'Cleo');
    const box = watchLobby(c);
    await vi.advanceTimersByTimeAsync(100);
    for (const seat of [0, 1]) {
      c.takeSeat(seat);
      await until(() => box.lobby!.notice !== null, 500);
      expect(box.lobby!.notice).toBe('Someone else just took that seat. Pick another one.');
    }
    expect(c.seats).toEqual([]);
  });
});
