/**
 * Token bucket: allows short bursts but caps the sustained rate. One per peer.
 * The clock is injected so tests can control time.
 */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private perSecond: number,
    private burst: number,
    private now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.last = now();
  }

  /** Returns true if a message may be processed now. */
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
