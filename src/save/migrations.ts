// Upgrades saves from older formats, one version at a time, so old saves keep loading after updates.

import { DEFAULT_POLICY } from '../net/lobby';
import { roomPassword } from '../net/roomCode';
import { checksumOf, createEnvelope, loadEnvelope, type LoadResult, type SavedSeat, type SaveEnvelope } from './envelope';
import { hashToken } from './sha256';

type Raw = Record<string, unknown>;

/** migrations[n] turns a format-n save into a format-(n+1) save. */
const MIGRATIONS: Record<number, (save: Raw) => Raw> = {
  /**
   * Format 0: the Phase 2 "hosted game" record ({ roomCode, lobby, lobbyVersion, game }).
   * Seat tokens were stored in the clear; they're hashed now.
   */
  0: (old) => {
    const lobby = old.lobby as { seats: { kind: string; name: string; token: string | null }[]; policy?: never };
    const game = old.game as SaveEnvelope['game'] | null;
    if (!game) throw new Error('A lobby that never started has nothing to resume');
    const roomCode = old.roomCode as string;
    const seats: SavedSeat[] = lobby.seats.map((s) =>
      s.kind === 'human' && s.token
        ? { name: s.name, kind: 'human', tokenHash: hashToken(s.token) }
        : { name: s.name || 'Bot', kind: 'bot', bot: { difficulty: 'heuristic' } },
    );
    const e = createEnvelope({
      id: `room-${roomCode}`,
      savedAt: Date.now(),
      mode: 'online',
      game,
      seats,
      online: {
        roomCode,
        roomPassword: roomPassword(roomCode),
        hostName: lobby.seats[0]?.name ?? 'Host',
        policy: lobby.policy ?? { ...DEFAULT_POLICY },
        lobbyVersion: (old.lobbyVersion as number) ?? 1,
      },
    });
    return e as unknown as Raw;
  },
};

export function migrate(save: Raw, from: number): Raw {
  let s = save;
  for (let v = from; v < 1; v++) s = MIGRATIONS[v](s);
  // Re-stamp the checksum after migrating (formats that already had one keep theirs valid).
  return { ...s, checksum: checksumOf(s as unknown as SaveEnvelope) };
}

/** Load any stored or imported save: validation, checksum, and migration in one place. */
export function loadSave(raw: unknown): LoadResult {
  return loadEnvelope(raw, migrate);
}
