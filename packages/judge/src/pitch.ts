/**
 * Judging pitch against target notes: how a singing game, a pitch-matching drill or a play-along
 * on a monophonic instrument decides whether the player was on the note.
 *
 * A pitch track is a series of samples (time, f0 in Hz or null when unvoiced, a clarity in 0..1
 * from the estimator). A target note is a span of time and a MIDI pitch (fractional allowed). Per
 * note the judge reports how much of the note the player sounded (`voiced`), how much of it was
 * within the tolerance (`inTune`, the fraction of the note's span), the median deviation in cents
 * and a tier read from `inTune`, which is how SingStar and UltraStar score a line: by the share of
 * the note's time on pitch, not by its onset.
 *
 * Two forgiveness rules every karaoke game has, as options:
 * - `octaveFold`: a man singing a woman's part an octave down is on the note (the error is taken
 *   modulo 1200 cents, into -600..600).
 * - `toleranceCents`: the half-width of "on pitch"; UltraStar's difficulty levels are about a
 *   semitone and a half, a semitone and half a semitone either side (the research doc).
 *
 * Pure: no DOM, no clock.
 */
import { median } from '@thoremin/stats';

export interface PitchSample {
  t: number;
  /** Hz, or null when the estimator heard no pitch. */
  f0: number | null;
  /** The estimator's confidence, 0..1; samples under `minClarity` count as unvoiced. */
  clarity?: number;
}

export interface PitchNote {
  id: number;
  start: number;
  end: number;
  /** MIDI note number; fractional for a microtonal target. */
  midi: number;
}

export interface PitchJudgeOptions {
  /** Half-width of "on pitch", cents. Default 100 (a semitone either side: UltraStar's medium). */
  toleranceCents?: number;
  octaveFold?: boolean;
  /** Samples under this clarity are unvoiced. Default 0.5. */
  minClarity?: number;
  /** Tiers by the in-tune fraction of the note, best first. Default perfect 0.8, great 0.6, good 0.35. */
  tiers?: readonly { name: string; minInTune: number }[];
}

export interface PitchNoteJudgment {
  note: PitchNote;
  /** Samples that fell in the note's span. */
  samples: number;
  /** Fraction of those samples voiced. */
  voiced: number;
  /** Fraction of those samples voiced and within tolerance. */
  inTune: number;
  /** Median deviation of the voiced samples, cents (after folding); NaN when none voiced. */
  cents: number;
  /** The tier from `inTune`, or `miss`. */
  tier: string;
}

export const DEFAULT_PITCH_TIERS = [
  { name: 'perfect', minInTune: 0.8 },
  { name: 'great', minInTune: 0.6 },
  { name: 'good', minInTune: 0.35 },
] as const;

/** Hz to MIDI note number (A4 = 440 Hz = 69), fractional. */
export const midiOf = (hz: number, a4 = 440): number => 69 + 12 * Math.log2(hz / a4);

/** MIDI note number to Hz. */
export const hzOf = (midi: number, a4 = 440): number => a4 * 2 ** ((midi - 69) / 12);

/** Deviation of `hz` from `midi` in cents; folded into -600..600 when `octaveFold`. */
export function centsOff(hz: number, midi: number, octaveFold = false): number {
  const c = (midiOf(hz) - midi) * 100;
  if (!octaveFold) return c;
  return ((((c + 600) % 1200) + 1200) % 1200) - 600;
}

const voicedOf = (s: PitchSample, minClarity: number): s is PitchSample & { f0: number } =>
  s.f0 !== null && s.f0 > 0 && (s.clarity ?? 1) >= minClarity;

/** Judge one note from the samples inside its span (`start <= t < end`). */
export function judgePitchNote(note: PitchNote, samples: readonly PitchSample[], opts: PitchJudgeOptions = {}): PitchNoteJudgment {
  const tol = opts.toleranceCents ?? 100;
  const minClarity = opts.minClarity ?? 0.5;
  const tiers = opts.tiers ?? DEFAULT_PITCH_TIERS;
  const inside = samples.filter((s) => s.t >= note.start && s.t < note.end);
  const devs = inside.filter((s) => voicedOf(s, minClarity)).map((s) => centsOff(s.f0!, note.midi, opts.octaveFold));
  const n = inside.length;
  const inTune = n === 0 ? 0 : devs.filter((d) => Math.abs(d) <= tol).length / n;
  return {
    note,
    samples: n,
    voiced: n === 0 ? 0 : devs.length / n,
    inTune,
    cents: devs.length === 0 ? NaN : median(devs),
    tier: tiers.find((t) => inTune >= t.minInTune)?.name ?? 'miss',
  };
}

/** Judge every note of a line from one pitch track. */
export function judgePitchLine(notes: readonly PitchNote[], samples: readonly PitchSample[], opts: PitchJudgeOptions = {}): PitchNoteJudgment[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  return notes.map((n) => judgePitchNote(n, sorted, opts));
}

/** The note sounding at `t`, if any (the first whose span holds it). */
export const noteAt = (notes: readonly PitchNote[], t: number): PitchNote | undefined => notes.find((n) => t >= n.start && t < n.end);

/**
 * One live reading, for the visual: is the sample on the note sounding at its time? `null` when
 * no note sounds or the sample is unvoiced.
 */
export function liveReading(
  notes: readonly PitchNote[],
  sample: PitchSample,
  opts: PitchJudgeOptions = {},
): { note: PitchNote; cents: number; onPitch: boolean } | null {
  const note = noteAt(notes, sample.t);
  if (!note || !voicedOf(sample, opts.minClarity ?? 0.5)) return null;
  const cents = centsOff(sample.f0!, note.midi, opts.octaveFold);
  return { note, cents, onPitch: Math.abs(cents) <= (opts.toleranceCents ?? 100) };
}
