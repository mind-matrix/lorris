// Starting positions for duplicate Sets: a fresh deal (from the seed) under a varied score
// situation, so score-aware calling (near 32, first loss used or not) is actually exercised.

import { createGame, type GameConfig, type GameState, type SetResult } from '../../core';

export interface ScoreSituation {
  name: string;
  scores: [number, number];
  failed: [boolean, boolean];
}

export const SITUATIONS: ScoreSituation[] = [
  { name: 'fresh 0–0', scores: [0, 0], failed: [false, false] },
  { name: 'level 12–12', scores: [12, 12], failed: [false, false] },
  { name: 'ahead 18–6', scores: [18, 6], failed: [false, true] },
  { name: 'behind 6–18', scores: [6, 18], failed: [true, false] },
  { name: 'both failed 20–20', scores: [20, 20], failed: [true, true] },
  { name: 'one call from 32 (28–14)', scores: [28, 14], failed: [false, false] },
  { name: 'opponents near 32 (14–28)', scores: [14, 28], failed: [false, false] },
  { name: 'close finish 27–27', scores: [27, 27], failed: [true, false] },
  { name: 'deep negative -10–8', scores: [-10, 8], failed: [true, false] },
];

/** A start-of-Set state for `seed`: the deal comes from the seed, the score situation too. */
export function setStart(config: GameConfig, seed: number): { state: GameState; situation: ScoreSituation } {
  const situation = SITUATIONS[seed % SITUATIONS.length];
  const base = createGame(config, seed);
  // Synthetic history so scores still equal the sum of set results (the engine's invariant).
  const history: SetResult[] = [0, 1].flatMap((team) =>
    situation.scores[team] === 0
      ? []
      : [
          {
            setNumber: 0,
            contract: { seat: team, value: Math.abs(situation.scores[team]), forced: false },
            trump: 'S',
            bidTeam: team as 0 | 1,
            tricksWon: [0, 0],
            made: situation.scores[team] > 0,
            delta: situation.scores[team],
            roundsPlayed: 0,
          } satisfies SetResult,
        ],
  );
  const state: GameState = {
    ...base,
    scores: [...situation.scores],
    hasFailedBefore: [...situation.failed],
    setHistory: history,
    setNumber: history.length + 1,
  };
  return { state, situation };
}
