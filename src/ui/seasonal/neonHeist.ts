// GTA VI launch week: the "Joker heist" moment. When the Joker is played, every player sees a
// short neon overlay (sirens, a spinning Joker, stars, falling cash) with an original synth
// siren sting. Timing lives here so tests can check it against the bots' pause.

/** How long the overlay stays up. Must match LAUNCH_JOKER_MS in src/seasonal/launchWeek.ts. */
export const HEIST_MS = 4200;
/** With reduced motion: a still card and caption, shown briefly. */
export const HEIST_REDUCED_MS = 1800;

/**
 * An original two-tone synth siren that rises into a bright chord stab. Quiet, about 1.6 s.
 * Returns a function that silences it early.
 */
export function playHeistSting(ctx: AudioContext): () => void {
  const t0 = ctx.currentTime + 0.02;
  const out = ctx.createGain();
  out.gain.value = 0.07;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2200;
  out.connect(tone);
  tone.connect(ctx.destination);

  // The siren: a square wave sliding between two pitches, three times.
  const siren = ctx.createOscillator();
  siren.type = 'square';
  const f = siren.frequency;
  f.setValueAtTime(620, t0);
  for (let i = 0; i < 3; i++) {
    f.linearRampToValueAtTime(930, t0 + i * 0.36 + 0.18);
    f.linearRampToValueAtTime(620, t0 + i * 0.36 + 0.36);
  }
  const sirenEnv = ctx.createGain();
  sirenEnv.gain.setValueAtTime(0, t0);
  sirenEnv.gain.linearRampToValueAtTime(0.6, t0 + 0.05);
  sirenEnv.gain.setValueAtTime(0.6, t0 + 1.0);
  sirenEnv.gain.linearRampToValueAtTime(0, t0 + 1.1);
  siren.connect(sirenEnv);
  sirenEnv.connect(out);
  siren.start(t0);
  siren.stop(t0 + 1.15);

  // The stab: a detuned saw chord (A minor add 9), quick attack, ringing out.
  const stabAt = t0 + 1.1;
  const stabEnv = ctx.createGain();
  stabEnv.gain.setValueAtTime(0, stabAt);
  stabEnv.gain.linearRampToValueAtTime(1, stabAt + 0.01);
  stabEnv.gain.exponentialRampToValueAtTime(0.001, stabAt + 0.9);
  stabEnv.connect(out);
  const oscs: OscillatorNode[] = [siren];
  for (const midi of [57, 64, 69, 71, 72]) {
    for (const detune of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      o.detune.value = detune;
      o.connect(stabEnv);
      o.start(stabAt);
      o.stop(stabAt + 1);
      oscs.push(o);
    }
  }
  return () => {
    for (const o of oscs) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
    out.disconnect();
  };
}
