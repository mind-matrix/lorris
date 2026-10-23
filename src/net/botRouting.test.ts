import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IN_GAME_BOT, IsmctsBot, createInGameBot, setInGameBotFactory, type Bot } from '../ai';
import { makeConfig } from '../core';
import { restoreOffline } from '../save/offline';
import { createEnvelope, newSaveId } from '../save/envelope';
import { createGame } from '../core';
import { HostSession } from './HostSession';
import { FAST_PACING, ROOM, TEST_BOT_BUDGET, TEST_NET, autoplay, newClient, savedGame, setupGame, until } from './testHarness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  setInGameBotFactory((seed) => new IsmctsBot(seed, { budget: TEST_BOT_BUDGET }));
});

/** Every bot the in-game factory hands out, so we can check what played each seat. */
function recordBots(): Bot[] {
  const made: Bot[] = [];
  setInGameBotFactory((seed) => {
    const b = new IsmctsBot(seed, { budget: TEST_BOT_BUDGET });
    made.push(b);
    return b;
  });
  return made;
}
const botsOf = (host: HostSession) => (host as unknown as { bots: Map<number, Bot> }).bots;

describe('every in-game bot seat is played by the ISMCTS bot', () => {
  it('the in-game bot is ISMCTS by default', () => {
    expect(IN_GAME_BOT).toBe('ismcts');
    setInGameBotFactory(null);
    expect(createInGameBot(1)).toBeInstanceOf(IsmctsBot);
  });

  it('lobby bot seats, disconnect takeovers, and the bot a mid-game joiner replaces', async () => {
    const made = recordBots();
    const game = await setupGame({ players: 4, clients: 1 });
    game.host.addBot(2);
    game.host.start();
    const humans = [autoplay(game.host, 0), autoplay(game.clients[0], 1)];
    await until(() => botsOf(game.host).has(2) && botsOf(game.host).has(3), 20_000);
    // Lobby bots (seats 2 and 3) played.
    expect([...botsOf(game.host).keys()].sort()).toEqual(expect.arrayContaining([2, 3]));
    humans[1].stop();
    // A disconnected human is covered by a bot.
    game.network.disconnect('client-1');
    await until(() => botsOf(game.host).has(1), TEST_NET.botTakeoverMs + 5_000);
    // A newcomer takes over seat 2's bot; later a bot plays seat 2 again only through the factory.
    const joiner = await newClient(game.network, 'joiner', 'Jo');
    await until(() => joiner.seats.length === 1, 2_000);
    for (const b of botsOf(game.host).values()) expect(b).toBeInstanceOf(IsmctsBot);
    expect(made.length).toBeGreaterThanOrEqual(3);
    humans[0].stop();
  });

  it('resumed online games (a save from older versions saying "heuristic" too)', async () => {
    const made = recordBots();
    const game = await setupGame({ players: 4, clients: 0 });
    game.host.start();
    await vi.advanceTimersByTimeAsync(500);
    game.host.pauseGame();
    await game.host.saveAndClose();
    const saved = await savedGame(game.saves);
    const old = createEnvelope({ ...saved, seats: saved.seats.map((s) => (s.kind === 'bot' ? { ...s, bot: { difficulty: 'heuristic' } } : s)) });
    const resumed = new HostSession({ transport: game.network.createTransport('again'), saves: game.saves, roomCode: ROOM, saved: old, net: TEST_NET, pacing: FAST_PACING });
    await resumed.open();
    const before = made.length;
    resumed.continueResumed();
    const host = autoplay(resumed, 0);
    await until(() => made.length > before && botsOf(resumed).size >= 2, 20_000);
    host.stop();
    expect(made.length).toBeGreaterThan(before);
    for (const b of botsOf(resumed).values()) expect(b).toBeInstanceOf(IsmctsBot);
  });

  it('offline games resumed from a save, whatever bot the save mentions', () => {
    const made = recordBots();
    const state = createGame(makeConfig(4), 3);
    const save = createEnvelope({
      id: newSaveId(),
      savedAt: Date.now(),
      mode: 'offline',
      game: { state, version: 1 },
      seats: [{ name: 'You', kind: 'human' }, ...[1, 2, 3].map((i) => ({ name: `Bot ${i + 1}`, kind: 'bot' as const, bot: { difficulty: 'heuristic' } }))],
    });
    const session = restoreOffline(save, FAST_PACING);
    session.close();
    expect(made).toHaveLength(3);
    for (const b of made) expect(b).toBeInstanceOf(IsmctsBot);
  });
});
