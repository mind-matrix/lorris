// Voice chat for one online session, shared by the lobby and the table: the round mic button's
// state, who's talking, and the network check. Created once per online session (in App), so
// the voice connection and the microphone permission carry over from the lobby into the game
// and back (playing again).
//
// Hold the mic to talk, or tap to start and tap again to stop. Voices stream live through the
// host. Nothing is sent while nobody talks, the microphone is only open around talking, and the
// button greys out while the network is too slow.

import type { Seat } from '../core';
import { NetworkQuality } from '../net/networkQuality';
import { VoiceGuest, VoiceHost } from '../net/voiceRtc';
import type { OnlineSession, VoiceAccess } from '../session/types';
import { sampleNetwork } from './networkSample';
import { browserVoiceDeps, micLevel, voiceSupported } from './voiceBrowser';

/** A tapped-on mic switches off after this long with no sound. */
const LATCHED_SILENCE_MS = 20_000;
const SILENCE_LEVEL = 0.02;

export class VoiceChat {
  /** Talking right now. */
  talking = $state(false);
  /** Tapped on: keeps talking until tapped again. */
  latched = $state(false);
  elapsedMs = $state(0);
  /** No microphone access. */
  blocked = $state(false);
  /** Bumped to make the button forget a press in progress. */
  resetToken = $state(0);
  /** The network is too slow for voice right now. */
  slow = $state(false);
  /** Seats talking right now (other players; see `isSpeaking` for everyone). */
  talkingSeats = $state<ReadonlySet<Seat>>(new Set());

  /** Where short messages go ("Microphone ready…"). The screen on show sets this. */
  onmessage: (text: string) => void = () => {};

  private voice: VoiceHost | VoiceGuest;
  private quality: NetworkQuality;
  private permission: 'unknown' | 'granted' | 'denied' = 'unknown';
  private timer: ReturnType<typeof setInterval> | null = null;
  private meter: { level(): number; stop(): void } | null = null;
  private toldAboutTableTalk = false;
  private offs: (() => void)[] = [];

  constructor(private access: VoiceAccess) {
    const v = access.isHost ? new VoiceHost(browserVoiceDeps(access)) : new VoiceGuest(browserVoiceDeps(access));
    this.voice = v;
    if (v instanceof VoiceGuest) {
      v.onForcedStop = () => {
        this.endTalkUi();
        this.onmessage('Voice turns off after 2 minutes of talking. Tap to talk again.');
      };
    }
    this.offs.push(v.subscribe((s) => (this.talkingSeats = s.talking)));

    this.quality = new NetworkQuality(() =>
      sampleNetwork(async () => {
        const link = access.link;
        if (!access.isHost) {
          const host = access.hostPeer();
          return host ? link.linkStats(host) : null;
        }
        // The host talks to everyone: typical round trip, and the weakest outgoing link.
        const all = (await Promise.all([...access.seatedPeers().keys()].map((p) => link.linkStats(p)))).filter((x) => x !== null);
        if (all.length === 0) return null;
        const rtts = all.map((x) => x!.rttMs).filter((r): r is number => r !== null).sort((a, b) => a - b);
        const outs = all.map((x) => x!.outgoingKbps).filter((k): k is number => k !== null);
        return { rttMs: rtts.length ? rtts[Math.floor(rtts.length / 2)] : null, outgoingKbps: outs.length ? Math.min(...outs) : null };
      }),
    );
    this.offs.push(this.quality.subscribe((slow) => (this.slow = slow)));
    const onVisibility = () => (document.visibilityState === 'hidden' ? this.quality.stop() : this.quality.start());
    document.addEventListener('visibilitychange', onVisibility);
    this.offs.push(() => document.removeEventListener('visibilitychange', onVisibility));
    this.quality.start();
  }

  /** This device's seat (null for spectators, and newcomers not seated yet). */
  mySeat(): Seat | null {
    return this.access.mySeat();
  }

  /** Whether a seat is talking right now (this device's own seat included). */
  isSpeaking(seat: Seat): boolean {
    return this.talkingSeats.has(seat) || (this.talking && seat === this.access.mySeat());
  }

  start = async (latched: boolean): Promise<void> => {
    const v = this.voice;
    if (latched) {
      this.latched = true; // a tap: keep talking until the next tap
      return;
    }
    if (this.permission !== 'granted') {
      // First press: just ask for the microphone. Talking starts with the next press.
      this.resetToken++;
      await this.askForMic();
      return;
    }
    this.talking = true;
    this.latched = false;
    this.elapsedMs = 0;
    const startedAt = performance.now();
    let lastSound = startedAt;
    this.timer = setInterval(() => {
      const now = performance.now();
      this.elapsedMs = now - startedAt;
      // Tapped on and forgotten: switch off after a long silence.
      const stream = v.micStream();
      if (stream && !this.meter) this.meter = micLevel(stream);
      if (!this.meter || this.meter.level() > SILENCE_LEVEL) lastSound = now;
      if (this.latched && now - lastSound > LATCHED_SILENCE_MS) {
        this.stop();
        this.onmessage('Mic off after 20 seconds of silence. Tap to talk again.');
      }
    }, 250);
    const ok = await v.startTalking();
    if (!ok) {
      this.endTalkUi();
      this.resetToken++;
      this.blocked = true;
      this.onmessage('No microphone access, so you can hear others but not talk.');
      return;
    }
    if (!this.talking) {
      // Released before the microphone was ready.
      v.stopTalking();
      return;
    }
    if (!this.toldAboutTableTalk) {
      this.toldAboutTableTalk = true;
      this.onmessage('Everyone at the table hears you. No talking about your cards!');
    }
  };

  stop = (): void => {
    this.endTalkUi();
    this.voice.stopTalking();
    this.resetToken++;
  };

  /** Pressed while greyed out: explain why (or try the microphone again). */
  unavailable = async (): Promise<void> => {
    if (this.blocked) {
      // Maybe they've allowed the microphone in settings since.
      if (!(await this.askForMic(false))) this.onmessage("Microphone access is blocked. Allow it in your browser's site settings to talk.");
      return;
    }
    if (this.slow) this.onmessage('Your connection is slow right now, so voice is paused.');
  };

  private async askForMic(sayNo = true): Promise<boolean> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of s.getTracks()) t.stop();
      this.permission = 'granted';
      this.blocked = false;
      this.onmessage('Microphone ready. Hold the mic to talk, or tap to start and tap again to stop.');
      return true;
    } catch {
      this.permission = 'denied';
      this.blocked = true;
      if (sayNo) this.onmessage('No microphone access, so you can hear others but not talk.');
      return false;
    }
  }

  private endTalkUi(): void {
    this.talking = false;
    this.latched = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.meter?.stop();
    this.meter = null;
  }

  dispose(): void {
    this.endTalkUi();
    for (const off of this.offs) off();
    this.offs = [];
    this.quality.stop();
    this.voice.dispose();
    this.talkingSeats = new Set();
  }
}

/** Voice chat for an online session, or null where the connection or browser can't carry voice. */
export function createVoiceChat(session: OnlineSession): VoiceChat | null {
  const access = session.voice();
  if (!access || !voiceSupported()) return null;
  return new VoiceChat(access);
}
