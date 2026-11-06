/**
 * Measure the codified theremin positions on real players: the pitch hand's shape (the same
 * `poseFeatures` the instrument reads) in the frames where the player SOUNDS a position's note, so
 * each frame is labelled by the audio, not by eye.
 *
 * Eyck's eight finger positions are the major scale's degrees above FP1 (her lessons: FP1 = C4,
 * FP8 = C5; `sources.json` gives each video's tonic). A held note `tonic + d` for a scale degree d
 * in [0, 2, 4, 5, 7, 9, 11, 12] labels its frames with that position; frames within `MARGIN_S` of
 * a note's edges, notes outside that octave (her speaking voice sits below it) and frames without
 * the pitch hand are dropped.
 *
 * Reads the local landmark streams and pitch labels (`~/.local/share/thoremin/landmarks/
 * theremin-technique/<id>/`, `labels/theremin/<id>.pitch.json`; never committed: third-party
 * footage) and writes ONLY the numbers: the per-position median shape and its spread
 * (`src/slices/theremin/lib/pose_measurements.json`, read by `poses.ts`), and prints how well the
 * centroids tell the positions apart, each video held out in turn.
 *
 * Usage: npx vite-node scripts/theremin/measure_poses.ts [--write]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { POSE_FEATURE_IDS, poseFeatures, poseVector } from '../../src/slices/theremin/lib/hand_pose';
import { classifyAmong, floorSpread } from '../../src/slices/theremin/lib/poses';
import { POSE_SNAP_TUNING } from '../../src/slices/theremin/lib/pose_snap';

const DATA = process.env.THOREMIN_DATA_DIR ?? join(homedir(), '.local', 'share', 'thoremin');
const LANDMARKS = join(DATA, 'landmarks', 'theremin-technique');
const LABELS = join(DATA, 'labels', 'theremin');
const OUT = join(process.cwd(), 'src', 'slices', 'theremin', 'lib', 'pose_measurements.json');
/** Frames this close to a note's start or end are a glide, not the position. */
const MARGIN_S = 0.12;
const DEGREES = [0, 2, 4, 5, 7, 9, 11, 12];
/** The 2021 lesson series opens every video with the same jingle (C5, C4, C3 in the first four
 *  seconds) and, after the spoken intro, the same short melody: the same clip in every video, a
 *  melody rather than a scale played in one place, so it would sit on both sides of the held-out
 *  split. Its first notes find it; it and the first seconds are dropped. */
const SERIES_OPENER = ['C4', 'G4', 'C5', 'F4', 'C5'];
const OPENER_S = 14;
const JINGLE_S = 5;

/** `labelByNote: false` (with `labelByNoteWhy`) drops a video whose note does not name the position. */
interface Source { id: string; url: string; title: string; channel: string; licence: string; system: string; tonic: number | null; pitchHand: 'Left' | 'Right'; performer: string; labelByNote?: boolean }
interface Segment { start: number; end: number; label: string }

const NOTE = /^([A-G])(#?)(-?\d)$/;
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midiOf(name: string): number | null {
  const m = NOTE.exec(name);
  return m ? 12 * (Number(m[3]) + 1) + PC[m[1]!]! + (m[2] ? 1 : 0) : null;
}

const ndjson = (p: string) => gunzipSync(readFileSync(p)).toString('utf8').trim().split('\n').map((l) => JSON.parse(l) as { t: number; value: HandsFrame });

/** Per labelled frame of one video: the position (1..8) and the pitch hand's feature vector. */
function labelledFrames(src: Source): { fp: number; v: number[]; video: string }[] {
  const hands = join(LANDMARKS, src.id, `${src.id}.hands.ndjson.gz`);
  const pitch = join(LABELS, `${src.id}.pitch.json`);
  if (!existsSync(hands) || !existsSync(pitch) || src.tonic === null) return [];
  const all = (JSON.parse(readFileSync(pitch, 'utf8')) as { segments: Segment[] }).segments;
  const notes = all.filter((s) => s.label !== 'N');
  const at = notes.findIndex((_, i) => SERIES_OPENER.every((n, k) => notes[i + k]?.label === n));
  const opener = at >= 0 ? { start: notes[at]!.start, end: notes[at]!.start + OPENER_S } : null;
  const segs = all
    .filter((s) => s.start >= JINGLE_S && !(opener && s.end > opener.start && s.start < opener.end))
    .map((s) => ({ ...s, midi: midiOf(s.label) }))
    .filter((s): s is Segment & { midi: number } => s.midi !== null)
    .map((s) => ({ ...s, fp: DEGREES.indexOf(s.midi - src.tonic!) + 1 }))
    .filter((s) => s.fp > 0 && s.end - s.start > 2 * MARGIN_S);
  const out: { fp: number; v: number[]; video: string }[] = [];
  let i = 0;
  for (const r of ndjson(hands)) {
    while (i < segs.length && segs[i]!.end - MARGIN_S < r.t) i++;
    const s = segs[i];
    if (!s || r.t < s.start + MARGIN_S) continue;
    const hand = r.value.hands.filter((h) => h.handedness === src.pitchHand);
    if (hand.length !== 1) continue;
    const f = poseFeatures(hand[0]!);
    if (f) out.push({ fp: s.fp, v: poseVector(f), video: src.id });
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : NaN;
};
/** A robust spread: the median absolute deviation, scaled to a standard deviation. */
const spread = (xs: number[], m: number) => 1.4826 * median(xs.map((x) => Math.abs(x - m)));

function centroids(rows: { fp: number; v: number[]; video: string }[]) {
  const by = new Map<number, { fp: number; v: number[]; video: string }[]>();
  for (const r of rows) by.set(r.fp, [...(by.get(r.fp) ?? []), r]);
  const out = new Map<number, { prototype: number[]; spread: number[]; frames: number; videos: string[] }>();
  for (const [fp, rs] of by) {
    const vs = rs.map((r) => r.v);
    const prototype = POSE_FEATURE_IDS.map((_, k) => median(vs.map((v) => v[k]!)));
    const videos = [...new Set(rs.map((r) => r.video))].sort();
    out.set(fp, { prototype, spread: POSE_FEATURE_IDS.map((_, k) => spread(vs.map((v) => v[k]!), prototype[k]!)), frames: vs.length, videos });
  }
  return out;
}

const sources = (JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'theremin', 'sources.json'), 'utf8')) as { sources: Source[] }).sources.filter((s) => s.system === 'eyck' && s.labelByNote !== false);
const perVideo = new Map(sources.map((s) => [s.id, labelledFrames(s)]));
const all = [...perVideo.values()].flat();
const cs = centroids(all);

console.log(`frames labelled by the note sounded: ${all.length} from ${[...perVideo.values()].filter((r) => r.length).length} videos`);
console.log(`| FP | frames | ${POSE_FEATURE_IDS.join(' | ')} |`);
for (const fp of [...cs.keys()].sort()) {
  const c = cs.get(fp)!;
  console.log(`| ${fp} | ${c.frames} | ${c.prototype.map((x, k) => `${x.toFixed(2)} ±${c.spread[k]!.toFixed(2)}`).join(' | ')} |`);
}
// Held out: each video scored by the instrument's own classifier (`classifyAmong`, the same
// spread floor) against the centroids of the other videos. "Sure" is a reading the pose snap would
// act on (confidence at least `POSE_SNAP_TUNING.minConfidence`): what matters for the snap is how
// often a sure reading is right, and how many frames are sure.
const tally = { n: 0, hit: 0, near: 0, sure: 0, sureHit: 0 };
/** Every held-out reading's confidence and whether it was right: the snap threshold's trade-off. */
const readings: { fp: number; got: number; confidence: number; right: boolean }[] = [];
for (const [id, rows] of perVideo) {
  if (!rows.length) continue;
  const others = [...centroids([...perVideo].filter(([k]) => k !== id).flatMap(([, r]) => r))].map(([fp, c]) => ({ fp, prototype: c.prototype, spread: floorSpread(c.spread) }));
  if (others.length < 2) continue;
  const v = { n: 0, hit: 0, near: 0, sure: 0, sureHit: 0 };
  for (const r of rows) {
    const got = classifyAmong(r.v, others);
    const fp = got.pose?.fp ?? -99;
    readings.push({ fp: r.fp, got: fp, confidence: got.confidence, right: fp === r.fp });
    v.n++;
    if (fp === r.fp) v.hit++;
    if (Math.abs(fp - r.fp) <= 1) v.near++;
    if (got.confidence >= POSE_SNAP_TUNING.minConfidence) {
      v.sure++;
      if (fp === r.fp) v.sureHit++;
    }
  }
  for (const k of Object.keys(tally) as (keyof typeof tally)[]) tally[k] += v[k];
  const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
  console.log(`  ${id}: ${v.n} frames, ${pc(v.hit, v.n)} right, ${pc(v.near, v.n)} within one; sure ${pc(v.sure, v.n)} of frames, of which ${pc(v.sureHit, v.sure)} right`);
}
const { n, hit, near, sure, sureHit } = tally;
for (const t of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
  const sure = readings.filter((r) => r.confidence >= t);
  console.log(`  confidence >= ${t}: ${((100 * sure.length) / Math.max(readings.length, 1)).toFixed(0)}% of frames, ${((100 * sure.filter((r) => r.right).length) / Math.max(sure.length, 1)).toFixed(0)}% right`);
}
// Per position, at the snap's threshold: how often a reading the snap would act on is right, and
// what it is taken for when it is not.
const byPosition = Object.fromEntries(
  [...cs.keys()].sort((a, b) => a - b).map((fp) => {
    const sure = readings.filter((r) => r.fp === fp && r.confidence >= POSE_SNAP_TUNING.minConfidence);
    const wrong = new Map<number, number>();
    for (const r of sure) if (!r.right) wrong.set(r.got, (wrong.get(r.got) ?? 0) + 1);
    const [mistakenFor] = [...wrong].sort((a, b) => b[1] - a[1]);
    // Precision, what the snap rests on: of the sure readings NAMING this position, how many are it.
    const named = readings.filter((r) => r.got === fp && r.confidence >= POSE_SNAP_TUNING.minConfidence);
    return [
      `eyck.fp${fp}`,
      {
        sure: sure.length,
        right: sure.length ? +(sure.filter((r) => r.right).length / sure.length).toFixed(3) : null,
        mostlyMistakenFor: mistakenFor ? `eyck.fp${mistakenFor[0]}` : null,
        named: named.length,
        precision: named.length ? +(named.filter((r) => r.right).length / named.length).toFixed(3) : null,
      },
    ];
  }),
);
const pc = (x: number | null) => (x === null ? '-' : `${Math.round(100 * x)}%`);
console.log(`| FP | sure readings of it | right | mostly mistaken for | sure readings naming it | of those, it |`);
for (const [id, b] of Object.entries(byPosition)) console.log(`| ${id} | ${b.sure} | ${pc(b.right)} | ${b.mostlyMistakenFor ?? '-'} | ${b.named} | ${pc(b.precision)} |`);
if (n) console.log(`held-out video: ${((100 * hit) / n).toFixed(0)}% of frames on the right position, ${((100 * near) / n).toFixed(0)}% within one; ${((100 * sure) / n).toFixed(0)}% sure, of which ${((100 * sureHit) / Math.max(sure, 1)).toFixed(0)}% right (${n} frames)`);

if (process.argv.includes('--write')) {
  const videos = [...perVideo].filter(([, r]) => r.length).map(([k]) => k);
  const poses = Object.fromEntries(
    [...cs].sort(([a], [b]) => a - b).map(([fp, c]) => [`eyck.fp${fp}`, { prototype: c.prototype.map((x) => +x.toFixed(4)), spread: c.spread.map((x) => +x.toFixed(4)), frames: c.frames, videos: c.videos }]),
  );
  // Who the numbers come from: every video measured, credited with its performer, title, URL and licence.
  const attribution = sources.filter((s) => videos.includes(s.id)).map(({ id, performer, title, channel, url, licence }) => ({ id, performer, title, channel, url, licence }));
  const doc = { version: 1, note: (JSON.parse(readFileSync(OUT, 'utf8')) as { note: string }).note, attribution, snapMinConfidence: POSE_SNAP_TUNING.minConfidence, heldOutAccuracy: n ? +(hit / n).toFixed(3) : null, heldOutWithinOne: n ? +(near / n).toFixed(3) : null, heldOutSure: n ? +(sure / n).toFixed(3) : null, heldOutSureAccuracy: sure ? +(sureHit / sure).toFixed(3) : null, heldOutByPosition: byPosition, poses };
  writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`wrote ${OUT}`);
}
