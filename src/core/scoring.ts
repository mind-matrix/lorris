import { teamOf } from './config';
import { pushEvent } from './state';
import type { GameState, SetResult, Team } from './types';

/**
 * Points for the bidding team at the end of a set:
 * - made the call: +call
 * - failed: -call, doubled the first time that team ever fails
 * The defending team never scores.
 */
export function setDelta(callValue: number, made: boolean, failedBefore: boolean): number {
  if (made) return callValue;
  return failedBefore ? -callValue : -2 * callValue;
}

/** Scores the finished set and moves to setOver or gameOver. Mutates `s`. */
export function finishSet(s: GameState): void {
  const contract = s.contract!;
  const bidTeam = teamOf(contract.seat);
  const made = s.tricksWon[bidTeam] >= contract.value;
  const delta = setDelta(contract.value, made, s.hasFailedBefore[bidTeam]);

  s.scores[bidTeam] += delta;
  if (!made) s.hasFailedBefore[bidTeam] = true;

  const result: SetResult = {
    setNumber: s.setNumber,
    contract,
    trump: s.trump!,
    bidTeam,
    tricksWon: [s.tricksWon[0], s.tricksWon[1]],
    made,
    delta,
    roundsPlayed: s.completedTricks.length,
  };
  s.setHistory.push(result);
  pushEvent(s, { type: 'SET_SCORED', result });

  // Only the bidding team's score changes, so at most one team can cross the target.
  if (s.scores[bidTeam] >= s.config.targetScore) {
    s.phase = 'gameOver';
    s.winner = bidTeam as Team;
    s.turn = null;
    pushEvent(s, { type: 'GAME_OVER', winner: bidTeam });
  } else {
    s.phase = 'setOver';
    // The next dealer (one seat anti-clockwise) deals the next set.
    s.turn = (s.dealer + 1) % s.config.playerCount;
  }
}
