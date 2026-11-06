/**
 * Chord shapes from a recorded air guitar take, labelled by what the player said.
 *
 * The player names each chord aloud, then holds and strums it until naming the next
 * (`annotations.json`, kind `chord-intent`, from the word-timed transcript). This module
 * turns a take into labelled shape samples, the shipped summary
 * (`packages/ext-air/src/lib/recorded_chords.ts`), and a held-out score. Shared by the
 * derivation script (`recorded_chord_shapes.ts`) and the regression test
 * (`test/recordings/air_guitar_chords.test.ts`), so the test checks exactly what shipped.
 *
 * Choices, each measured on the take:
 *
 * - **The fretting hand** is the hand that does not strum: for a right-handed player, the
 *   left (the hand model labels the player's true hand, #995). The take agrees: the left
 *   wrist moves about a quarter as much as the right.
 * - **Labels.** A spoken chord name the recogniser was unsure of is checked against the
 *   progression: the player moved mostly in ascending fourths, so a doubtful name is
 *   replaced by the chord a fourth above the one before when that is also a fourth below the
 *   one after. A name said again ("another G") is a second voicing, `G (2)`: it is its own
 *   shape (three different G shapes in the take, each nearer another chord than the other Gs).
 * - **Frames.** From 1 s after the name is spoken (the hand is still changing) to 0.3 s
 *   before the next speech.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, type FeatureVector } from '@thoremin/sdk/enroll';
import { parseChordName } from '@thoremin/sdk/music/guitar';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { chordShapeFeatureIds, chordShapeVector } from '../../packages/ext-air/src/lib/hand_shape';
import { trainVocabulary } from '../../packages/ext-air/src/lib/vocabulary';
import { chordOfLabel, vocabularyFromSummary, type RecordedChordSummary } from '../../packages/ext-air/src/lib/recorded_chords';
import { RECORDINGS_DIR, recordingEvents, recordingStream } from '../../test/helpers/recordings';

export const RECORDED_TAKE = '2026-11-05T12-27-17';
/** Seconds after a chord's name starts before its frames count. */
const SETTLE_S = 1.0;
/** Seconds before the next speech at which its frames stop. */
const LEAVE_S = 0.3;
/** A spoken name below this word probability is checked against the progression. */
const DOUBTFUL_P = 0.8;
/** Seconds dropped between the two halves of a chord in the held-out split. */
const SPLIT_GAP_S = 0.3;

export interface LabelDecision {
  heard: string;
  label: string;
  p: number;
  why: string;
}

export interface ChordFrame {
  t: number;
  vector: FeatureVector;
}

export interface ChordSegment {
  label: string;
  start: number;
  end: number;
  frames: ChordFrame[];
}

interface Word {
  w: string;
  start: number;
  end: number;
  p: number;
}

const rootOf = (name: string) => parseChordName(name)?.root ?? null;
const qualityOf = (name: string) => parseChordName(name)?.quality ?? '';

/**
 * Check each doubtful name against its neighbours: the progression moves up a fourth
 * (5 semitones) or repeats. Returns the decided label of each event.
 */
export function labelsByFourths(heard: readonly string[], p: readonly number[]): LabelDecision[] {
  return heard.map((name, i) => {
    const r = rootOf(name);
    const prev = i > 0 ? rootOf(heard[i - 1]) : null;
    const next = i + 1 < heard.length ? rootOf(heard[i + 1]) : null;
    const fits = (x: number | null, y: number | null, up: number) => x !== null && y !== null && ((y - x - up) % 12 === 0 || (y - x) % 12 === 0);
    const fitsPrev = fits(prev, r, 5);
    const fitsNext = fits(r, next, 5);
    if (p[i] >= DOUBTFUL_P) return { heard: name, label: name, p: p[i], why: 'heard surely' };
    if (fitsPrev || fitsNext) return { heard: name, label: name, p: p[i], why: `doubtful, kept: a fourth ${fitsNext ? `below ${heard[i + 1]}` : `above ${heard[i - 1]}`}` };
    const implied = prev !== null ? (prev + 5) % 12 : next !== null ? (next + 7) % 12 : null;
    if (implied === null) return { heard: name, label: name, p: p[i], why: 'doubtful, no neighbour to check' };
    const fixed = parseChordName(`${['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][implied]}${qualityOf(name)}`)!.name;
    return { heard: name, label: fixed, p: p[i], why: 'doubtful, replaced by the fourth the progression implies' };
  });
}

/** A name said again is another voicing: G, G (2), G (3). */
export function voicingLabels(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((l) => {
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return n === 1 ? l : `${l} (${n})`;
  });
}

/** The take's chords: labelled segments of the fretting hand's shape vectors. */
export function recordedSegments(id = RECORDED_TAKE, frettingLabel: 'Left' | 'Right' = 'Left'): { segments: ChordSegment[]; decisions: LabelDecision[] } {
  const events = recordingEvents(id, 'chord-intent');
  const transcript = JSON.parse(readFileSync(join(RECORDINGS_DIR!, id, 'transcript.json'), 'utf8')) as { words: Word[]; speechRegions: { start: number; end: number }[] };
  // The word probability of each event's name: the first word starting at the event.
  const p = events.map((e) => transcript.words.find((w) => Math.abs(w.start - e.start) < 0.05)?.p ?? 1);
  const decisions = labelsByFourths(
    events.map((e) => parseChordName(e.label!)?.name ?? e.label!),
    p,
  );
  const labels = voicingLabels(decisions.map((d) => d.label));
  const segments: ChordSegment[] = events.map((e, i) => {
    const nextSpeech = transcript.speechRegions.find((r) => r.start > e.start + 0.5)?.start ?? e.end;
    return { label: labels[i], start: e.start + SETTLE_S, end: Math.min(e.end, nextSpeech) - LEAVE_S, frames: [] };
  });
  for (const r of recordingStream(id, 'hands')) {
    const f = r.value as HandsFrame | null;
    const hand = f?.hands.find((h) => h.handedness === frettingLabel);
    if (!f || !hand) continue;
    const seg = segments.find((s) => r.t >= s.start && r.t < s.end);
    if (seg) seg.frames.push({ t: r.t, vector: chordShapeVector(hand, f) });
  }
  return { segments, decisions };
}

/** The shipped summary of some segments: centroids, and the spread the classifier weighs by. */
export function summarise(segments: readonly ChordSegment[], source: RecordedChordSummary['source'], heldOut: RecordedChordSummary['heldOut']): RecordedChordSummary {
  const features = chordShapeFeatureIds();
  const round = (x: number) => Math.round(x * 1e4) / 1e4;
  const chords = segments.map((seg) => {
    const centroid: Record<string, number> = {};
    const spread: Record<string, number> = {};
    for (const f of features) {
      const xs = seg.frames.map((fr) => fr.vector[f]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      if (!xs.length) continue;
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      centroid[f] = round(mean);
      spread[f] = xs.length > 1 ? round(Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1))) : 0;
    }
    return { label: seg.label, centroid, spread, frames: seg.frames.length };
  });
  return { features, chords, source, heldOut };
}

export interface HeldOutScore {
  frames: number;
  /** Frames named the right chord (any voicing of it). */
  chordAccuracy: number;
  /** Frames named the right voicing. */
  shapeAccuracy: number;
  perChord: { label: string; frames: number; right: number; mostlyAs: string | null }[];
}

/**
 * Two folds: each chord's first half (in time) makes the summary and its second half is
 * named by the classifier the summary trains, then the other way round. The halves are
 * separated by a short gap; this is still one sitting, so it overrates a shape re-made on
 * another day.
 */
export function heldOutScore(segments: readonly ChordSegment[]): HeldOutScore {
  const halves = segments.map((s) => {
    const mid = (s.frames[0]!.t + s.frames[s.frames.length - 1]!.t) / 2;
    return {
      a: { ...s, frames: s.frames.filter((f) => f.t < mid - SPLIT_GAP_S / 2) },
      b: { ...s, frames: s.frames.filter((f) => f.t >= mid + SPLIT_GAP_S / 2) },
    };
  });
  const perChord = new Map<string, { frames: number; right: number; as: Map<string, number> }>();
  let frames = 0;
  let chordRight = 0;
  let shapeRight = 0;
  for (const [train, test] of [
    ['a', 'b'],
    ['b', 'a'],
  ] as const) {
    const summary = summarise(
      halves.map((h) => h[train]),
      { take: '', player: '', recordedOn: '', method: '' },
      { frames: 0, chordAccuracy: 0, shapeAccuracy: 0, note: '' },
    );
    const model = trainVocabulary(vocabularyFromSummary(summary))!;
    for (const h of halves) {
      const row = perChord.get(h[test].label) ?? { frames: 0, right: 0, as: new Map() };
      perChord.set(h[test].label, row);
      for (const f of h[test].frames) {
        const id = classify(model, f.vector).categoryId;
        const named = model.categories.find((c) => c.id === id)?.label ?? '';
        frames++;
        row.frames++;
        if (named === h[test].label) shapeRight++;
        if (chordOfLabel(named) === chordOfLabel(h[test].label)) {
          chordRight++;
          row.right++;
        } else row.as.set(named, (row.as.get(named) ?? 0) + 1);
      }
    }
  }
  return {
    frames,
    chordAccuracy: chordRight / frames,
    shapeAccuracy: shapeRight / frames,
    perChord: [...perChord].map(([label, r]) => ({ label, frames: r.frames, right: r.right, mostlyAs: [...r.as].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null })),
  };
}
