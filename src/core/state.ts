import type { GameEvent, GameState } from './types';

/**
 * Copies every array the reducer may mutate, so applyAction can work on the copy
 * without touching the input. Objects inside arrays (bids, plays, tricks, events)
 * are never mutated after creation, so sharing them is safe.
 */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    hands: s.hands.map((h) => h.slice()),
    bids: s.bids.slice(),
    trick: { leader: s.trick.leader, plays: s.trick.plays.slice() },
    completedTricks: s.completedTricks.slice(),
    tricksWon: [s.tricksWon[0], s.tricksWon[1]],
    scores: [s.scores[0], s.scores[1]],
    hasFailedBefore: [s.hasFailedBefore[0], s.hasFailedBefore[1]],
    setHistory: s.setHistory.slice(),
    log: s.log.slice(),
  };
}

/** Distributive Omit, so each event variant keeps its own fields. */
type EventInput = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, 'seq'> : never) : never;

export function pushEvent(s: GameState, event: EventInput): void {
  s.log.push({ ...event, seq: s.nextSeq } as GameEvent);
  s.nextSeq++;
}
