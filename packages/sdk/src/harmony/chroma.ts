/**
 * Chord from sound (H8 of #613, second part; `docs/design/harmonic-layers.md` §6.5: "a guitarist's
 * open strings and a singer's hum become the harmony"): a microphone's spectrum folded into a
 * 12-bin chroma (how much of each pitch class is sounding), then matched against chord templates.
 *
 * - `chromaFromSpectrum`: each spectrum bin's energy goes to the pitch class nearest its
 *   frequency, weighted by how close it is to that semitone (a bin between two semitones counts
 *   little), over a band that skips the rumble below and the bright overtones above.
 * - `matchChord`: the cosine of the chroma with each chord's template (the 24 major and minor
 *   triads, and the four sevenths that share their tones, which win only when the seventh is
 *   really there); the best, its score and its margin over the runner-up, so a caller commits
 *   only a clear reading. No sound, or a sound that fits no chord, reads nothing.
 *
 * Pure: the AnalyserNode is the app half. No new dependency.
 */
import { QUALITIES, type QualityId } from './qualities';
import type { Chord } from './chord';

export interface ChromaOptions {
  sampleRate: number;
  /** The FFT size the spectrum came from (its bins are sampleRate / fftSize apart). */
  fftSize: number;
  /** The band read, Hz (default: A1 to about C7). */
  minHz?: number;
  maxHz?: number;
}

/** The energy of each pitch class (C first), 0..1 (the loudest is 1), and the total energy. */
export interface Chroma {
  bins: number[];
  energy: number;
}

export function chromaFromSpectrum(magnitudes: ArrayLike<number>, { sampleRate, fftSize, minHz = 55, maxHz = 2100 }: ChromaOptions): Chroma {
  const bins = new Array<number>(12).fill(0);
  let energy = 0;
  const hzPerBin = sampleRate / fftSize;
  const lo = Math.max(1, Math.floor(minHz / hzPerBin));
  const hi = Math.min(magnitudes.length - 1, Math.ceil(maxHz / hzPerBin));
  for (let k = lo; k <= hi; k++) {
    const m = magnitudes[k];
    if (!(m > 0)) continue;
    const midi = 69 + 12 * Math.log2((k * hzPerBin) / 440);
    const nearest = Math.round(midi);
    // Close to a semitone counts fully, half-way between two counts nothing.
    const closeness = Math.cos(Math.PI * (midi - nearest));
    const e = m * m * closeness * closeness;
    bins[((nearest % 12) + 12) % 12] += e;
    energy += e;
  }
  const top = Math.max(...bins);
  return { bins: top > 0 ? bins.map((b) => b / top) : bins, energy };
}

/** The qualities matched: the triads, and the sevenths a player strums or a band holds. */
export const CHROMA_QUALITIES: readonly QualityId[] = ['maj', 'min', '7', 'maj7', 'min7'];

export interface ChordMatch {
  chord: Chord;
  /** Cosine of the chroma with the chord's template, 0..1. */
  score: number;
  /** The score over the next best chord's (a clear reading has a margin). */
  margin: number;
}

const cosine = (a: readonly number[], b: readonly number[]): number => {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < 12; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
};

/** A seventh beats its triad only by this much (a triad's own overtones are not a seventh). */
const SEVENTH_PENALTY = 0.04;

export function matchChord(chroma: Chroma, { minEnergy = 1e-6, qualities = CHROMA_QUALITIES }: { minEnergy?: number; qualities?: readonly QualityId[] } = {}): ChordMatch | null {
  if (!(chroma.energy > minEnergy)) return null;
  const scored: { chord: Chord; score: number }[] = [];
  for (let root = 0; root < 12; root++) {
    for (const quality of qualities) {
      const t = new Array<number>(12).fill(0);
      for (const iv of QUALITIES[quality].intervals) t[(root + iv) % 12] = 1;
      const penalty = QUALITIES[quality].intervals.length > 3 ? SEVENTH_PENALTY : 0;
      scored.push({ chord: { root, quality }, score: cosine(chroma.bins, t) - penalty });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  return { chord: best.chord, score: best.score, margin: best.score - (next?.score ?? 0) };
}
