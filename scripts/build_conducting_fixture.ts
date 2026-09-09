/**
 * Build a committed conducting fixture from a raw hand-landmark stream.
 *
 * Pairs with `scripts/video_to_landmarks.py` the way `build_video_fixture.ts` does, for
 * the conducting-pattern excerpts (#187): the raw video lives in the app-data dir
 * (`~/.local/share/thoremin/videos/conducting/`, fetched with `yb`; its README records
 * the sources) and never in the repo; the landmark NDJSON it decodes to is ~3 MB per
 * 15 s clip, too big to commit as is. This script compacts it — coordinates rounded to
 * a tenth of a pixel, `z` to four places, the per-keypoint `name` dropped (the index
 * IS the name in MediaPipe's order) — and writes it gzipped in the standard fixture
 * shape, plus a `meta.json` carrying the ground truth a clip cannot supply on its own:
 * the STATED tempo and beat pattern, and the window in which the conductor is beating.
 *
 * Usage:
 *   vite-node scripts/build_conducting_fixture.ts <scenario> <src.hands.ndjson> \
 *       --bpm 70 --pattern 4/4 --from 0 --to 13.5 [--source <youtube id>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseRecords, serializeRecords, type StreamRecord } from '@/dag';
import type { HandsFrame, Keypoint } from '@/nodes';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'test', 'fixtures');

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const round = (v: number, places: number) => Number(v.toFixed(places));

function compactKeypoint(k: Keypoint): Keypoint {
  const out: Keypoint = { x: round(k.x, 1), y: round(k.y, 1) };
  if (typeof k.z === 'number') out.z = round(k.z, 4);
  return out;
}

function compactFrame(f: HandsFrame): HandsFrame {
  return {
    width: f.width,
    height: f.height,
    hands: f.hands.map((h) => ({
      handedness: h.handedness,
      keypoints: h.keypoints.map(compactKeypoint),
      ...(h.worldKeypoints ? { worldKeypoints: h.worldKeypoints.map(compactKeypoint) } : {}),
      ...(typeof h.score === 'number' ? { score: round(h.score, 3) } : {}),
    })),
  };
}

function main(): void {
  const [scenario, srcPath] = process.argv.slice(2);
  const bpm = Number(arg('bpm'));
  const pattern = arg('pattern');
  if (!scenario || !srcPath || !Number.isFinite(bpm) || !pattern) {
    console.error('usage: build_conducting_fixture.ts <scenario> <src.hands.ndjson> --bpm N --pattern 4/4 [--from s --to s] [--source id]');
    process.exit(1);
  }
  const from = Number(arg('from', '0'));
  const to = Number(arg('to', 'Infinity'));
  const records = parseRecords(readFileSync(srcPath, 'utf8')).filter((r) => r.t >= from && r.t <= to);
  const t0 = records[0]?.t ?? 0;
  const out: StreamRecord[] = records.map((r, i) => ({ tick: i, t: round(r.t - t0, 6), value: compactFrame(r.value as HandsFrame) }));
  const dir = join(FIXTURES, scenario);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'src.hands.ndjson.gz'), gzipSync(serializeRecords(out), { level: 9 }));
  const detected = out.filter((r) => (r.value as HandsFrame).hands.length > 0).length;
  const fps = out.length > 1 ? (out.length - 1) / (out[out.length - 1].t - out[0].t) : NaN;
  const meta = {
    scenario,
    source: 'video',
    sourceId: arg('source') ?? null,
    kind: 'conducting-pattern',
    statedBpm: bpm,
    pattern,
    window: { from, to: Number.isFinite(to) ? to : records[records.length - 1]?.t ?? null },
    ticks: out.length,
    fps: round(fps, 3),
    detectedFrames: detected,
    recordedKeys: ['src.hands'],
    compaction: 'xy to 0.1 px, z to 1e-4, keypoint names dropped',
    builtAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`${scenario}: ${out.length} frames (${detected} with hands) @ ${meta.fps} fps, stated ${bpm} bpm ${pattern} -> ${dir}`);
}

main();
