// Records voice messages with the browser's MediaRecorder.
//
// The microphone is off by default. It opens when recording starts and closes a few seconds
// after the last recording (so a quick back-and-forth doesn't re-open it every time), so the
// phone's "microphone in use" indicator only shows around actual talking.

import { VOICE_BITRATE, VOICE_MAX_MS, VOICE_MIN_MS, type VoiceClip } from '../net/voiceMessages';

/** Keep the microphone open this long after a recording, for a fast reply. */
const KEEP_MIC_MS = 8_000;

/** Formats in order of preference. Chrome/Android/Firefox record Opus; Safari records MP4 (AAC). */
const FORMATS = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

export type MicPermission = 'unknown' | 'granted' | 'denied';

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

function pickFormat(): string | undefined {
  return FORMATS.find((f) => MediaRecorder.isTypeSupported?.(f));
}

export type StopResult = { clip: VoiceClip } | { tooShort: true } | null;

export class VoiceRecorder {
  permission: MicPermission = 'unknown';
  private stream: MediaStream | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private starting: Promise<boolean> | null = null;

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Asks for the microphone (the browser shows its permission prompt the first time). */
  async requestMic(): Promise<MicPermission> {
    try {
      await this.openMic();
      this.permission = 'granted';
      this.scheduleRelease();
    } catch {
      this.permission = 'denied';
    }
    return this.permission;
  }

  /** Starts recording. `onLimit` runs if the clip reaches the maximum length. */
  start(onLimit: () => void): Promise<boolean> {
    this.starting = (async () => {
      try {
        await this.openMic();
      } catch {
        this.permission = 'denied';
        return false;
      }
      this.permission = 'granted';
      const mimeType = pickFormat();
      const rec = new MediaRecorder(this.stream!, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: VOICE_BITRATE });
      this.chunks = [];
      rec.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
      rec.start();
      this.recorder = rec;
      this.startedAt = performance.now();
      this.maxTimer = setTimeout(onLimit, VOICE_MAX_MS);
      return true;
    })();
    return this.starting;
  }

  /** Stops recording and returns the clip (or that it was too short to send). */
  async stop(): Promise<StopResult> {
    if (this.starting && !(await this.starting)) return null;
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') return null;
    const durationMs = performance.now() - this.startedAt;
    const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
    rec.stop();
    await done;
    this.finish();
    if (durationMs < VOICE_MIN_MS) return { tooShort: true };
    const mime = rec.mimeType || this.chunks[0]?.type || 'audio/webm';
    const data = await new Blob(this.chunks, { type: mime }).arrayBuffer();
    this.chunks = [];
    return { clip: { data, mime, durationMs: Math.min(durationMs, VOICE_MAX_MS) } };
  }

  /** Stops and throws the recording away (an interrupted press). */
  async cancel(): Promise<void> {
    if (this.starting) await this.starting;
    const rec = this.recorder;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      rec.stop();
    }
    this.chunks = [];
    this.finish();
  }

  /** Closes the microphone now (leaving the game). */
  dispose(): void {
    void this.cancel();
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseMic();
  }

  private finish(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.maxTimer = null;
    this.recorder = null;
    this.starting = null;
    this.scheduleRelease();
  }

  private async openMic(): Promise<void> {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    if (this.stream?.getAudioTracks().some((t) => t.readyState === 'live')) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
  }

  private scheduleRelease(): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => this.releaseMic(), KEEP_MIC_MS);
  }

  private releaseMic(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }
}
