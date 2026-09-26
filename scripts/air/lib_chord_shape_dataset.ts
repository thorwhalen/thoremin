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
 * flute: two hands plus the face; bass: the fretting hand plus its position along the
 * neck) and `labelOf` turns a time into a label (guitar: chord segments with a change
 * margin; flute and bass: note segments mapped to a pitch class). The join is generic
 * in the frame type: a hands stream, or a {@link FrameBundle} of several streams
 * decoded from the same video and zipped by tick ({@link bundleStreams}). A holdout
 * probe has no labels at all and goes through {@link joinUnlabelledFrames}, which
 * stamps every frame `?`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseRecords, type StreamRecord } from '@/dag';
import type { FeatureVector } from '@/features/catalog';
import type { BodyFrame, FaceFrame, HandsFrame } from '@/nodes/domain';
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

export type Featurize<F = HandsFrame> = (frame: F) => FeatureVector | undefined;
export type LabelOf = (t: number) => string | null;

/** Several streams of one video, zipped by tick. Absent = that stream was not decoded. */
export interface FrameBundle {
  t: number;
  hands?: HandsFrame;
  face?: FaceFrame;
  body?: BodyFrame;
}

/**
 * Zip per-stream records of one video into bundle records keyed by tick. Every
 * decoder stamps `tick` from the same frame counter, so a tick is the same video
 * frame in every stream; a tick missing from a stream leaves that field absent.
 */
export function bundleStreams(streams: { hands?: readonly StreamRecord[]; face?: readonly StreamRecord[]; body?: readonly StreamRecord[] }): StreamRecord[] {
  const byTick = new Map<number, FrameBundle & { tick: number }>();
  const add = (recs: readonly StreamRecord[] | undefined, key: 'hands' | 'face' | 'body') => {
    for (const r of recs ?? []) {
      const b = byTick.get(r.tick) ?? { tick: r.tick, t: r.t };
      if (key === 'hands') b.hands = r.value as HandsFrame;
      else if (key === 'face') b.face = r.value as FaceFrame;
      else b.body = r.value as BodyFrame;
      byTick.set(r.tick, b);
    }
  };
  add(streams.hands, 'hands');
  add(streams.face, 'face');
  add(streams.body, 'body');
  return [...byTick.values()].sort((a, b) => a.tick - b.tick).map(({ tick, ...value }) => ({ tick, t: value.t, value }));
}

export interface JoinOptions<F = HandsFrame> {
  group: string;
  featurize: Featurize<F>;
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

/** Join one video's records (a landmark stream, or a bundle stream) with a label lookup. */
export function joinLabelledFrames<F = HandsFrame>(records: readonly StreamRecord[], o: JoinOptions<F>): { samples: Sample[]; stats: JoinStats } {
  const inWindow = (t: number) => !o.windows || o.windows.some(([a, b]) => t >= a && t < b);
  const stats: JoinStats = { frames: 0, handFrames: 0, labelledFrames: 0, samples: 0, perLabel: {} };
  const samples: Sample[] = [];
  for (const r of records) {
    if (!inWindow(r.t)) continue;
    stats.frames += 1;
    const vector = o.featurize(r.value as F);
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
export function joinUnlabelledFrames<F = HandsFrame>(
  records: readonly StreamRecord[],
  o: Pick<JoinOptions<F>, 'group' | 'featurize' | 'windows'>,
): { samples: Sample[]; stats: JoinStats } {
  return joinLabelledFrames(records, { ...o, labelOf: () => PROBE_LABEL });
}

/** Read a landmark stream, plain or gzipped (`video_to_pose.py` writes `.ndjson.gz`). */
export function readLandmarks(path: string): StreamRecord[] {
  if (path.endsWith('.gz')) return parseRecords(gunzipSync(readFileSync(path)).toString('utf8'));
  if (!existsSync(path) && existsSync(`${path}.gz`)) return readLandmarks(`${path}.gz`);
  return parseRecords(readFileSync(path, 'utf8'));
}

/** A note name with octave (`C#4`, `Bb2`) → its pitch class (`C#`, `A#`); `N` stays `N`. */
export function pitchClassOf(note: string): string {
  if (note === NO_CHORD) return NO_CHORD;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`not a note name: ${note}`);
  const flats: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
  const name = `${m[1]}${m[2]}`;
  return flats[name] ?? name;
}

/** The `labelOf` seam for note segments collapsed to pitch classes. */
export const pitchClassLabeller =
  (segments: readonly ChordSegment[], marginSeconds = 0.08) =>
  (t: number): string | null => {
    const l = labelAt(segments, t, marginSeconds);
    return l === null ? null : pitchClassOf(l);
  };

/** Read any `{segments: [...]}` label file (chords, pitch); the name says which. */
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

export const readSegmentLabels = readChordLabels;
