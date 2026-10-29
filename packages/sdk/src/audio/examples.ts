/**
 * Taught examples of struck sounds, and the models derived from them.
 *
 * The SSOT of what the player taught is the RAW AUDIO around each onset (a snippet), never a
 * feature vector: the features depend on the analysis window, and the sound mapper uses two
 * windows (a short one that sounds at once, a long one that corrects it), and the window is a
 * setting the player may change. So a snippet is kept, and every model is derived from the
 * snippets for whatever windows are in force (the categorizer's rule: "samples are the SSOT,
 * the model derived").
 *
 * A snippet runs from {@link SNIPPET.preMs} before its onset (room for the background window
 * that `./features.ts` subtracts, plus the pre-roll) to {@link SNIPPET.postMs} after it (the
 * longest analysis window a mapper may use).
 */
import { createAttackFeatures, type AttackFeatures } from './features';
import { trainSoundModel, type SoundModel, type TrainSoundOptions } from './classifier';
import { median } from '@thoremin/stats';

export const SNIPPET = { preMs: 30, postMs: 40 } as const;

export interface SoundSnippet {
  label: string;
  sampleRate: number;
  /** Index of the onset inside `pcm`. */
  onset: number;
  pcm: Float32Array;
}

/** Linear resampling (a snippet taught at one rate, played in a context at another). */
export function resampleLinear(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return pcm;
  const n = Math.max(1, Math.round((pcm.length * to) / from));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * from) / to;
    const a = Math.floor(x);
    const f = x - a;
    out[i] = (pcm[a] ?? 0) * (1 - f) + (pcm[a + 1] ?? pcm[a] ?? 0) * f;
  }
  return out;
}

/** A snippet at `sampleRate` (resampled when it was taught at another). */
export function snippetAt(s: SoundSnippet, sampleRate: number): SoundSnippet {
  if (s.sampleRate === sampleRate) return s;
  return { ...s, sampleRate, onset: Math.round((s.onset * sampleRate) / s.sampleRate), pcm: resampleLinear(s.pcm, s.sampleRate, sampleRate) };
}

export interface SnippetFeatureOptions {
  preRoll: number;
  subtractTail: boolean;
}

/** The attack features of a snippet, as the mapper computes them live. */
export function snippetFeatures(s: SoundSnippet, features: AttackFeatures, o: SnippetFeatureOptions): Float64Array {
  const w = features.window;
  const start = s.onset - o.preRoll;
  const out = new Float64Array(features.size);
  return features.compute(s.pcm, start, out, o.subtractTail ? start - w : undefined);
}

/** The peak of a snippet's attack (the first `window` samples from the pre-roll). */
export function snippetPeak(s: SoundSnippet, window: number, preRoll: number): number {
  let peak = 0;
  for (let i = Math.max(0, s.onset - preRoll); i < Math.min(s.pcm.length, s.onset - preRoll + window); i++) peak = Math.max(peak, Math.abs(s.pcm[i]));
  return peak;
}

export interface MapperModelOptions extends TrainSoundOptions {
  sampleRate: number;
  /** The fast window, ms, and the refining one (0 = no refinement). */
  windowMs: number;
  refineMs: number;
  preRoll: number;
  subtractTail: boolean;
  shape?: 'bands' | 'mfcc';
}

/** What a sound mapper is configured with: its models and the taught taps' typical peak. */
export interface MapperModels {
  fast: SoundModel;
  final: SoundModel | null;
  refPeak: number;
}

const windowOf = (ms: number, sampleRate: number) => Math.max(16, Math.round((ms / 1000) * sampleRate));

/** Train the mapper's models from snippets (any sample rate). Null with no snippets. */
export function trainMapperModels(snippets: readonly SoundSnippet[], o: MapperModelOptions): MapperModels | null {
  if (snippets.length === 0) return null;
  const at = snippets.map((s) => snippetAt(s, o.sampleRate));
  const train = (ms: number): SoundModel => {
    const f = createAttackFeatures({ sampleRate: o.sampleRate, window: windowOf(ms, o.sampleRate), shape: o.shape ?? 'mfcc' });
    return trainSoundModel(
      at.map((s) => ({ label: s.label, features: snippetFeatures(s, f, o) })),
      { ...o, weights: o.weights ?? f.weights },
    );
  };
  const peaks = at.map((s) => snippetPeak(s, windowOf(o.windowMs, o.sampleRate), o.preRoll));
  return { fast: train(o.windowMs), final: o.refineMs > o.windowMs ? train(o.refineMs) : null, refPeak: Math.max(1e-3, median(peaks)) };
}
