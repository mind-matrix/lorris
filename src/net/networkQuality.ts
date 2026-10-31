// Is this device's network too slow for voice messages right now? Measured in the background
// from information the device already has, so it sends nothing (and nothing through a relay):
// - the browser's Network Information API, where available (connection type and estimates);
// - WebRTC statistics of the existing game connection (round-trip time, available bandwidth),
//   which the browser keeps up to date anyway.
//
// A reading must be slow (or fine) twice in a row before the status changes, so a single bad
// moment doesn't make the mic button flicker.

import type { LinkStats } from './transport';

export interface NetworkSample {
  online: boolean;
  /** From the Network Information API: 'slow-2g', '2g', '3g' or '4g'. */
  effectiveType?: string;
  /** From the Network Information API: estimated download speed. */
  downlinkMbps?: number;
  /** From the game connection's statistics. */
  link?: LinkStats | null;
}

/** Thresholds above which voice messages would arrive too late or fail. */
export const SLOW = {
  rttMs: 800,
  outgoingKbps: 32,
  downlinkMbps: 0.15,
  effectiveTypes: ['slow-2g', '2g'],
};

export function isSlow(s: NetworkSample): boolean {
  if (!s.online) return true;
  if (s.effectiveType && SLOW.effectiveTypes.includes(s.effectiveType)) return true;
  if (typeof s.downlinkMbps === 'number' && s.downlinkMbps > 0 && s.downlinkMbps < SLOW.downlinkMbps) return true;
  if (s.link?.rttMs != null && s.link.rttMs > SLOW.rttMs) return true;
  if (s.link?.outgoingKbps != null && s.link.outgoingKbps < SLOW.outgoingKbps) return true;
  return false;
}

/** How many readings in a row it takes to change status. */
const CONFIRM = 2;
export const SAMPLE_EVERY_MS = 5_000;

export class NetworkQuality {
  private slow = false;
  private streak = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(slow: boolean) => void>();

  constructor(private sample: () => Promise<NetworkSample>) {}

  get isSlow(): boolean {
    return this.slow;
  }

  subscribe(listener: (slow: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.slow);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), SAMPLE_EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Takes one reading now (also called on the timer). */
  async check(): Promise<void> {
    let reading: boolean;
    try {
      reading = isSlow(await this.sample());
    } catch {
      return; // couldn't measure: keep the current status
    }
    if (reading === this.slow) {
      this.streak = 0;
      return;
    }
    if (++this.streak < CONFIRM) return;
    this.streak = 0;
    this.slow = reading;
    for (const l of this.listeners) l(this.slow);
  }
}
