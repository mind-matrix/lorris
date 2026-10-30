// Halloween-season background music: an original, slow music-box tune in D minor over a low
// organ drone, synthesized live with the Web Audio API (no audio files to download).
//
// Notes are scheduled a fraction of a second ahead on the audio clock, a standard technique
// that keeps the timing steady even when the page is busy, while using very little CPU.

/** Beats per minute. Each bar is 8 eighth notes. */
const BPM = 72;
const EIGHTH = 60 / BPM / 2;

/** One bar: the music-box melody (MIDI note numbers, null = rest) and the bass root. */
export interface Bar {
  melody: (number | null)[];
  bass: number;
}

/** An 8-bar loop: Dm, Dm, Bb, A, Dm, Gm, A, Dm. */
export const SCORE: readonly Bar[] = [
  { melody: [74, 77, 81, 77, 85, 81, 77, 76], bass: 38 }, // Dm
  { melody: [74, 77, 81, 86, 85, 81, 76, 73], bass: 38 }, // Dm (rising)
  { melody: [70, 74, 77, 74, 82, 77, 74, 77], bass: 34 }, // Bb
  { melody: [69, 73, 76, 81, 79, 76, 73, 69], bass: 33 }, // A
  { melody: [74, 77, 81, 77, 86, 81, 77, 74], bass: 38 }, // Dm
  { melody: [67, 70, 74, 70, 79, 74, 70, 74], bass: 31 }, // Gm
  { melody: [69, 73, 76, 73, 81, 79, 76, 73], bass: 33 }, // A
  { melody: [74, null, 81, null, 74, null, null, null], bass: 38 }, // Dm, rings out
];

/** Overall volume: background level, well under the sound effects. */
const VOLUME = 0.16;
const LOOKAHEAD_S = 0.3;
const TICK_MS = 100;

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class HalloweenMusic {
  private master: GainNode;
  private echoOut: AudioNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private level = 1;

  constructor(private ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // A touch of echo makes the music box sound like it's in a big, empty room.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = EIGHTH * 1.5;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.master.connect(ctx.destination);
    this.master.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(ctx.destination);
    this.echoOut = tone;
  }

  /** Fades in and starts playing. */
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

  /** Fades out, then releases everything. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.25);
    const master = this.master;
    const echo = this.echoOut;
    setTimeout(() => {
      master.disconnect();
      echo.disconnect();
    }, 2000);
  }

  private schedule(): void {
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD_S) {
      const bar = SCORE[Math.floor(this.step / 8) % SCORE.length];
      const beat = this.step % 8;
      const note = bar.melody[beat];
      if (note !== null) this.musicBox(note, this.nextTime);
      if (beat === 0) this.organ(bar.bass, this.nextTime, EIGHTH * 8);
      this.nextTime += EIGHTH;
      this.step = (this.step + 1) % (SCORE.length * 8);
    }
  }

  /** A plucked, bell-like note that fades away. */
  private musicBox(midi: number, t: number): void {
    const { ctx } = this;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0005, t + 1.4);
    env.connect(this.master);
    for (const [mult, type, gain] of [
      [1, 'sine', 1],
      [4, 'sine', 0.12], // the metallic "tine" overtone
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq(midi) * mult;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(env);
      osc.start(t);
      osc.stop(t + 1.5);
    }
  }

  /** A soft, slowly swelling organ drone: the root with its fifth. */
  private organ(midi: number, t: number, dur: number): void {
    const { ctx } = this;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.22, t + dur * 0.4);
    env.gain.linearRampToValueAtTime(0, t + dur + 0.2);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 500;
    env.connect(tone);
    tone.connect(this.master);
    for (const m of [midi, midi + 7, midi + 12]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq(m);
      osc.detune.value = m === midi ? -4 : 4; // a slight waver
      osc.connect(env);
      osc.start(t);
      osc.stop(t + dur + 0.3);
    }
  }
}
