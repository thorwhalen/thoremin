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

/** The piece's chords, a segment per change (`step`: beats read as one chord). */
export function chartOfScore(doc: Pick<ScoreDoc, 'parts' | 'lengthBeats'>, { step = 1 }: { step?: number } = {}): ChordChart {
  const notes = doc.parts.filter((p) => !p.percussion).flatMap((p) => p.notes);
  const span = Math.max(step, Math.ceil(doc.lengthBeats / step) * step);
  const segments: ChartSegment[] = [];
  for (let b = 0; b < span; b += step) {
    // The notes that make the harmony: sounding at the step's start, or held for half of it; a
    // short note inside the step is a passing or neighbour tone, not the chord.
    const sounding = notes
      .filter((n) => n.start < b + step && n.start + n.duration > b)
      .filter((n) => (n.start <= b + EPS && n.start + n.duration > b + EPS) || Math.min(n.start + n.duration, b + step) - Math.max(n.start, b) >= step / 2 - EPS)
      .map((n) => n.midi);
    const chord = chordOfPitchClasses(sounding);
    if (!chord) continue;
    const last = segments[segments.length - 1];
    if (!last || !same(last.chord, chord)) segments.push({ beat: b, chord });
  }
  return { segments, lengthBeats: span };
}

/** The segment in force at `beat` (the chart repeats past its end, as the conductor loops the
 *  piece), its index, and the next one; null for an empty chart. */
export function chartAt(chart: ChordChart, beat: number): { index: number; segment: ChartSegment; next: ChartSegment } | null {
  const { segments, lengthBeats } = chart;
  if (segments.length === 0 || !(lengthBeats > 0) || !Number.isFinite(beat)) return null;
  const b = ((beat % lengthBeats) + lengthBeats) % lengthBeats;
  // Before the first change, the chart's first chord sounds (a pickup over no chord).
  let index = 0;
  for (let i = 0; i < segments.length; i++) if (segments[i].beat <= b) index = i;
  return { index, segment: segments[index], next: segments[(index + 1) % segments.length] };
}
