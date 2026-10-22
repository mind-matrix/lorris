// Offline games: autosave after every move, and rebuild a LocalSession from a save.

import { HeuristicBot } from '../ai';
import { DEFAULT_PACING, LocalSession, type BotPacing } from '../session/LocalSession';
import { createEnvelope, type SaveEnvelope, type SavedSeat } from './envelope';
import { Autosaver, type SaveStore } from './SaveStore';

export function offlineSeats(session: LocalSession): SavedSeat[] {
  return session.botSeats.map((bot, seat) =>
    bot ? { name: session.names[seat], kind: 'bot', bot: { difficulty: 'heuristic' } } : { name: session.names[seat], kind: 'human' },
  );
}

export function offlineEnvelope(id: string, session: LocalSession): SaveEnvelope {
  return createEnvelope({ id, savedAt: Date.now(), mode: 'offline', game: session.snapshot(), seats: offlineSeats(session) });
}

/**
 * Saves the game now and after every accepted action. Finished games are removed from the
 * saved list. Returns the autosaver (to check for a full save list) and a stop function.
 */
export function autosaveOffline(store: SaveStore, id: string, session: LocalSession): { autosaver: Autosaver; stop: () => void } {
  const autosaver = new Autosaver(store, 'offline');
  const save = () => {
    if (session.snapshot().state.phase === 'gameOver') {
      void autosaver.flush().then(() => store.delete(id));
    } else {
      autosaver.request(offlineEnvelope(id, session));
    }
  };
  save();
  return { autosaver, stop: session.onChange(save) };
}

/** Rebuilds an offline game from a (validated) save: same state, same names, same bots. */
export function restoreOffline(save: SaveEnvelope, pacing: BotPacing = DEFAULT_PACING): LocalSession {
  const bots = save.seats.map((s) => (s.kind === 'bot' ? new HeuristicBot() : null));
  return new LocalSession({ snapshot: save.game }, bots, save.seats.map((s) => s.name), pacing);
}
