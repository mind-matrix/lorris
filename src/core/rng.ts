// Seeded, deterministic PRNG (mulberry32). The state is a single uint32 so it can live
// inside GameState and be serialized. Functions return [result, nextState].

export function seedFromString(text: string): number {
  // FNV-1a hash; good enough to turn a human-readable seed into a uint32.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Returns a float in [0, 1) and the next RNG state. */
export function nextRandom(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Returns an integer in [0, max) and the next RNG state. */
export function randomInt(state: number, max: number): [number, number] {
  const [r, next] = nextRandom(state);
  return [Math.floor(r * max), next];
}

/** Fisher-Yates shuffle. Returns a new array and the next RNG state. */
export function shuffle<T>(items: readonly T[], state: number): [T[], number] {
  const out = items.slice();
  let rng = state;
  for (let i = out.length - 1; i > 0; i--) {
    let j: number;
    [j, rng] = randomInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, rng];
}
