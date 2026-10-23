// Entry points the UI uses for online play. Imported lazily, so offline games never load Trystero.

import { makeConfig } from '../core';
import { saveStore } from '../save/appStore';
import type { SaveEnvelope } from '../save/envelope';
import type { BotPacing } from '../session/BotRunner';
import { defaultStore, STORAGE_KEYS } from '../session/storage';
import { ClientSession } from './ClientSession';
import { HostSession } from './HostSession';
import { generateRoomCode } from './roomCode';
import { TrysteroTransport } from './trysteroTransport';
import { prefetchIceServers } from './iceServers';

// Online play is opening (this module loads lazily): fetch relay credentials in the background now.
prefetchIceServers();

const storage = defaultStore();

export async function hostGame(opts: { playerCount: number; name: string; pacing?: BotPacing }): Promise<HostSession> {
  const session = new HostSession({
    transport: new TrysteroTransport(),
    saves: saveStore,
    roomCode: generateRoomCode(),
    config: makeConfig(opts.playerCount),
    hostName: opts.name,
    pacing: opts.pacing,
  });
  await session.open();
  return session;
}

/** `waitForHost`: the host's name, when rejoining a saved game they may not have reopened yet. */
export async function joinGame(opts: { roomCode: string; name: string; waitForHost?: string }): Promise<ClientSession> {
  const session = new ClientSession({ transport: new TrysteroTransport(), storage, ...opts });
  await storage.set(STORAGE_KEYS.lastJoined, opts.roomCode);
  await session.open();
  return session;
}

/** Reopens a saved hosted game (validated): same room code and password, paused until the host continues. */
export async function resumeHosting(saved: SaveEnvelope, pacing?: BotPacing): Promise<HostSession> {
  const session = new HostSession({ transport: new TrysteroTransport(), saves: saveStore, roomCode: saved.online!.roomCode, saved, pacing });
  await session.open();
  return session;
}
