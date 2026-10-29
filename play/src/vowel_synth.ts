/**
 * A vowel you can play: the cascade formant synthesiser of `@thoremin/games/formant_synth` in a
 * browser's nodes. A sawtooth at a speaking pitch with a little vibrato runs through five low-pass
 * biquads in series (each a two-pole resonator: F1 to F3 from the vowel, F4 and F5 fixed), and an
 * output gain keeps every vowel equally loud. Touch the chart and it sounds the vowel drawn there;
 * slide and the resonators glide.
 */
import { cascadeOf, levelFor, qDb } from '@thoremin/games/formant_synth';

export interface Formants {
  f1: number;
  f2: number;
  f3: number;
}

const GLIDE_S = 0.03;

export interface VowelSynth {
  /** Start sounding (or move to) these formants. */
  play(f: Formants): void;
  stop(): void;
  readonly sounding: boolean;
}

export function createVowelSynth(ctx: AudioContext, dest: AudioNode, { pitchHz = 130, level = 0.25, voiceScale = 1 } = {}): VowelSynth {
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.value = pitchHz;
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.2;
  const depth = ctx.createGain();
  depth.gain.value = pitchHz * 0.012;
  vibrato.connect(depth).connect(src.frequency);
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);
  const level0 = ctx.createGain();
  // Five resonators in series: the source, then F1 .. F5, then the loudness gain, then out.
  const filters = cascadeOf({ f1: 500, f2: 1500, f3: 2500 }, voiceScale).map((r) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = r.hz;
    f.Q.value = qDb(r);
    return f;
  });
  filters.reduce<AudioNode>((prev, f) => prev.connect(f), src).connect(level0).connect(out);
  src.start();
  vibrato.start();
  let sounding = false;
  const set = (f: Formants) => {
    const t = ctx.currentTime;
    const rs = cascadeOf(f, voiceScale);
    rs.forEach((r, k) => {
      filters[k].frequency.setTargetAtTime(r.hz, t, GLIDE_S);
      filters[k].Q.setTargetAtTime(qDb(r), t, GLIDE_S);
    });
    level0.gain.setTargetAtTime(levelFor(rs, pitchHz), t, GLIDE_S);
  };
  return {
    play(f) {
      set(f);
      if (!sounding) out.gain.setTargetAtTime(level, ctx.currentTime, 0.02);
      sounding = true;
    },
    stop() {
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      sounding = false;
    },
    get sounding() {
      return sounding;
    },
  };
}
