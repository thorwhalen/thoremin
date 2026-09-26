/**
 * Joining a landmark stream with time-stamped labels into labelled samples.
 *
 * The audio is the label source because real-instrument footage carries its own ground
 * truth in the sound (a strummed G is a G) where air footage carries none. The join
 * has one subtlety worth its own function: chord CHANGES. The labeller places a boundary
 * where the sound changed, but the hand started moving before that and settles after,
 * so frames within `marginSeconds` of any boundary are dropped rather than labelled
 * with a shape the hand was only half-way into. Segments labelled `N` (no chord: talk,
 * silence, single notes) contribute nothing.
 *
 * Two seams, so the next instruments reuse the join instead of rewriting it:
 * `featurize` turns a frame into a vector (guitar: the fretting hand's chord shape;
 * flute: two hands plus face; bass: hand plus body-relative position) and `labelOf`
 * turns a time into a label (guitar: chord segments with a change margin; drums will
 * pass an onset-window lookup). A holdout probe has no labels at all and goes through
 * {@link joinUnlabelledFrames}, which stamps every frame `?`.
 */
import { readFileSync } from 'node:fs';
import { parseRecords, type StreamRecord } from '@/dag';
import type { FeatureVector } from '@/features/catalog';
import type { HandsFrame } from '@/nodes/domain';
import type { Sample } from './lib_chord_shape_model';

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
/** The label of a frame from a holdout probe: nothing known, scored by prediction only. */
export const PROBE_LABEL = '?';

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

/** The `labelOf` seam built from chord segments. */
export const segmentLabeller =
  (segments: readonly ChordSegment[], marginSeconds = 0.25) =>
  (t: number): string | null =>
    labelAt(segments, t, marginSeconds);

export type Featurize = (frame: HandsFrame) => FeatureVector | undefined;
export type LabelOf = (t: number) => string | null;

export interface JoinOptions {
  group: string;
  featurize: Featurize;
  labelOf: LabelOf;
  /** Keep only frames inside these windows (seconds); absent = all. */
  windows?: readonly (readonly [number, number])[];
  /** Restrict to a vocabulary; frames labelled outside it are dropped. */
  vocabulary?: ReadonlySet<string>;
}

export interface JoinStats {
  frames: number;
  /** Frames where `featurize` found something to featurize. */
  handFrames: number;
  labelledFrames: number;
  samples: number;
  perLabel: Record<string, number>;
}

/** Join one video's landmark records with a label lookup. */
export function joinLabelledFrames(records: readonly StreamRecord[], o: JoinOptions): { samples: Sample[]; stats: JoinStats } {
  const inWindow = (t: number) => !o.windows || o.windows.some(([a, b]) => t >= a && t < b);
  const stats: JoinStats = { frames: 0, handFrames: 0, labelledFrames: 0, samples: 0, perLabel: {} };
  const samples: Sample[] = [];
  for (const r of records) {
    if (!inWindow(r.t)) continue;
    stats.frames += 1;
    const vector = o.featurize(r.value as HandsFrame);
    if (!vector) continue;
    stats.handFrames += 1;
    const label = o.labelOf(r.t);
    if (label === null) continue;
    if (o.vocabulary && !o.vocabulary.has(label)) continue;
    stats.labelledFrames += 1;
    samples.push({ vector, label, group: o.group, t: r.t });
    stats.perLabel[label] = (stats.perLabel[label] ?? 0) + 1;
  }
  stats.samples = samples.length;
  return { samples, stats };
}

/** The probe join: every featurizable frame, labelled {@link PROBE_LABEL}. */
export function joinUnlabelledFrames(
  records: readonly StreamRecord[],
  o: Pick<JoinOptions, 'group' | 'featurize' | 'windows'>,
): { samples: Sample[]; stats: JoinStats } {
  return joinLabelledFrames(records, { ...o, labelOf: () => PROBE_LABEL });
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
