/**
 * A vowel you can play: a voice-like source through three formant resonances (the parallel formant
 * synthesiser, Klatt 1980, reduced to what a browser's nodes do): a sawtooth at a speaking pitch
 * with a little vibrato, tilted down like a glottal pulse, into three band-pass filters at F1, F2
 * and F3 summed. Touch the chart and it sounds the vowel drawn there; slide and the formants glide.
 */
export interface Formants {
  f1: number;
  f2: number;
  f3: number;
}

/** Each formant's bandwidth (Hz) and level: F1 strongest, as in speech. */
const BANDS = [
  { bw: 80, gain: 1 },
  { bw: 110, gain: 0.55 },
  { bw: 160, gain: 0.3 },
] as const;

const GLIDE_S = 0.03;

export interface VowelSynth {
  /** Start sounding (or move to) these formants. */
  play(f: Formants): void;
  stop(): void;
  readonly sounding: boolean;
}

export function createVowelSynth(ctx: AudioContext, dest: AudioNode, { pitchHz = 130, level = 0.35 } = {}): VowelSynth {
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.value = pitchHz;
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.2;
  const depth = ctx.createGain();
  depth.gain.value = pitchHz * 0.012;
  vibrato.connect(depth).connect(src.frequency);
  // The glottal tilt: about -12 dB per octave above a few hundred hertz.
  const tilt = ctx.createBiquadFilter();
  tilt.type = 'lowpass';
  tilt.frequency.value = 600;
  tilt.Q.value = 0.5;
  src.connect(tilt);
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);
  const filters = BANDS.map((b) => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    const g = ctx.createGain();
    // A band-pass's peak is 0 dB; a narrow one passes little energy, so each is lifted by its Q.
    g.gain.value = b.gain * 6;
    tilt.connect(f).connect(g).connect(out);
    return { f, bw: b.bw };
  });
  src.start();
  vibrato.start();
  let sounding = false;
  const set = (f: Formants) => {
    const t = ctx.currentTime;
    [f.f1, f.f2, f.f3].forEach((hz, k) => {
      filters[k].f.frequency.setTargetAtTime(hz, t, GLIDE_S);
      filters[k].f.Q.setTargetAtTime(hz / filters[k].bw, t, GLIDE_S);
    });
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
