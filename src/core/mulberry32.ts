// Mulberry32: a tiny generator with a single 32-bit number of state. No longer used for
// dealing cards (that's sfc32, in rng.ts); kept for the bots' internal searches and the test
// network simulator, where a compact number state is convenient and fairness isn't at stake.

/** Returns a float in [0, 1) and the next state. */
export function mulberry32(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}
