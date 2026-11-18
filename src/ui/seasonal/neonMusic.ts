// GTA VI launch week background music: an original, laid-back synthwave loop (A minor, 96 BPM)
// with a pulsing bass, a warm pad, a soft arpeggio and a light beat. Synthesized live with the
// Web Audio API (no audio files), scheduled slightly ahead on the audio clock like the
// Halloween music, so it stays steady while using very little CPU.

const BPM = 96;
const EIGHTH = 60 / BPM / 2;

/** One bar: chord tones (MIDI) for the pad and arpeggio, and the bass root. */
export interface NeonBar {
  chord: [number, number, number];
  bass: number;
}

/** A 4-bar loop: Am, F, C, G. */
export const NEON_SCORE: readonly NeonBar[] = [
  { chord: [69, 72, 76], bass: 45 }, // Am
  { chord: [65, 69, 72], bass: 41 }, // F
  { chord: [67, 72, 76], bass: 48 }, // C
  { chord: [67, 71, 74], bass: 43 }, // G
];

/** The arpeggio's pattern over a bar's chord (index into the chord, +3 = an octave up). */
const ARP = [0, 1, 2, 4, 2, 1, 3, 1];

const VOLUME = 0.13;
const LOOKAHEAD_S = 0.3;
const TICK_MS = 100;

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class NeonMusic {
  private master: GainNode;
  private noise: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private level = 1;

  constructor(private ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // A gentle low shelf cut keeps phone speakers from rattling.
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highpass';
    shelf.frequency.value = 45;
    this.master.connect(shelf);
    shelf.connect(ctx.destination);
    // White noise, made once, for the snare and hats.
    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  start(): void {
    if (this.timer) return;
    const now = this.ctx.currentTime;
    this.nextTime = now + 0.1;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(VOLUME * this.level, now + 2);
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  /** 1 = full background level; lower to play more quietly (e.g. during a game). */
  setLevel(level: number): void {
    this.level = level;
    if (this.timer) this.master.gain.setTargetAtTime(VOLUME * level, this.ctx.currentTime, 0.6);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.25);
    const master = this.master;
    setTimeout(() => master.disconnect(), 2000);
  }

  private schedule(): void {
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD_S) {
      const bar = NEON_SCORE[Math.floor(this.step / 8) % NEON_SCORE.length];
      const beat = this.step % 8;
      const t = this.nextTime;
      if (beat === 0) this.pad(bar.chord, t, EIGHTH * 8);
      this.bass(bar.bass + (beat % 2 ? 12 : 0), t); // octave-jumping eighth notes
      const i = ARP[beat];
      this.arp(bar.chord[i % 3] + (i >= 3 ? 12 : 0) + 12, t);
      if (beat === 0 || beat === 4) this.kick(t);
      if (beat === 2 || beat === 6) this.snare(t);
      if (beat % 2 === 1) this.hat(t);
      this.nextTime += EIGHTH;
      this.step = (this.step + 1) % (NEON_SCORE.length * 8);
    }
  }

  private envelope(t: number, peak: number, attack: number, release: number): GainNode {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0005, t + attack + release);
    return env;
  }

  private bass(midi: number, t: number): void {
    const { ctx } = this;
    const env = this.envelope(t, 0.5, 0.005, EIGHTH * 0.9);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(900, t);
    tone.frequency.exponentialRampToValueAtTime(220, t + EIGHTH);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq(midi);
    osc.connect(tone);
    tone.connect(env);
    env.connect(this.master);
    osc.start(t);
    osc.stop(t + EIGHTH + 0.05);
  }

  /** A warm, slow-swelling chord: two detuned saws per note through a soft filter. */
  private pad(chord: readonly number[], t: number, dur: number): void {
    const { ctx } = this;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.12, t + dur * 0.35);
    env.gain.linearRampToValueAtTime(0, t + dur + 0.15);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1100;
    env.connect(tone);
    tone.connect(this.master);
    for (const m of chord) {
      for (const detune of [-9, 9]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq(m);
        osc.detune.value = detune;
        osc.connect(env);
        osc.start(t);
        osc.stop(t + dur + 0.2);
      }
    }
  }

  private arp(midi: number, t: number): void {
    const { ctx } = this;
    const env = this.envelope(t, 0.12, 0.004, 0.25);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq(midi);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private kick(t: number): void {
    const { ctx } = this;
    const env = this.envelope(t, 0.7, 0.002, 0.28);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  private noiseHit(t: number, peak: number, release: number, type: BiquadFilterType, hz: number): void {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = hz;
    const env = this.envelope(t, peak, 0.002, release);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    src.start(t);
    src.stop(t + release + 0.02);
  }

  private snare(t: number): void {
    this.noiseHit(t, 0.22, 0.18, 'bandpass', 1800);
  }

  private hat(t: number): void {
    this.noiseHit(t, 0.06, 0.04, 'highpass', 7000);
  }
}
