/**
 * A chord chart from a score (H9 of #613, `docs/design/harmonic-layers.md` §6.6, "conduct a chord
 * chart"): the piece reduced to the chord its notes spell, beat by beat, as a chain of segments a
 * conductor's beat walks along. Each step (a beat, or two, or a bar) reads the pitched notes that
 * carry its harmony, across the parts (those sounding at its start or held for half of it; a short
 * passing or neighbour tone inside it is not the chord), as one chord (`chordOfPitchClasses`: any inversion, the
 * reading that explains the most notes); a step that spells no chord (a unison, a rest, a bare
 * fifth) keeps the chord before it. Consecutive steps on the same chord are one segment.
 *
 * Pure: no DAG, no audio.
 */
import { chordOfPitchClasses } from '@thoremin/sdk/harmony/chord_in';
import type { Chord } from '@thoremin/sdk/harmony/chord';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';

export interface ChartSegment {
  /** The beat it starts on (quarter notes from the start of the piece). */
  beat: number;
  chord: Chord;
}

export interface ChordChart {
  segments: ChartSegment[];
  /** The chart's length in beats (the piece's, rounded up to a whole step). */
  lengthBeats: number;
}

const same = (a: Chord, b: Chord) => a.root === b.root && a.quality === b.quality;
/** Onsets within this of a step's start count as on it (a float sum of beats). */
const EPS = 1e-6;

/** Charts already read, per piece and step: a piece is reduced once, never on every tick. */
const CACHE = new WeakMap<object, Map<number, ChordChart>>();

/** The piece's chords, a segment per change (`step`: beats read as one chord). One sweep over the
 *  notes in onset order with the set sounding (O(n log n + steps x sounding)): a quartet movement
 *  of thousands of beats and notes reads in milliseconds. */
export function chartOfScore(doc: Pick<ScoreDoc, 'parts' | 'lengthBeats'>, { step = 1 }: { step?: number } = {}): ChordChart {
  const cached = CACHE.get(doc)?.get(step);
  if (cached) return cached;
  const notes = doc.parts
    .filter((p) => !p.percussion)
    .flatMap((p) => p.notes)
    .slice()
    .sort((a, b) => a.start - b.start);
  const span = Math.max(step, Math.ceil(doc.lengthBeats / step) * step);
  const segments: ChartSegment[] = [];
  let next = 0;
  let active: typeof notes = [];
  for (let b = 0; b < span; b += step) {
    while (next < notes.length && notes[next].start < b + step) active.push(notes[next++]);
    active = active.filter((n) => n.start + n.duration > b);
    // The notes that make the harmony: sounding at the step's start, or held for half of it; a
    // short note inside the step is a passing or neighbour tone, not the chord.
    const sounding = active
      .filter((n) => (n.start <= b + EPS && n.start + n.duration > b + EPS) || Math.min(n.start + n.duration, b + step) - Math.max(n.start, b) >= step / 2 - EPS)
      .map((n) => n.midi);
    const chord = chordOfPitchClasses(sounding);
    if (!chord) continue;
    const last = segments[segments.length - 1];
    if (!last || !same(last.chord, chord)) segments.push({ beat: b, chord });
  }
  const chart = { segments, lengthBeats: span };
  const perStep = CACHE.get(doc) ?? new Map<number, ChordChart>();
  perStep.set(step, chart);
  CACHE.set(doc, perStep);
  return chart;
}

/** The segment in force at `beat` (in the piece's own beats: the conductor loops the piece and
 *  reports its beat in the piece, so past the end there is no chord), its index, and the next one;
 *  null for an empty chart, a beat before 0 or past the end. Before the first change, the first
 *  chord (a pickup over no chord yet). Binary search: cheap on every tick. */
export function chartAt(chart: ChordChart, beat: number): { index: number; segment: ChartSegment; next: ChartSegment | null } | null {
  const { segments, lengthBeats } = chart;
  if (segments.length === 0 || !Number.isFinite(beat) || beat < 0 || beat >= lengthBeats) return null;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].beat <= beat) lo = mid;
    else hi = mid - 1;
  }
  return { index: lo, segment: segments[lo], next: segments[lo + 1] ?? null };
}
