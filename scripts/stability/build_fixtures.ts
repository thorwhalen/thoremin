/**
 * Build the committed REAL-hand fixtures of the stability harness from the landmark streams kept
 * in the app-data dir (the video-data rule: the streams are extracted once, with their meta, by
 * `scripts/video_streams.py`; see `docs/testing/stability.md`).
 *
 * - `real_hands_signs/`: a real signer (SignAlphaSet, CC BY 4.0; held out of every ASL model's
 *   training, so the reader meets it for the first time) fingerspelling, as two performances:
 *   `gaps` (each sign clip, then the hand gone: the hand entering and leaving every time) and
 *   `flow` (the clips with only a 0.2 s dropout between them: one letter after the next). The
 *   meta lists each segment's frames and sign.
 * - `real_hands_choir/`: a choir conductor's two hands (Wikimedia Commons, CC BY 3.0), a 20 s excerpt
 *   at the video's own 29.97 fps: real hands moving the way hands move, for the false-trigger and drift numbers.
 *
 * Usage: npx vite-node scripts/stability/build_fixtures.ts
 * Inputs: `<data>/landmarks/signalphaset/<clip>.hands.ndjson.gz` + meta,
 * `<data>/landmarks/body/bortniansky.hands.ndjson.gz` + meta, where `<data>` is
 * `THOREMIN_DATA_DIR` or `~/.local/share/thoremin`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseRecords, serializeRecords, type StreamRecord } from '@thoremin/dag';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { resample } from './lib_streams';

const DATA = process.env.THOREMIN_DATA_DIR ?? join(homedir(), '.local', 'share', 'thoremin');
const FIXTURES = join(process.cwd(), 'test', 'fixtures');
const FPS = 30;

const readStream = (path: string): StreamRecord[] => parseRecords(gunzipSync(readFileSync(path)).toString('utf8'));

const r1 = (x: number) => Math.round(x * 10) / 10;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** The conductor fixtures' compaction: x, y to 0.1 px, z and world coordinates to 1e-4, keypoint
 *  names and the extractor's crop bookkeeping dropped; the raw handedness label and score kept. */
function compact(f: HandsFrame): HandsFrame {
  return {
    width: f.width,
    height: f.height,
    hands: f.hands.map((h) => ({
      handedness: h.handedness,
      ...(h.score !== undefined ? { score: r4(h.score) } : {}),
      keypoints: h.keypoints.map((k) => ({ x: r1(k.x), y: r1(k.y), z: r4(k.z ?? 0) })),
      ...(h.worldKeypoints ? { worldKeypoints: h.worldKeypoints.map((k) => ({ x: r4(k.x), y: r4(k.y), z: r4(k.z ?? 0) })) } : {}),
    })),
  };
}

/** The sign clips of each performance: a clip id and the sign it shows (from the dataset's folder). */
const GAPS = ['A_clip1', 'B_clip1', 'C_clip1', 'D_clip1', 'E_clip6', 'F_clip6', 'G_clip6', 'H_clip1', 'B_clip2', 'L_clip1', 'Y_clip1', 'O_clip1'];
const FLOW = ['C_clip3', 'D_clip3', 'E_clip8', 'F_clip8', 'G_clip8', 'A_clip3', 'B_clip3', 'W_clip1', 'C_clip4', 'K_clip1', 'A_clip4'];
const GAP_S = 0.8;
const DROPOUT_S = 0.2;

interface Segment {
  from: number;
  to: number;
  sign: string | null;
  clip?: string;
}

function signPerformance(ids: readonly string[], pause: number): { records: StreamRecord[]; segments: Segment[] } {
  const frames: HandsFrame[] = [];
  const segments: Segment[] = [];
  const blank = (n: number, w: number, h: number) => {
    const from = frames.length;
    for (let i = 0; i < n; i++) frames.push({ width: w, height: h, hands: [] });
    segments.push({ from, to: frames.length, sign: null });
  };
  // One second of nothing first: the reader's models load, the instrument settles.
  blank(FPS, 640, 480);
  for (const id of ids) {
    const clip = resample(readStream(join(DATA, 'landmarks', 'signalphaset', `${id}.hands.ndjson.gz`)), FPS);
    const from = frames.length;
    frames.push(...clip.map(compact));
    segments.push({ from, to: frames.length, sign: id.split('_')[0].toLowerCase(), clip: id });
    blank(Math.round(pause * FPS), clip[0]?.width ?? 640, clip[0]?.height ?? 480);
  }
  return { records: frames.map((value, tick) => ({ tick, t: Math.round((tick / FPS) * 1e6) / 1e6, value })), segments };
}

function write(dir: string, file: string, records: StreamRecord[]): number {
  mkdirSync(dir, { recursive: true });
  const gz = gzipSync(serializeRecords(records), { level: 9 });
  writeFileSync(join(dir, file), gz);
  return gz.length;
}

function main(): void {
  const signs = join(FIXTURES, 'real_hands_signs');
  const gaps = signPerformance(GAPS, GAP_S);
  const flow = signPerformance(FLOW, DROPOUT_S);
  const bytes = write(signs, 'gaps.hands.ndjson.gz', gaps.records) + write(signs, 'flow.hands.ndjson.gz', flow.records);
  const clipMeta = JSON.parse(readFileSync(join(DATA, 'landmarks', 'signalphaset', 'A_clip1.meta.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(
    join(signs, 'meta.json'),
    JSON.stringify(
      {
        scenario: 'real_hands_signs',
        source: 'video',
        dataset: 'SignAlphaSet (ASL_dynamic), B. Garg, M. Kasar, A. Kashyap, A. Vats, G. Sharma, A. Hange, Mendeley Data, 2025, doi:10.17632/8fmvr9m98w.3',
        sourceUrl: 'https://doi.org/10.17632/8fmvr9m98w.3',
        licence: 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
        changes: 'MediaPipe hand landmarks extracted from the clips (no pixels), at 30 fps; clips joined end to end with frames of no hand between them; x, y rounded to 0.1 px, z and world coordinates to 1e-4, keypoint names dropped',
        labels: 'the sign of each clip is its folder name in the dataset',
        heldOut: 'no thoremin-asl model is trained on SignAlphaSet (its ATTRIBUTIONS.md): the reader meets this signer for the first time',
        fps: FPS,
        hands: (clipMeta.streams as Record<string, unknown> | undefined)?.hands ?? 'scripts/video_to_landmarks.py (MediaPipe HandLandmarker, VIDEO mode)',
        performances: {
          gaps: { pauseS: GAP_S, frames: gaps.records.length, segments: gaps.segments },
          flow: { pauseS: DROPOUT_S, frames: flow.records.length, segments: flow.segments },
        },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`real_hands_signs: ${gaps.records.length} + ${flow.records.length} frames, ${(bytes / 1024).toFixed(0)} KB`);

  // The choir conductor: 20 s from the middle of the take (both hands up, beating and shaping),
  // at the video's own rate (29.97 fps: resampling to 30 would repeat a frame every 33 s).
  const choir = join(FIXTURES, 'real_hands_choir');
  const FROM_S = 40;
  const TO_S = 60;
  const all = readStream(join(DATA, 'landmarks', 'body', 'bortniansky.hands.ndjson.gz')).filter((r) => r.t >= FROM_S && r.t < TO_S);
  const frames = all.map((r) => compact(r.value as HandsFrame));
  const records = frames.map((value, tick) => ({ tick, t: Math.round((all[tick].t - all[0].t) * 1e6) / 1e6, value }));
  const size = write(choir, 'src.hands.ndjson.gz', records);
  const meta = JSON.parse(readFileSync(join(DATA, 'landmarks', 'body', 'bortniansky.meta.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(
    join(choir, 'meta.json'),
    JSON.stringify(
      {
        scenario: 'real_hands_choir',
        source: 'video',
        title: meta.title,
        author: meta.author,
        licence: meta.licence,
        sourceUrl: meta.sourceUrl,
        description: meta.description,
        changes: 'MediaPipe hand landmarks extracted from the video (no pixels), an excerpt; x, y rounded to 0.1 px, z and world coordinates to 1e-4, keypoint names dropped',
        excerpt: { fromS: FROM_S, toS: TO_S },
        fps: 29.97,
        frames: records.length,
        detectedFrames: frames.filter((f) => f.hands.length > 0).length,
        twoHandFrames: frames.filter((f) => f.hands.length === 2).length,
        hands: (meta.streams as Record<string, unknown> | undefined)?.hands,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`real_hands_choir: ${records.length} frames, ${(size / 1024).toFixed(0)} KB`);
}

main();
