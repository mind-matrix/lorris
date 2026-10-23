import { Rng } from '../ismcts/rng';

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

/** Percentile bootstrap 95% CI of the mean (paired data: pass the per-deal differences). */
export function bootstrapMean(values: number[], seed = 1, resamples = 2000): Interval {
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : 0;
  if (n < 2) return { mean, lo: mean, hi: mean, n };
  const rng = new Rng(seed);
  const means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[rng.int(n)];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return { mean, lo: means[Math.floor(0.025 * resamples)], hi: means[Math.ceil(0.975 * resamples) - 1], n };
}

/** Wilson 95% interval for a proportion k/n. */
export function wilson(k: number, n: number): Interval {
  if (n === 0) return { mean: 0, lo: 0, hi: 0, n };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { mean: p, lo: c - h, hi: c + h, n };
}
