// Test-only helpers: a host and clients on an InMemoryNetwork, with every "human" seat driven by
// a HeuristicBot through its own session (so it sees exactly what a person would see).

import { vi } from 'vitest';
import { HeuristicBot } from '../ai';
import { getLegalActionsFromView, makeConfig, type GameState, type PlayerView, type Seat } from '../core';
import type { BotPacing } from '../session/BotRunner';
import { MemoryStore } from '../session/storage';
import type { GameSession } from '../session/types';
import { ClientSession } from './ClientSession';
import { NET_CONFIG, type NetConfig } from './config';
import { HostSession, hostedSaveId } from './HostSession';
import { SaveStore } from '../save/SaveStore';
import type { SaveEnvelope } from '../save/envelope';
import { InMemoryNetwork, type InMemoryNetworkOptions } from './inMemoryTransport';
import type { PeerId } from './transport';

export const ROOM = 'ABCDEF';
export const FAST_PACING: BotPacing = { bid: 5, play: 5, afterRound: 5, nextSet: 5, afterDeal: 5 };
export const TEST_NET: NetConfig = {
  ...NET_CONFIG,
  heartbeatIntervalMs: 100,
  peerTimeoutMs: 350,
  botTakeoverMs: 1_000,
  hostWaitMs: 5_000,
  joinTimeoutMs: 2_000,
  seatReservationMs: 3_000,
  actionTimeoutMs: 600,
  rateLimitPerSecond: 50,
  rateLimitBurst: 50,
};

export interface SentRecord {
  to: PeerId;
  message: { type: string } & Record<string, unknown>;
  state: GameState | null;
}

export async function setupGame(opts: {
  players: number;
  clients: number;
  network?: InMemoryNetworkOptions;
  targetScore?: number;
  seed?: number;
  makeBot?: (seat: number) => import('../ai').Bot;
}) {
  const network = new InMemoryNetwork({ latencyMs: 10, ...opts.network });
  const sent: SentRecord[] = [];
  const hostStore = new MemoryStore();
  const saves = new SaveStore(hostStore);
  const host = new HostSession({
    transport: network.createTransport('host'),
    saves,
    roomCode: ROOM,
    config: makeConfig(opts.players, { targetScore: opts.targetScore ?? 12 }),
    hostName: 'Host',
    seed: opts.seed ?? 42,
    pacing: FAST_PACING,
    net: TEST_NET,
    makeBot: opts.makeBot,
    onSend: (to, message, state) => sent.push({ to, message: message as SentRecord['message'], state }),
  });
  await host.open();

  const clients: ClientSession[] = [];
  /** Each client's device storage (survives the client "closing the app"). */
  const clientStores: MemoryStore[] = [];
  for (let i = 0; i < opts.clients; i++) {
    clientStores.push(new MemoryStore());
    const c = new ClientSession({
      transport: network.createTransport(`client-${i + 1}`),
      storage: clientStores[i],
      roomCode: ROOM,
      name: `Player ${i + 2}`,
      net: TEST_NET,
    });
    await c.open();
    clients.push(c);
  }
  await until(() => clients.every((c) => c.seats.length === 1), 5_000);
  return { network, host, hostStore, saves, clients, clientStores, sent };
}

/** Advances fake time until `done()` or `limitMs` passes. Returns whether done. */
export async function until(done: () => boolean, limitMs: number, stepMs = 50): Promise<boolean> {
  for (let t = 0; t < limitMs && !done(); t += stepMs) await vi.advanceTimersByTimeAsync(stepMs);
  return done();
}

/**
 * Plays a seat through its session with a HeuristicBot, like a person tapping: look at the view,
 * act if it's our move, retry later if the network ate the request.
 */
export function autoplay(session: GameSession, seat: Seat): { stop: () => void; latest: () => PlayerView | null; errors: string[] } {
  const bot = new HeuristicBot();
  let view: PlayerView | null = null;
  let busy = false;
  const errors: string[] = [];
  const unsub = session.subscribe(seat, (v) => (view = v));
  const timer = setInterval(async () => {
    if (busy || !view) return;
    const legal = getLegalActionsFromView(view);
    if (legal.length === 0) return;
    busy = true;
    const action = await bot.chooseAction(view, legal);
    const error = await session.submit(seat, action);
    if (error) errors.push(error.code);
    busy = false;
  }, 120);
  return { stop: () => (clearInterval(timer), unsub()), latest: () => view, errors };
}

export function hostState(sent: SentRecord[]): GameState | null {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].state) return sent[i].state;
  return null;
}

/** The host's saved game for the test room (as loaded and validated from storage). */
export async function savedGame(saves: SaveStore): Promise<SaveEnvelope> {
  const loaded = await saves.load(hostedSaveId(ROOM));
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.save;
}

/** Another player arriving, with their own device storage. */
export async function newClient(network: InMemoryNetwork, id: string, name: string, storage = new MemoryStore()): Promise<ClientSession> {
  const c = new ClientSession({ transport: network.createTransport(id), storage, roomCode: ROOM, name, net: TEST_NET });
  await c.open();
  return c;
}

/** The host's full state right now (tests only). */
export function hostSnapshot(host: HostSession): { state: GameState; version: number } {
  return (host as unknown as { game: { snapshot(): { state: GameState; version: number } } }).game.snapshot();
}

/**
 * Hidden-card check over every message the host sent: nobody (seated or not) ever receives a card
 * from another player's hand, and every VIEW carries exactly the recipient's own hand.
 */
export function assertNoLeaks(sent: SentRecord[]): number {
  const seatOf = new Map<string, number>();
  let views = 0;
  for (const { to, message, state } of sent) {
    if (message.type === 'WELCOME') seatOf.set(to, message.seat as number);
    if (!state) continue;
    const seat = seatOf.get(to);
    const json = JSON.stringify(message);
    state.hands.forEach((hand, s) => {
      if (s === seat) return;
      for (const card of hand) {
        if (json.includes(`"${card}"`)) throw new Error(`${message.type} to ${to} (seat ${seat}) leaked ${card} from seat ${s}`);
      }
    });
    if (message.type === 'VIEW') {
      views++;
      const view = message.view as { seat: number; myHand: string[] };
      if (view.seat !== seat) throw new Error(`VIEW for seat ${view.seat} sent to ${to} (seat ${seat})`);
      if (JSON.stringify(view.myHand) !== JSON.stringify(state.hands[seat!])) throw new Error('VIEW hand mismatch');
    }
    if (json.includes('"rng"') || json.includes('"hands"')) throw new Error(`${message.type} carried full state`);
  }
  return views;
}
