import { describe, expect, it } from 'vitest';
import { HeuristicBot, RandomBot, runGame } from '..';
import { SUITS, createGame, getPlayerView, makeConfig, suitOf, type Card, type GameState } from '../../core';
import { act, playingGame, playTrick } from '../../core/testUtils';
import { buildKnowledge } from './Knowledge';
import { sampleHands } from './determinize';
import { Rng } from './rng';

const H = SUITS.indexOf('H');
const S = SUITS.indexOf('S');

describe('Knowledge: voids and the Joker', () => {
  const hands: Card[][] = [
    ['7H', 'AD', 'KC'],
    ['AH', 'JK', '8S'],
    ['9D', '9C', '10C'], // no hearts
    ['8H', 'AC', 'QS'],
  ];

  it('a player who does not follow the led suit is void in it', () => {
    let s = playingGame({ hands, trump: 'S', leader: 0 });
    s = playTrick(s, ['7H', 'AH', '9D', '8H']);
    const k = buildKnowledge(getPlayerView(s, 0));
    expect(k.voids[2][H]).toBe(true);
    expect(k.voids[1][H]).toBe(false);
    expect(k.voids[3][H]).toBe(false);
  });

  it('playing the Joker instead of following proves nothing', () => {
    let s = playingGame({ hands, trump: 'S', leader: 0 });
    s = act(s, 0, { type: 'PLAY_CARD', card: '7H' });
    s = act(s, 1, { type: 'PLAY_CARD', card: 'JK' });
    const k = buildKnowledge(getPlayerView(s, 0));
    expect(k.voids[1][H]).toBe(false);
    expect(k.jokerStatus).toBe('played');
  });

  it('when the Joker is led, not playing trump proves no trumps', () => {
    let s = playingGame({ hands, trump: 'S', leader: 1 });
    s = act(s, 1, { type: 'PLAY_CARD', card: 'JK' });
    s = act(s, 2, { type: 'PLAY_CARD', card: '9C' }); // no spades
    s = act(s, 3, { type: 'PLAY_CARD', card: 'QS' }); // had to play trump
    const k = buildKnowledge(getPlayerView(s, 0));
    expect(k.voids[2][S]).toBe(true);
    expect(k.voids[3][S]).toBe(false);
  });

  it('tracks where the Joker is from my point of view', () => {
    const s = playingGame({ hands, trump: 'S', leader: 0 });
    expect(buildKnowledge(getPlayerView(s, 1)).jokerStatus).toBe('mine');
    expect(buildKnowledge(getPlayerView(s, 0)).jokerStatus).toBe('unseen');
    expect(buildKnowledge(getPlayerView(s, 0)).unseen).toContain('JK');
  });

  it('calls and the trump choice tilt the weights; passes lower them', () => {
    const base = playingGame({ hands, trump: 'H', leader: 0, contract: { seat: 1, value: 6 } });
    const s: GameState = { ...base, bids: [{ seat: 1, bid: 6 }, { seat: 2, bid: 'pass' }, { seat: 3, bid: 'pass' }, { seat: 0, bid: 'pass' }] };
    const k = buildKnowledge(getPlayerView(s, 0));
    expect(k.weight(1, 'KH')).toBeGreaterThan(2); // high call + chose hearts
    expect(k.weight(1, 'JK')).toBeGreaterThan(1);
    expect(k.weight(2, 'AS')).toBeLessThan(1); // passed
    expect(k.weight(2, '7C')).toBe(1); // low card: no signal
    expect(k.callingTeam).toBe(1);
    expect(k.myTeam).toBe(0);
  });
});

/** Collects views from real bot games, at every decision point, with the true state alongside. */
async function views(players: number, games: number) {
  const out: { state: GameState; seat: number }[] = [];
  for (let g = 0; g < games; g++) {
    const bots = Array.from({ length: players }, (_, i) => (i % 2 ? new HeuristicBot() : new RandomBot(g * 10 + i)));
    await runGame(makeConfig(players), 1000 + g, bots, {
      maxActions: 400,
      onState: (s) => {
        if (s.turn !== null && (s.phase === 'playing' || s.phase === 'bidding')) out.push({ state: s, seat: s.turn });
      },
    });
  }
  return out;
}

describe('Knowledge never contradicts the truth, and every sampled deal is consistent', () => {
  for (const players of [4, 6]) {
    it(`${players} players: thousands of samples respect hand counts, played cards and voids`, async () => {
      const points = await views(players, 6);
      expect(points.length).toBeGreaterThan(500);
      const rng = new Rng(42);
      let samples = 0;
      for (const { state, seat } of points) {
        const view = getPlayerView(state, seat);
        const k = buildKnowledge(view);
        // Inference is never wrong: real hands never hold a suit we think someone is void in.
        state.hands.forEach((hand, s) => {
          for (const c of hand) {
            const suit = suitOf(c);
            if (suit) expect(k.voids[s][SUITS.indexOf(suit)], `seat ${s} holds ${c} but was marked void`).toBe(false);
          }
        });
        for (let r = 0; r < 2; r++) {
          const hands = sampleHands(k, view.myHand, rng);
          samples++;
          expect(hands[seat]).toEqual(view.myHand);
          hands.forEach((h, s) => expect(h.length).toBe(view.handCounts[s]));
          const dealt = hands.flat();
          expect(new Set(dealt).size).toBe(dealt.length);
          for (const c of dealt) expect(k.played.has(c)).toBe(false);
          expect(dealt.filter((c) => !view.myHand.includes(c)).sort()).toEqual([...k.unseen].sort());
          hands.forEach((h, s) => {
            for (const c of h) {
              const suit = suitOf(c);
              if (suit && s !== seat) expect(k.voids[s][SUITS.indexOf(suit)]).toBe(false);
            }
          });
        }
      }
      expect(samples).toBeGreaterThan(1000);
    });
  }

  it('is deterministic for a seed', async () => {
    const [{ state, seat }] = (await views(4, 1)).slice(20);
    const view = getPlayerView(state, seat);
    const k = buildKnowledge(view);
    expect(sampleHands(k, view.myHand, new Rng(7))).toEqual(sampleHands(k, view.myHand, new Rng(7)));
  });

  it('soft weights shift the samples: a strong caller gets the Joker more often', () => {
    // The size of the shift depends on the deal (about +2 points on average, measured over many),
    // so check it across several real deals where seat 0 (the observer) doesn't hold the Joker.
    const shifts: number[] = [];
    for (let seed = 1; shifts.length < 8; seed++) {
      const deal = createGame(makeConfig(4), seed);
      if (deal.hands[0].includes('JK')) continue;
      const s: GameState = { ...deal, phase: 'playing', trump: 'H', contract: { seat: 1, value: 8, forced: false }, bids: [{ seat: 1, bid: 8 }], turn: 1 };
      const share = (state: GameState) => {
        const view = getPlayerView(state, 0);
        const k = buildKnowledge(view);
        const rng = new Rng(3);
        let n = 0;
        for (let i = 0; i < 3000; i++) if (sampleHands(k, view.myHand, rng)[1].includes('JK')) n++;
        return n / 3000;
      };
      const noSignal = share({ ...s, bids: [], contract: { seat: 2, value: 4, forced: true } });
      expect(noSignal).toBeGreaterThan(0.3); // about a third each with no information
      expect(noSignal).toBeLessThan(0.38);
      shifts.push(share(s) - noSignal);
    }
    for (const shift of shifts) expect(shift).toBeGreaterThan(0);
    expect(shifts.reduce((a, b) => a + b) / shifts.length).toBeGreaterThan(0.01);
  });
});
