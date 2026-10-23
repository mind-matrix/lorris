// Asks the browser to look for a new service worker: when the app starts, whenever it comes back
// to the foreground, and every 30 minutes while it's open. Installed PWAs are rarely reloaded
// (phones resume them from the background), so the browser's own check on page load isn't enough.

export const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;
/** Don't hammer the network when the app flips in and out of the foreground. */
export const MIN_CHECK_GAP_MS = 30_000;

export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export class UpdateChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCheck = -Infinity;
  private readonly onVisibility = () => {
    if (this.doc.visibilityState === 'visible') void this.check();
  };

  constructor(
    /** Usually registration.update(). */
    private update: () => Promise<unknown>,
    private doc: VisibilitySource,
    private intervalMs = UPDATE_CHECK_INTERVAL_MS,
  ) {}

  start(): void {
    void this.check(true);
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.timer = setInterval(() => void this.check(), this.intervalMs);
  }

  stop(): void {
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Checks now. Returns false if skipped (checked very recently) or the check failed (e.g. offline). */
  async check(force = false): Promise<boolean> {
    const now = Date.now();
    if (!force && now - this.lastCheck < MIN_CHECK_GAP_MS) return false;
    this.lastCheck = now;
    try {
      await this.update();
      return true;
    } catch {
      return false; // offline, or the server hiccuped: we'll try again later
    }
  }
}
