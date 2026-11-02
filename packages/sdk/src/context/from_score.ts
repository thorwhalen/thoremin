/**
 * The score producer: a {@link ScoreDoc} read into a {@link MusicalContext}, exactly. A score says
 * its bar lines, meter, tempo marks, keys and melody outright; its chords are its written symbols
 * when it has them, and otherwise the chord its notes spell beat by beat (`chartOfScore`, the
 * chord chart's reduction), at a lower confidence.
 *
 * Song seconds are the score's notes at its marked tempi (a mark holds until the next; before the
 * first, the first; none at all, {@link DEFAULT_SCORE_BPM}). The ruler has a beat per quarter note
 * from the start of the piece, which is the beat the conductor publishes for it.
 *
 * Pure.
 */
import { barStartAt, beatsPerBarAt, keyPitchClasses, tonicOf, type ScoreDoc, type ScoreNote } from '../score/schema';
import { chartOfScore } from '../score/chord_chart';
import { MusicalContextSchema, type Analyzer, type ChordSpan, type KeyRegion, type MelodyNote, type MusicalContext } from './schema';

/** The tempo a score with no tempo mark is read at. */
export const DEFAULT_SCORE_BPM = 120;
/** How far a chord derived from the notes is trusted (a written symbol is 1). */
export const DERIVED_CHORD_CONFIDENCE = 0.8;
/** How far a MIDI file's key signature is trusted: the event is often missing or left at C. */
export const MIDI_KEY_CONFIDENCE = 0.6;

export const SCORE_ANALYZER: Analyzer = { name: 'score', version: '1', weightsLicence: 'none' };
export const CHORD_CHART_ANALYZER: Analyzer = { name: 'chord-chart', version: '1', weightsLicence: 'none' };

export interface ScoreContextOptions {
  /** The content it is made from (`./cache`'s `contentKey`). */
  contentKey?: string;
  /** Beats read as one chord when the chords are derived from the notes. */
  chordStep?: number;
  /** The part whose top line is the melody (an id); absent = the first pitched part. */
  melodyPart?: string;
}

const EPS = 1e-9;

/** Song seconds of a beat under a score's tempo marks. */
export function scoreClock(doc: Pick<ScoreDoc, 'tempoMap'>): (beat: number) => number {
  const marks = [...doc.tempoMap].sort((a, b) => a.beat - b.beat);
  if (!marks.length) return (beat) => (beat * 60) / DEFAULT_SCORE_BPM;
  // Seconds at each mark, the first mark's tempo holding from beat 0.
  const at: number[] = [];
  let t = (marks[0].beat * 60) / marks[0].bpm;
  marks.forEach((m, i) => {
    if (i > 0) t += ((m.beat - marks[i - 1].beat) * 60) / marks[i - 1].bpm;
    at.push(t);
  });
  return (beat) => {
    if (beat <= marks[0].beat) return (beat * 60) / marks[0].bpm;
    let lo = 0;
    let hi = marks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (marks[mid].beat <= beat) lo = mid;
      else hi = mid - 1;
    }
    return at[lo] + ((beat - marks[lo].beat) * 60) / marks[lo].bpm;
  };
}

/** The beats of every bar line from the start of the piece to its end (a pickup's virtual bar
 *  start is before 0 and is left out). */
export function barLines(doc: ScoreDoc): number[] {
  const out: number[] = [];
  const end = Math.max(doc.lengthBeats, 0);
  let bar = barStartAt(doc, 0);
  for (let guard = 0; bar < end - EPS && guard < 1e6; guard++) {
    if (bar > -EPS) out.push(Math.max(0, bar));
    let next = bar + beatsPerBarAt(doc, Math.max(bar, 0));
    // A new time signature starts a bar, wherever the old bar would have ended.
    const change = doc.timeSignatures.find((ts) => ts.beat > Math.max(bar, 0) + EPS && ts.beat < next - EPS);
    if (change) next = change.beat;
    bar = next;
  }
  return out;
}

/** The top line of a part: at each onset the highest note, held until the next onset. */
function skyline(notes: readonly ScoreNote[]): { start: number; end: number; midi: number }[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.midi - a.midi);
  const tops: ScoreNote[] = [];
  for (const n of sorted) if (!tops.length || n.start > tops[tops.length - 1].start + EPS) tops.push(n);
  return tops.map((n, i) => ({ start: n.start, end: Math.min(n.start + n.duration, tops[i + 1]?.start ?? Infinity), midi: n.midi })).filter((n) => n.end > n.start + EPS);
}

/** The score's timeline. */
export function contextFromScore(doc: ScoreDoc, { contentKey = '', chordStep = 1, melodyPart }: ScoreContextOptions = {}): MusicalContext {
  const sec = scoreClock(doc);
  const length = Math.max(doc.lengthBeats, 0);
  const lastBeat = Math.ceil(length - EPS);
  const beats = Array.from({ length: lastBeat + 1 }, (_, k) => ({ t: sec(k), confidence: 1 }));

  const keyConfidence = doc.source === 'midi' ? MIDI_KEY_CONFIDENCE : 1;
  const keys: KeyRegion[] = [];
  doc.keys.forEach((k, i) => {
    const start = i === 0 ? 0 : k.beat;
    const end = doc.keys[i + 1]?.beat ?? length;
    if (end <= start + EPS) return;
    keys.push({ start: sec(start), end: sec(end), tonic: tonicOf(k), mode: k.mode, scalePcs: keyPitchClasses(k), confidence: keyConfidence });
  });

  const analyzers: Analyzer[] = [SCORE_ANALYZER];
  let chords: ChordSpan[];
  if (doc.harmony.length) {
    chords = doc.harmony
      .map((h, i) => ({ start: i === 0 ? Math.min(h.beat, 0) : h.beat, end: doc.harmony[i + 1]?.beat ?? length, h }))
      .filter((s) => s.end > s.start + EPS)
      .map(({ start, end, h }) => ({ start: sec(start), end: sec(end), chord: h.chord, ...(h.text ? { text: h.text } : {}), confidence: 1 }));
  } else {
    const chart = chartOfScore(doc, { step: chordStep });
    chords = chart.segments
      .map((s, i) => ({ start: s.beat, end: Math.min(chart.segments[i + 1]?.beat ?? length, length), chord: s.chord }))
      .filter((s) => s.end > s.start + EPS)
      .map((s) => ({ start: sec(s.start), end: sec(s.end), chord: s.chord, confidence: DERIVED_CHORD_CONFIDENCE }));
    if (chords.length) analyzers.push(CHORD_CHART_ANALYZER);
  }

  const part = (melodyPart ? doc.parts.find((p) => p.id === melodyPart) : undefined) ?? doc.parts.find((p) => !p.percussion && p.notes.length);
  const melody: MelodyNote[] = part ? skyline(part.notes).map((n) => ({ start: sec(n.start), end: sec(n.end), midi: n.midi, confidence: 1 })) : [];

  return MusicalContextSchema.parse({
    contentKey,
    durationS: sec(length),
    source: 'score',
    analyzers,
    beats,
    downbeats: barLines(doc).map(sec),
    meter: doc.timeSignatures.map((ts) => ({ t: sec(ts.beat), numerator: ts.numerator, denominator: ts.denominator })),
    tempo: doc.tempoMap.map((m) => ({ t: sec(m.beat), bpm: m.bpm })),
    keys,
    chords,
    melody,
    sections: [],
  });
}
