import { describe, expect, it } from 'vitest';
import { NetworkQuality, isSlow, type NetworkSample } from './networkQuality';

const good: NetworkSample = { online: true, effectiveType: '4g', downlinkMbps: 10, link: { rttMs: 80, outgoingKbps: 900 } };

describe('isSlow', () => {
  it('a normal connection is fine, and missing information is not held against it', () => {
    expect(isSlow(good)).toBe(false);
    expect(isSlow({ online: true })).toBe(false); // Safari: no Network Information API, stats not ready
    expect(isSlow({ online: true, link: { rttMs: null, outgoingKbps: null } })).toBe(false);
    expect(isSlow({ online: true, downlinkMbps: 0 })).toBe(false); // 0 means "unknown" in some browsers
  });

  it('offline, 2G, very low bandwidth or a long round trip count as slow', () => {
    expect(isSlow({ ...good, online: false })).toBe(true);
    expect(isSlow({ ...good, effectiveType: '2g' })).toBe(true);
    expect(isSlow({ ...good, effectiveType: 'slow-2g' })).toBe(true);
    expect(isSlow({ ...good, downlinkMbps: 0.1 })).toBe(true);
    expect(isSlow({ ...good, link: { rttMs: 1200, outgoingKbps: 900 } })).toBe(true);
    expect(isSlow({ ...good, link: { rttMs: 80, outgoingKbps: 20 } })).toBe(true);
  });
});

describe('NetworkQuality', () => {
  function monitor(samples: NetworkSample[]) {
    let i = 0;
    const q = new NetworkQuality(async () => samples[Math.min(i++, samples.length - 1)]);
    const seen: boolean[] = [];
    q.subscribe((s) => seen.push(s));
    return { q, seen };
  }
  const slow = { ...good, link: { rttMs: 2000, outgoingKbps: 10 } };

  it('needs two slow readings in a row to switch to slow, and two good ones to switch back', async () => {
    const { q, seen } = monitor([slow, good, slow, slow, good, slow, good, good]);
    for (let i = 0; i < 8; i++) await q.check();
    expect(seen).toEqual([false, true, false]);
  });

  it('a failed measurement keeps the current status', async () => {
    const q = new NetworkQuality(async () => {
      throw new Error('stats unavailable');
    });
    await q.check();
    await q.check();
    expect(q.isSlow).toBe(false);
  });
});
