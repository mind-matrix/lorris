// Seeded, deterministic random numbers for shuffling and dealing: sfc32 ("Small Fast Counting"
// generator by Chris Doty-Humphrey, from PractRand). It has 128 bits of state, passes the
// standard statistical test batteries (PractRand, TestU01 BigCrush), and is fast in JavaScript.
//
// The state is four uint32 words [a, b, c, counter], plain JSON, so it lives inside GameState
// and is saved with it. Functions are pure: they return [result, nextState] and never mutate.
//
// Only the host (or the local device) ever holds this state: player views strip it out.

/** sfc32 state: [a, b, c, counter], each an unsigned 32-bit integer. */
export type RngState = readonly [number, number, number, number];

/** A game seed: four uint32 words (128 bits, from crypto), or a single number (tests, tools). */
export type Seed = number | readonly [number, number, number, number];

const TWO_32 = 4294967296;
/** Outputs discarded after seeding, as PractRand does, so similar seeds don't start alike. */
const WARM_UP = 12;

/** One step of SplitMix32: advances `x` by the golden ratio and mixes it. Returns [word, nextX]. */
export function splitmix32(x: number): [number, number] {
  const next = (x + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return [(z ^ (z >>> 15)) >>> 0, next];
}

/** Expands a 32-bit number into four well-mixed words with SplitMix32. */
function expand(n: number): [number, number, number, number] {
  let x = n >>> 0;
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    let w: number;
    [w, x] = splitmix32(x);
    words.push(w);
  }
  return words as [number, number, number, number];
}

/** One raw sfc32 step: returns [uint32, nextState]. */
export function nextUint32(state: RngState): [number, RngState] {
  const [a, b, c, counter] = state;
  const t = (((a + b) | 0) + counter) | 0;
  const nextA = b ^ (b >>> 9);
  const nextB = (c + (c << 3)) | 0;
  const nextC = (((c << 21) | (c >>> 11)) + t) | 0;
  return [t >>> 0, [nextA >>> 0, nextB >>> 0, nextC >>> 0, (counter + 1) >>> 0]];
}

/** Turns a seed into a ready-to-use state (numbers are expanded; then a warm-up). */
export function seedState(seed: Seed): RngState {
  let state: RngState = typeof seed === 'number' ? expand(seed) : [seed[0] >>> 0, seed[1] >>> 0, seed[2] >>> 0, seed[3] >>> 0];
  for (let i = 0; i < WARM_UP; i++) [, state] = nextUint32(state);
  return state;
}

/** A fresh 128-bit seed from the platform's cryptographic random generator. */
export function randomSeed(): [number, number, number, number] {
  const words = globalThis.crypto.getRandomValues(new Uint32Array(4));
  return [words[0], words[1], words[2], words[3]];
}

/**
 * An integer in [0, max), every value exactly equally likely, and the next state.
 * Uses rejection sampling: draws that would make some results more likely are thrown away
 * (at most a tiny fraction for the small ranges a card game needs).
 */
export function randomInt(state: RngState, max: number): [number, RngState] {
  if (!Number.isInteger(max) || max < 1 || max > TWO_32) throw new RangeError(`randomInt: bad max ${max}`);
  const limit = TWO_32 - (TWO_32 % max); // the largest multiple of max that fits in 32 bits
  let s = state;
  for (;;) {
    let u: number;
    [u, s] = nextUint32(s);
    if (u < limit) return [u % max, s];
  }
}

/** Fisher-Yates shuffle. Returns a new array and the next state. */
export function shuffle<T>(items: readonly T[], state: RngState): [T[], RngState] {
  const out = items.slice();
  let rng = state;
  for (let i = out.length - 1; i > 0; i--) {
    let j: number;
    [j, rng] = randomInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, rng];
}

/** Turns a human-readable seed (e.g. "daily-2026-10-30") into a number, with FNV-1a. */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Whether `x` is a valid sfc32 state (for loading saves). */
export function isRngState(x: unknown): x is RngState {
  return Array.isArray(x) && x.length === 4 && x.every((w) => Number.isInteger(w) && w >= 0 && w < TWO_32);
}
