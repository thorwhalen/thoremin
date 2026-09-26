/**
 * Joining a landmark stream with audio-derived chord labels into labelled samples.
 *
 * The audio is the label source because real-instrument footage carries its own ground
 * truth in the sound (a strummed G is a G) where air footage carries none. The join
 * has one subtlety worth its own function: chord CHANGES. The labeller places a boundary
 * where the sound changed, but the hand started moving before that and settles after,
 * so frames within `marginSeconds` of any boundary are dropped rather than labelled
 * with a shape the hand was only half-way into. Segments labelled `N` (no chord: talk,
 * silence, single notes) contribute nothing.
 */
import { readFileSync } from 'node:fs';
import { parseRecords, type StreamRecord } from '@/dag';
import type { HandsFrame } from '@/nodes/domain';
import { chordShapeVector, frettingHand, type FeatureSelection } from './lib_chord_shape_features';
import type { Sample } from './lib_chord_shape_model';
import type { FrettingHandPick } from './lib_sources';

/** One labelled span of audio, seconds. `label` is a chord shape or `N` (no chord). */
export interface ChordSegment {
  start: number;
  end: number;
  label: string;
}

/** What `scripts/air/label_chords.py` writes. */
export interface ChordLabelsFile {
  video: string;
  /** The vocabulary the decoder was constrained to. */
  vocabulary: string[];
  /** Hop size the decoder worked at, seconds (documentation). */
  hopSeconds?: number;
  segments: ChordSegment[];
}

export const NO_CHORD = 'N';

/**
 * The label active at time `t`, or `null` when `t` is within `margin` of a segment
 * boundary, inside a no-chord segment, or outside every segment. Segments are assumed
 * sorted and non-overlapping.
 */
export function labelAt(segments: readonly ChordSegment[], t: number, margin: number): string | null {
  for (const s of segments) {
    if (t < s.start || t >= s.end) continue;
    if (s.label === NO_CHORD) return null;
    if (t - s.start < margin || s.end - t < margin) return null;
    return s.label;
  }
  return null;
}

export interface JoinOptions {
  group: string;
  pick: FrettingHandPick;
  /** Seconds around a chord change to drop. Default 0.25. */
  marginSeconds?: number;
  /** Keep only frames inside these windows (seconds); absent = all. */
  windows?: readonly (readonly [number, number])[];
  /** Restrict to a vocabulary; frames labelled outside it are dropped. */
  vocabulary?: ReadonlySet<string>;
  features?: FeatureSelection;
  /** Minimum MediaPipe hand score to keep a frame (absent score = keep). */
  minScore?: number;
}

export interface JoinStats {
  frames: number;
  handFrames: number;
  labelledFrames: number;
  samples: number;
  perLabel: Record<string, number>;
}

/** Join one video's landmark records with its chord segments. */
export function joinLabelledFrames(
  records: readonly StreamRecord[],
  segments: readonly ChordSegment[],
  o: JoinOptions,
): { samples: Sample[]; stats: JoinStats } {
  const margin = o.marginSeconds ?? 0.25;
  const inWindow = (t: number) => !o.windows || o.windows.some(([a, b]) => t >= a && t < b);
  const stats: JoinStats = { frames: 0, handFrames: 0, labelledFrames: 0, samples: 0, perLabel: {} };
  const samples: Sample[] = [];
  for (const r of records) {
    if (!inWindow(r.t)) continue;
    stats.frames += 1;
    const frame = r.value as HandsFrame;
    const hand = frettingHand(frame, o.pick);
    if (!hand) continue;
    if (o.minScore !== undefined && hand.score !== undefined && hand.score < o.minScore) continue;
    stats.handFrames += 1;
    const label = labelAt(segments, r.t, margin);
    if (label === null) continue;
    if (o.vocabulary && !o.vocabulary.has(label)) continue;
    stats.labelledFrames += 1;
    samples.push({ vector: chordShapeVector(hand, frame, o.features), label, group: o.group, t: r.t });
    stats.perLabel[label] = (stats.perLabel[label] ?? 0) + 1;
  }
  stats.samples = samples.length;
  return { samples, stats };
}

export function readLandmarks(path: string): StreamRecord[] {
  return parseRecords(readFileSync(path, 'utf8'));
}

export function readChordLabels(path: string): ChordLabelsFile {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as ChordLabelsFile;
  if (!Array.isArray(doc.segments)) throw new Error(`${path}: no segments`);
  return doc;
}

/** Serialize samples as NDJSON (one per line) for the local dataset file. */
export function samplesToNdjson(samples: readonly Sample[]): string {
  return samples.map((s) => JSON.stringify(s)).join('\n') + '\n';
}

export function samplesFromNdjson(text: string): Sample[] {
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Sample);
}
