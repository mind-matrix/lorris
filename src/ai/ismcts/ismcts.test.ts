import { describe, expect, it } from 'vitest';
import { HeuristicBot, runGame } from '..';
import { getLegalActions, getPlayerView, makeConfig, type GameState } from '../../core';
import { botSpec } from '../tournament/bots';
import { duplicateSet } from '../tournament/match';
import { IsmctsBot } from './IsmctsBot';

const tiny = { deterministic: true, maxIterations: 8 };

/** Mid-Set positions from real games, at decisions with real choices. */
async function positions(players: number, games = 3): Promise<GameState[]> {
  const out: GameState[] = [];
  for (let g = 0; g < games; g++) {
    await runGame(makeConfig(players), 40 + g, Array.from({ length: players }, () => new HeuristicBot()), {
      maxActions: 300,
      onState: (s) => {
        if (s.turn !== null && getLegalActions(s, s.turn).length > 1) out.push(s);
      },
    });
  }
  return out;
}

describe('ISMCTS bot', () => {
  it('only ever plays legal actions, bidding included, across 1,200 simulated Sets (4 and 6 players)', async () => {
    // duplicateSet throws on any illegal action; every Set is played twice (seats swapped).
    const spec = botSpec(`ismcts:${tiny.maxIterations}`);
    for (const players of [4, 6]) {
      for (let seed = 0; seed < 300; seed++) await duplicateSet(players, seed, spec, botSpec('heuristic'));
    }
  }, 300_000);

  it('is deterministic for a seed (iteration-capped)', async () => {
    const [s] = (await positions(4, 1)).slice(10);
    const view = getPlayerView(s, s.turn!);
    const legal = getLegalActions(s, s.turn!);
    const a = new IsmctsBot(9, { budget: { deterministic: true, maxIterations: 300 } });
    const b = new IsmctsBot(9, { budget: { deterministic: true, maxIterations: 300 } });
    expect(a.decide(view, legal)).toMatchObject({ action: b.decide(view, legal).action, visits: b.last!.visits });
  });

  it('never peeks: changing hidden cards (and the hidden RNG) without changing its view changes nothing', async () => {
    let checked = 0;
    for (const players of [4, 6]) {
      for (const s of (await positions(players, 2)).filter((_, i) => i % 7 === 0)) {
        const me = s.turn!;
        // Shuffle every other player's cards among themselves (same hand sizes), and change the RNG.
        const others = s.hands.flatMap((h, seat) => (seat === me ? [] : h)).reverse();
        let k = 0;
        const hands = s.hands.map((h, seat) => (seat === me ? h : h.map(() => others[k++])));
        const altered: GameState = { ...s, hands, rng: [s.rng[0] ^ 0x5bd1e995, s.rng[1], s.rng[2], s.rng[3]].map((w) => w >>> 0) as unknown as GameState['rng'] };
        expect(altered.hands).not.toEqual(s.hands);
        const view1 = getPlayerView(s, me);
        const view2 = getPlayerView(altered, me);
        expect(view2).toEqual(view1); // the bot's input is identical...
        const legal = getLegalActions(s, me);
        const budget = { deterministic: true, maxIterations: 150 };
        const r1 = new IsmctsBot(4, { budget }).decide(view1, legal);
        const r2 = new IsmctsBot(4, { budget }).decide(view2, legal);
        expect(r2.action).toEqual(r1.action); // ...so its decision is too
        expect(r2.visits).toEqual(r1.visits);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  }, 120_000);

  it('returns a legal move even with a zero time budget', async () => {
    const [s] = (await positions(6, 1)).slice(5);
    const legal = getLegalActions(s, s.turn!);
    const r = new IsmctsBot(1, { budget: { deterministic: false, timeMs: 0, maxIterations: 1000 } }).decide(getPlayerView(s, s.turn!), legal);
    expect(legal).toContainEqual(r.action);
  });
});
