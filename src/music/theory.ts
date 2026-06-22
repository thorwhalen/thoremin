/**
 * Pure music-theory helpers — the "tonal guidance" toolkit.
 *
 * These functions turn raw continuous control values (e.g. a hand's normalized
 * x position) into musically meaningful pitches by snapping toward the notes of
 * a chosen scale. They are deliberately dependency-free (plain math, no `tonal`,
 * no DOM) so they are trivially unit-testable and reusable everywhere.
 *
 * MIDI note numbers are the common currency: 60 = middle C, +12 per octave,
 * and `midiToFreq(69) === 440`.
 */

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Scale interval sets (semitones from the root), keyed by a stable id. */
export const SCALE_TYPES = {
  major: { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  pentatonic: { name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  minorPentatonic: { name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  minorHarmonic: { name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  blues: { name: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
  chromatic: { name: 'Chromatic', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
} as const;

export type ScaleTypeId = keyof typeof SCALE_TYPES;

/** Standard equal-temperament conversion. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Inverse of {@link midiToFreq} (continuous MIDI; not rounded). */
export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** Name a MIDI note, e.g. 60 -> "C4". */
export function midiToName(midi: number): string {
  const r = Math.round(midi);
  return `${NOTES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}

export interface ScaleSpec {
  /** Pitch class of the root, 0 = C ... 11 = B. */
  root: number;
  type: ScaleTypeId;
  /** Number of octaves the playable range spans. */
  octaves: number;
  /** Octave of the lowest note (MIDI octave; 3 is a comfortable mid range). */
  baseOctave: number;
}

export const DEFAULT_SCALE: ScaleSpec = {
  root: 0,
  type: 'major',
  octaves: 2,
  baseOctave: 3,
};

/**
 * Build the ascending list of MIDI notes for a scale spec, inclusive of the
 * octave-completing top note. e.g. C major, 2 octaves, base octave 3 ->
 * [48, 50, 52, 53, 55, 57, 59, 60, ... 72].
 */
export function generateScale(spec: ScaleSpec): number[] {
  const { type, octaves, baseOctave, root } = spec;
  const intervals = SCALE_TYPES[type].intervals;
  const baseNote = (baseOctave + 1) * 12 + root;
  const scale: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const interval of intervals) scale.push(baseNote + o * 12 + interval);
  }
  scale.push(baseNote + octaves * 12);
  return [...new Set(scale)].sort((a, b) => a - b);
}

/**
 * Where each scale note sits along the normalized control axis (x in 0..1),
 * matching how {@link magneticPitch} maps x → MIDI (linear across the scale's
 * MIDI span). Used to draw a pitch/scale guide showing the player where each
 * note is. Returns ascending x; empty for an empty scale.
 */
export function scaleGuide(scale: number[]): { midi: number; x: number }[] {
  if (scale.length === 0) return [];
  const min = scale[0];
  const spanMidi = scale[scale.length - 1] - min;
  return scale.map((midi) => ({ midi, x: spanMidi > 0 ? (midi - min) / spanMidi : 0 }));
}

/**
 * Map a normalized control value `x` in [0, 1] to a (possibly fractional) MIDI
 * note, snapping toward scale notes by a `magnetism` amount.
 *
 *  - `magnetism = 0`  : free continuous glide across the scale's MIDI range.
 *  - `magnetism = 1`  : hard snap to the nearest scale note (stepped).
 *  - in between       : an eased pull toward the nearer of the two surrounding
 *                       scale notes, giving expressive "in-tune-ish" portamento.
 *
 * This generalizes the magnetic pitch mapper from the original Thoremin synth,
 * but returns MIDI (not Hz) so it is pure and composable. Pair with
 * {@link midiToFreq} at the synthesis stage.
 */
export function magneticPitch(x: number, scale: number[], magnetism: number): number {
  if (scale.length === 0) return 60;
  if (scale.length === 1) return scale[0];

  const xc = clamp01(x);
  const midiMin = scale[0];
  const midiMax = scale[scale.length - 1];
  const v = midiMin + xc * (midiMax - midiMin); // continuous MIDI

  const p = clamp01(magnetism);
  if (p === 0) return v;

  // Find the two scale notes bracketing v.
  let lo = scale[0];
  let hi = scale[scale.length - 1];
  for (let i = 0; i < scale.length - 1; i++) {
    if (v >= scale[i] && v <= scale[i + 1]) {
      lo = scale[i];
      hi = scale[i + 1];
      break;
    }
  }
  if (lo === hi) return lo;

  const t = (v - lo) / (hi - lo); // 0..1 between lo and hi
  let tMapped: number;
  if (p === 1) {
    tMapped = t < 0.5 ? 0 : 1; // hard snap
  } else {
    // Push t toward 0 or 1 with an exponent that sharpens as p -> 1.
    const u = 2 * t - 1; // -1..1
    const sign = u >= 0 ? 1 : -1;
    tMapped = 0.5 + 0.5 * sign * Math.pow(Math.abs(u), 1 - p);
  }
  return lo + tMapped * (hi - lo);
}

/** Snap a continuous MIDI value to the nearest note actually in the scale. */
export function nearestScaleNote(midi: number, scale: number[]): number {
  if (scale.length === 0) return Math.round(midi);
  let best = scale[0];
  let bestDist = Math.abs(midi - best);
  for (const n of scale) {
    const d = Math.abs(midi - n);
    if (d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Linearly map `x` from [inMin, inMax] to [outMin, outMax], clamped to the
 * output range. The fundamental "knob" transform of the mapping layer.
 */
export function rangeMap(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  const t = (x - inMin) / (inMax - inMin);
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  return outMin + tc * (outMax - outMin);
}
