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
 *   really there); a chord whose third is not really sounding is not offered (a power chord's
 *   root has a fifth harmonic on the major third, a whisper of it), and the margin is taken
 *   against the best chord that is a DIFFERENT chord (a triad and its own seventh light the same
 *   cell and must not cancel each other), so a caller commits only a clear reading.
 * - `createLevelGate`: is anything sounding? A running noise floor (the room, learned while it
 *   is quiet and rising slowly) and a margin above it, so a guitar across the room counts and the
 *   room itself does not, whatever the microphone's gain.
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

/** The triad under each matched quality: what tells two readings apart as different chords. */
const TRIAD: Partial<Record<QualityId, QualityId>> = { maj: 'maj', '7': 'maj', maj7: 'maj', min: 'min', min7: 'min' };
/** A chord's third must sound at least this much of the loudest pitch class to be offered. */
const MIN_THIRD = 0.15;

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

export function matchChord(chroma: Chroma, { minEnergy = 0, qualities = CHROMA_QUALITIES, minThird = MIN_THIRD }: { minEnergy?: number; qualities?: readonly QualityId[]; minThird?: number } = {}): ChordMatch | null {
  if (!(chroma.energy > minEnergy) || chroma.bins.every((b) => b === 0)) return null;
  const scored: { chord: Chord; score: number }[] = [];
  for (let root = 0; root < 12; root++) {
    for (const quality of qualities) {
      const third = QUALITIES[quality].intervals[1];
      if (chroma.bins[(root + third) % 12] < minThird) continue;
      const t = new Array<number>(12).fill(0);
      for (const iv of QUALITIES[quality].intervals) t[(root + iv) % 12] = 1;
      const penalty = QUALITIES[quality].intervals.length > 3 ? SEVENTH_PENALTY : 0;
      scored.push({ chord: { root, quality }, score: cosine(chroma.bins, t) - penalty });
    }
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const same = (c: Chord) => c.root === best.chord.root && TRIAD[c.quality] === TRIAD[best.chord.quality];
  const rival = scored.find((s) => !same(s.chord));
  return { chord: best.chord, score: best.score, margin: best.score - (rival?.score ?? 0) };
}

export interface LevelGateOptions {
  /** How far above the noise floor a sound must be, as an energy ratio (10 = 10 dB). */
  ratio?: number;
  /** How fast the floor creeps up toward a steady level, per second (a fraction of the gap). */
  rise?: number;
  /** The quietest floor assumed (a digital silence has no floor to learn). */
  minFloor?: number;
}

export interface LevelGate {
  /** One reading: its energy and the seconds since the last; whether something is sounding. */
  push(energy: number, dt: number): boolean;
  reset(): void;
}

export function createLevelGate({ ratio = 10, rise = 0.05, minFloor = 1e-10 }: LevelGateOptions = {}): LevelGate {
  let floor = Infinity;
  return {
    push(energy, dt) {
      const e = Number.isFinite(energy) && energy > 0 ? energy : 0;
      // The floor falls at once to anything quieter, and rises slowly toward a lasting level, so a
      // held chord is not learned as the room within its few seconds.
      if (e < floor) floor = Math.max(minFloor, e);
      else floor += (e - floor) * Math.min(1, rise * Math.max(0, dt));
      return e > Math.max(minFloor, floor) * ratio;
    },
    reset() {
      floor = Infinity;
    },
  };
}
