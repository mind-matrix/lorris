import { describe, expect, it } from 'vitest';
import { applyAction, buildDeck, createGame, makeConfig, type GameState } from '../core';
import { HeuristicBot, RandomBot, runGame, type Bot } from '.';

/** Plain assertion: `expect` is too slow to call ~a million times. */
function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`Invariant violated: ${message}`);
}

/** State invariants that must hold after every action. */
function checkInvariants(s: GameState): void {
  const { config } = s;
  const deckSize = buildDeck(config).length;

  // Every card is somewhere exactly once: in a hand, the current round, or a finished round.
  const all = [
    ...s.hands.flat(),
    ...s.trick.plays.map((p) => p.card),
    ...s.completedTricks.flatMap((t) => t.plays.map((p) => p.card)),
  ];
  assert(all.length === deckSize, `card count ${all.length} != ${deckSize}`);
  assert(new Set(all).size === deckSize, 'duplicate cards');

  assert(s.tricksWon[0] + s.tricksWon[1] === s.completedTricks.length, 'tricksWon does not match completed rounds');
  assert(s.completedTricks.length <= config.tricksPerSet, 'too many rounds in a set');

  if (s.phase === 'playing') {
    // Everyone has the same number of cards, minus one for those who already played this round.
    const base = config.cardsPerPlayer - s.completedTricks.length;
    const played = new Set(s.trick.plays.map((p) => p.seat));
    s.hands.forEach((h, seat) => assert(h.length === base - (played.has(seat) ? 1 : 0), `seat ${seat} has ${h.length} cards`));
  }

  // Scores always equal the sum of each team's set results.
  const totals = [0, 0];
  for (const r of s.setHistory) totals[r.bidTeam] += r.delta;
  assert(s.scores[0] === totals[0] && s.scores[1] === totals[1], 'scores do not match set history');

  if (s.phase === 'gameOver') {
    assert(s.winner !== null && s.scores[s.winner] >= config.targetScore, 'winner below target score');
    assert(s.turn === null, 'turn set after game over');
  } else {
    assert(s.turn !== null, 'nobody to act');
    assert(s.scores[0] < config.targetScore && s.scores[1] < config.targetScore, 'target reached but game not over');
  }
}

/** Lets Vitest's worker breathe between games (bots resolve instantly, so the loop never yields otherwise). */
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('simulation', () => {
  it('1,000 heuristic bot games (4 and 6 players) all finish with invariants intact', async () => {
    let totalSets = 0;
    for (let game = 0; game < 1000; game++) {
      const n = game % 2 === 0 ? 4 : 6;
      const seed = 1_000_003 * game + 17;
      const bots: Bot[] = Array.from({ length: n }, () => new HeuristicBot());
      const { state, finished } = await runGame(makeConfig(n), seed, bots, { onState: checkInvariants });
      expect(finished, `game ${game} (seed ${seed}) did not finish`).toBe(true);
      totalSets += state.setHistory.length;
      await yieldToEventLoop();
    }
    expect(totalSets).toBeGreaterThan(1000);
  });

  it('100 games with random bots mixed in never crash or break invariants', async () => {
    for (let game = 0; game < 100; game++) {
      const n = game % 2 === 0 ? 4 : 6;
      // Random bots explore odd moves (wild calls, strange discards) the heuristic never tries.
      const bots: Bot[] = Array.from({ length: n }, (_, seat) =>
        (seat + game) % 3 === 0 ? new HeuristicBot() : new RandomBot(game * 31 + seat),
      );
      // Teams of random bots rarely make their calls, so these games may not reach 32; cap them.
      await runGame(makeConfig(n), game, bots, { maxActions: 3000, onState: checkInvariants });
      await yieldToEventLoop();
    }
  });

  it('replaying a game from its seed and action list reproduces the final state', async () => {
    for (const n of [4, 6]) {
      const bots: Bot[] = Array.from({ length: n }, (_, seat) => (seat % 2 ? new HeuristicBot() : new RandomBot(seat)));
      const run = await runGame(makeConfig(n), 4242, bots, { maxActions: 2000 });
      let s = createGame(makeConfig(n), 4242);
      for (const { seat, action } of run.actions) {
        const r = applyAction(s, seat, action);
        if (!r.ok) throw new Error(r.error.message);
        s = r.state;
      }
      expect(s).toEqual(run.state);
    }
  });
});
