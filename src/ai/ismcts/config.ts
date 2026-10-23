// The ISMCTS bot's tuning knobs. Internal only: players never see or choose these.

export interface SearchBudget {
  /** Stop after this long (ms). Ignored when `deterministic` is set. */
  timeMs: number;
  /** Never run more iterations than this. */
  maxIterations: number;
  /** Tests and tournaments: use only the iteration cap, so results are reproducible. */
  deterministic: boolean;
}

export const SEARCH_BUDGET: SearchBudget = { timeMs: 500, maxIterations: 4000, deterministic: false };

export const SEARCH_CONFIG = {
  /** UCB1 exploration constant (rewards are in [0, 1]). */
  exploration: 0.7,
  /**
   * Reward shape: a Set's result is scored as the chance of winning the match,
   * sigmoid(k * (points the opponents still need - points we still need)).
   */
  rewardSteepness: 0.12,
};

/** How strongly calls and the trump choice tilt where hidden cards are dealt in samples. */
export const KNOWLEDGE_CONFIG = {
  /** Extra weight per call level (4 = level 1) on a caller's high cards (Q, K, A) and trumps. */
  callerHighCardPerLevel: 0.15,
  /** Extra weight per call level on a caller holding the Joker. */
  callerJokerPerLevel: 0.25,
  /** The player who chose trump: weight multiplier on that suit. */
  trumpChooserTrump: 2.0,
  /** Players who passed: multiplier on their high cards and the Joker. */
  passerHighCard: 0.85,
  passerJoker: 0.8,
};
