// How good a finished Set is for a team: its estimated chance of winning the match afterwards.
// Uses the engine's real scoring (calls, the doubled first loss, defenders never scoring), then
// looks at how close each team is to the target, so the bot is careful or bold as the score demands.

import type { GameState, Team } from '../../core';
import { SEARCH_CONFIG } from './config';

export function matchUtility(s: GameState, team: Team, k = SEARCH_CONFIG.rewardSteepness): number {
  if (s.winner !== null) return s.winner === team ? 1 : 0;
  const target = s.config.targetScore;
  const need = (t: Team) => target - s.scores[t];
  const x = k * (need((1 - team) as Team) - need(team));
  return 1 / (1 + Math.exp(-x));
}

/** For the rounds-maximizing continuation: the share of rounds the team won. */
export function roundsUtility(s: GameState, team: Team): number {
  return s.tricksWon[team] / s.config.tricksPerSet;
}
