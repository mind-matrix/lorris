// Deals the hidden cards to the other seats: exactly their hand counts, never breaking a known
// void, with seats chosen in proportion to the soft weights. A tiny max-flow check before each
// placement guarantees the rest can still be dealt, so sampling never dead-ends.

import { SUITS, isJoker, suitOf, type Card, type Seat } from '../../core';
import type { Knowledge } from './Knowledge';
import type { Rng } from './rng';

const JOKER_GROUP = 4;
const groupOf = (c: Card) => (isJoker(c) ? JOKER_GROUP : SUITS.indexOf(suitOf(c)!));

/**
 * Can `counts[g]` cards of each group be placed into seats with `cap[s]` room, where group g may
 * only go to seats in `seatMask[g]`? Totals are equal, so by Hall's theorem this holds exactly
 * when every set of groups fits into the seats any of them may use. With at most 5 groups that's
 * 31 subsets: far cheaper than a max-flow.
 */
function feasible(counts: number[], cap: number[], seatMask: number[]): boolean {
  for (let subset = 1; subset < 1 << counts.length; subset++) {
    let need = 0;
    let seats = 0;
    for (let g = 0; g < counts.length; g++) {
      if (subset & (1 << g)) {
        need += counts[g];
        seats |= seatMask[g];
      }
    }
    if (need === 0) continue;
    let room = 0;
    for (let i = 0; i < cap.length; i++) if (seats & (1 << i)) room += cap[i];
    if (need > room) return false;
  }
  return true;
}

/** One sampled deal: hands for every seat (the observer's own hand is kept as is). */
export function sampleHands(k: Knowledge, myHand: Card[], rng: Rng): Card[][] {
  const n = k.config.playerCount;
  const others: Seat[] = [];
  for (let s = 0; s < n; s++) if (s !== k.me) others.push(s);
  const cap = others.map((s) => k.handCounts[s]);
  // Joker can go anywhere; suits only to seats not known to be void in them.
  const ok = others.map((s) => [0, 1, 2, 3].map((g) => !k.voids[s][g]).concat([true]));
  const counts = [0, 0, 0, 0, 0];
  for (const c of k.unseen) counts[groupOf(c)]++;
  const seatMask = [0, 1, 2, 3, 4].map((g) => others.reduce((m, _, i) => (ok[i][g] ? m | (1 << i) : m), 0));
  if (!feasible(counts, cap, seatMask)) throw new Error('Knowledge is inconsistent: no deal satisfies the known voids');
  // With no known voids, any placement that respects hand sizes works: skip the checks.
  const anyVoid = ok.some((row) => row.some((x) => !x));

  const hands: Card[][] = Array.from({ length: n }, () => []);
  hands[k.me] = myHand.slice();
  const cards = rng.shuffle(k.unseen.slice());
  for (const card of cards) {
    const g = groupOf(card);
    counts[g]--;
    let totalW = 0;
    const options: { i: number; w: number }[] = [];
    for (let i = 0; i < others.length; i++) {
      if (cap[i] === 0 || !ok[i][g]) continue;
      cap[i]--;
      if (!anyVoid || feasible(counts, cap, seatMask)) {
        const w = k.weight(others[i], card);
        options.push({ i, w });
        totalW += w;
      }
      cap[i]++;
    }
    let r = rng.next() * totalW;
    let pick = options[options.length - 1];
    for (const o of options) {
      if ((r -= o.w) < 0) {
        pick = o;
        break;
      }
    }
    cap[pick.i]--;
    hands[others[pick.i]].push(card);
  }
  return hands;
}
