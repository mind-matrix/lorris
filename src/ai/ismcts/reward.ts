// How good a finished Set is for a team: its estimated chance of winning the match afterwards.
// Uses the engine's real scoring (calls, the doubled first loss, defenders never scoring), then
// looks at how close each team is to the target, so the bot is careful or bold as the score demands.

import type { GameState, Team } from '../../core';
import { SEARCH_CONFIG } from './config';

export function matchUtility(s: GameState, team: Team, k = SEARCH_CONFIG.rewardSteepness, w = SEARCH_CONFIG.progressWeight): number {
  if (s.winner !== null) return s.winner === team ? 1 : 0;
  const target = s.config.targetScore;
  const need = (t: Team) => target - s.scores[t];
  const mine = Math.max(0, need(team));
  const theirs = Math.max(0, need((1 - team) as Team));
  // A race: the lead matters relative to how many points are still to be won.
  const winChance = 1 / (1 + Math.exp((-k * (theirs - mine)) / Math.sqrt(Math.max(4, mine + theirs))));
  // Our own progress toward the target (0 at -target or below, 1 at the target): keeps every point
  // worth something even when the win chance is already near 0 or 1.
  const progress = Math.min(1, Math.max(0, (s.scores[team] + target) / (2 * target)));
  return (1 - w) * winChance + w * progress;
}

/** For the rounds-maximizing continuation: the share of rounds the team won. */
export function roundsUtility(s: GameState, team: Team): number {
  return s.tricksWon[team] / s.config.tricksPerSet;
}
