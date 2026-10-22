import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimiter';

describe('rate limiter', () => {
  it('allows a burst, then limits to the sustained rate', () => {
    let now = 0;
    const limiter = new RateLimiter(10, 5, () => now);
    const burst = Array.from({ length: 8 }, () => limiter.take());
    expect(burst).toEqual([true, true, true, true, true, false, false, false]);
    now += 100; // one token per 100ms at 10/s
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);
    now += 10_000;
    expect(Array.from({ length: 6 }, () => limiter.take()).filter(Boolean)).toHaveLength(5);
  });
});
