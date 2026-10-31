// Plays incoming voice messages one at a time, in arrival order, and says whose is playing
// (so their seat can glow).

import type { Seat } from '../core';
import type { ReceivedClip } from '../net/voiceMessages';

/** If messages pile up (a very chatty table), the oldest waiting ones are dropped. */
const MAX_WAITING = 4;

export class ClipPlayer {
  private queue: ReceivedClip[] = [];
  private current: { audio: HTMLAudioElement; url: string } | null = null;

  constructor(
    /** Whose message is playing now (null when quiet). */
    private onSpeaker: (seat: Seat | null) => void,
    /** A message in a format this device can't play. */
    private onUnplayable: (seat: Seat) => void,
  ) {}

  enqueue(clip: ReceivedClip): void {
    this.queue.push(clip);
    while (this.queue.length > MAX_WAITING) this.queue.shift();
    if (!this.current) this.next();
  }

  stop(): void {
    this.queue = [];
    this.end();
    this.onSpeaker(null);
  }

  private next(): void {
    const clip = this.queue.shift();
    if (!clip) {
      this.onSpeaker(null);
      return;
    }
    const audio = new Audio();
    const base = clip.mime.split(';')[0];
    if (!audio.canPlayType(clip.mime) && !audio.canPlayType(base)) {
      this.onUnplayable(clip.seat);
      this.next();
      return;
    }
    const url = URL.createObjectURL(new Blob([clip.data], { type: clip.mime }));
    this.current = { audio, url };
    audio.setAttribute('playsinline', '');
    audio.src = url;
    const done = () => {
      if (this.current?.audio !== audio) return;
      this.end();
      this.next();
    };
    audio.onended = done;
    audio.onerror = done;
    this.onSpeaker(clip.seat);
    audio.play().catch(done);
  }

  private end(): void {
    if (!this.current) return;
    this.current.audio.onended = null;
    this.current.audio.onerror = null;
    this.current.audio.pause();
    URL.revokeObjectURL(this.current.url);
    this.current = null;
  }
}
