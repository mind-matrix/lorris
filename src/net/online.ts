// Entry points the UI uses for online play. Imported lazily, so offline games never load Trystero.

import { makeConfig } from '../core';
import type { BotPacing } from '../session/BotRunner';
import { defaultStore, STORAGE_KEYS } from '../session/storage';
import { ClientSession } from './ClientSession';
import { HostSession, type SavedHostGame } from './HostSession';
import { generateRoomCode } from './roomCode';
import { TrysteroTransport } from './trysteroTransport';

const storage = defaultStore();

export async function hostGame(opts: { playerCount: number; name: string; pacing?: BotPacing }): Promise<HostSession> {
  const session = new HostSession({
    transport: new TrysteroTransport(),
    storage,
    roomCode: generateRoomCode(),
    config: makeConfig(opts.playerCount),
    hostName: opts.name,
    pacing: opts.pacing,
  });
  await session.open();
  return session;
}

export async function joinGame(opts: { roomCode: string; name: string }): Promise<ClientSession> {
  const session = new ClientSession({ transport: new TrysteroTransport(), storage, roomCode: opts.roomCode, name: opts.name });
  await storage.set(STORAGE_KEYS.lastJoined, opts.roomCode);
  await session.open();
  return session;
}

export async function resumeHosting(saved: SavedHostGame, pacing?: BotPacing): Promise<HostSession> {
  const session = new HostSession({ transport: new TrysteroTransport(), storage, roomCode: saved.roomCode, saved, pacing });
  await session.open();
  return session;
}
