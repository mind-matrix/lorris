// Voice messages: short recorded clips, sent when the player lets go of the mic button (or taps
// it off). They travel like the game itself: player -> host -> everyone else at the table. The
// host stamps each clip with the sender's seat from its own records, so nobody can speak as
// someone else, and it enforces the limits below before forwarding anything.
//
// Nothing is sent unless someone is recording, so voice costs relay bandwidth only for the
// clips themselves: about 2 KB per second of speech.

import type { Seat } from '../core';

export const VOICE_PROTOCOL = 1;
/** Longest clip. Recording stops (and sends) automatically at this length. */
export const VOICE_MAX_MS = 15_000;
/** Shorter clips are treated as accidental presses and dropped. */
export const VOICE_MIN_MS = 400;
/** Recording bitrate: clear speech, about 30 KB for a full 15-second clip. */
export const VOICE_BITRATE = 16_000;
/** Largest clip accepted (generous for 15 s at 16 kbps plus container overhead). */
export const VOICE_MAX_BYTES = 48 * 1024;
/** Per player: at most one clip per this many ms... */
export const VOICE_MIN_INTERVAL_MS = 1_000;
/** ...and at most this many per minute. */
export const VOICE_MAX_PER_MINUTE = 20;
const MAX_SEAT = 5;

export interface VoiceClip {
  data: ArrayBuffer;
  /** Audio format as recorded, e.g. "audio/webm;codecs=opus" or "audio/mp4". */
  mime: string;
  durationMs: number;
}

export interface ReceivedClip extends VoiceClip {
  /** Who said it, as stamped by the host. */
  seat: Seat;
}

/** Audio formats browsers record; anything else is refused. */
const MIME = /^audio\/(webm|ogg|mp4|aac|mpeg)(;\s*codecs="?[a-z0-9.,\s-]+"?)?$/i;

function validClipBody(data: ArrayBuffer, mime: unknown, durationMs: unknown): mime is string {
  return (
    data instanceof ArrayBuffer &&
    data.byteLength > 0 &&
    data.byteLength <= VOICE_MAX_BYTES &&
    typeof mime === 'string' &&
    mime.length <= 64 &&
    MIME.test(mime) &&
    typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs >= VOICE_MIN_MS &&
    durationMs <= VOICE_MAX_MS + 1_000
  );
}

/** A player's clip arriving at the host: metadata { v, mime, durationMs }. Any seat claim is ignored. */
export function parseOutgoing(data: ArrayBuffer, meta: unknown): VoiceClip | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;
  if (m.v !== VOICE_PROTOCOL || !validClipBody(data, m.mime, m.durationMs)) return null;
  return { data, mime: m.mime as string, durationMs: m.durationMs as number };
}

/** A clip forwarded by the host: metadata { v, seat, mime, durationMs }. */
export function parseForwarded(data: ArrayBuffer, meta: unknown): ReceivedClip | null {
  const clip = parseOutgoing(data, meta);
  if (!clip) return null;
  const seat = (meta as Record<string, unknown>).seat;
  if (!Number.isInteger(seat) || (seat as number) < 0 || (seat as number) > MAX_SEAT) return null;
  return { ...clip, seat: seat as Seat };
}

export const outgoingMeta = (clip: VoiceClip) => ({ v: VOICE_PROTOCOL, mime: clip.mime, durationMs: Math.round(clip.durationMs) });
export const forwardedMeta = (clip: VoiceClip, seat: Seat) => ({ ...outgoingMeta(clip), seat });

/** Per-player limit on how often clips may be sent. */
export class VoiceRateLimiter {
  private sent: number[] = [];

  /** Records a clip now if allowed; returns false if it should be refused. */
  allow(now: number): boolean {
    this.sent = this.sent.filter((t) => now - t < 60_000);
    const last = this.sent.at(-1);
    if (last !== undefined && now - last < VOICE_MIN_INTERVAL_MS) return false;
    if (this.sent.length >= VOICE_MAX_PER_MINUTE) return false;
    this.sent.push(now);
    return true;
  }
}
