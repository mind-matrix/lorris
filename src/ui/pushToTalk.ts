// The mic button's gestures. Both work on the same button:
// - Press and hold: talk while held; release to stop.
// - Tap: start talking and keep going; tap again to stop.
// An interrupted press (pointer cancelled, app hidden) stops talking.
//
// Talking starts the moment the button goes down (no delay before a hold). On release, the
// press length decides: a short press was a tap, so talking continues; a long one was a
// hold, so it stops.

/** Presses shorter than this are taps; longer ones are holds. */
export const HOLD_MS = 350;

export interface PushToTalkActions {
  /** Start talking (`latched`: it was a tap, so it continues after release). */
  start(latched: boolean): void;
  /** Stop talking. */
  stop(): void;
  /** The press was interrupted: stop talking. */
  abort(): void;
}

export class PushToTalk {
  private state: 'idle' | 'pressed' | 'latched' | 'stopping' = 'idle';
  private downAt = 0;

  constructor(
    private actions: PushToTalkActions,
    private now: () => number = () => performance.now(),
  ) {}

  /** Button (or Space/Enter) went down. */
  down(): void {
    if (this.state === 'latched') {
      // Tapped on earlier: this press sends. Ignore its release.
      this.state = 'stopping';
      this.actions.stop();
      return;
    }
    if (this.state !== 'idle') return;
    this.state = 'pressed';
    this.downAt = this.now();
    this.actions.start(false);
  }

  /** Button (or key) released. */
  up(): void {
    if (this.state === 'stopping') {
      this.state = 'idle';
      return;
    }
    if (this.state !== 'pressed') return;
    if (this.now() - this.downAt >= HOLD_MS) {
      this.state = 'idle';
      this.actions.stop();
    } else {
      this.state = 'latched';
      this.actions.start(true); // keeps recording, now marked as tapped on
    }
  }

  /** The press was interrupted (pointer cancelled, app hidden, focus lost): discard. */
  cancel(): void {
    if (this.state === 'pressed' || this.state === 'latched') this.actions.abort();
    this.state = 'idle';
  }

  /** Recording ended elsewhere (hit the length limit, or couldn't start): forget the press. */
  reset(): void {
    this.state = 'idle';
  }
}
