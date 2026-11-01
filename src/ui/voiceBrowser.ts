// Browser pieces for streaming voice chat: the microphone, playing voices, and a level meter.

import type { Seat } from '../core';
import { getIceServers } from '../net/iceServers';
import type { VoiceRtcDeps } from '../net/voiceRtc';
import type { VoiceAccess } from '../session/types';
import { audioContext } from './audio.svelte';

export function voiceSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function browserVoiceDeps(access: VoiceAccess): VoiceRtcDeps {
  return {
    access,
    createPeer: (config) => new RTCPeerConnection(config),
    iceServers: async () => (await getIceServers()) as RTCIceServer[],
    getMic: () =>
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: false,
      }),
    play(_seat: Seat, track: MediaStreamTrack) {
      // An <audio> element is the most reliable way to play WebRTC audio on every platform.
      const audio = new Audio();
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.srcObject = new MediaStream([track]);
      void audio.play().catch(() => {});
      return () => {
        audio.pause();
        audio.srcObject = null;
      };
    },
    keepFlowing(track: MediaStreamTrack) {
      // Muted, so it makes no sound and may always autoplay; it only keeps the audio flowing.
      const sink = new Audio();
      sink.muted = true;
      sink.autoplay = true;
      sink.setAttribute('playsinline', '');
      sink.srcObject = new MediaStream([track]);
      void sink.play().catch(() => {});
      return () => {
        sink.pause();
        sink.srcObject = null;
      };
    },
  };
}

/** Loudness (0..1) of a microphone stream, for stopping a forgotten tapped-on mic. */
export function micLevel(stream: MediaStream): { level(): number; stop(): void } {
  const ctx = audioContext();
  if (!ctx) return { level: () => 1, stop: () => {} }; // can't measure: never treat as silent
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser); // analysis only: not played back
  const buf = new Float32Array(analyser.fftSize);
  return {
    level() {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const x of buf) sum += x * x;
      return Math.sqrt(sum / buf.length);
    },
    stop: () => source.disconnect(),
  };
}
