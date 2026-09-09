/**
 * Build a committed body test fixture from a recorded pose stream (#186).
 *
 * Pairs with `scripts/video_to_pose.py`: that produces a `BodyFrame`-per-frame
 * NDJSON from a video; this replays it through the real `body-feature-vector`
 * node and writes the per-edge fixture (`camBody.body.ndjson.gz` — the raw pose,
 * gzipped — plus `bodyVec.vector.ndjson.gz`, rounded to 6 dp, and `meta.json`)
 * into `test/fixtures/<scenario>/`. The raw .mp4 stays in the app-data dir,
 * never in the repo; only the derived NDJSON is committed and replayed in CI.
 *
 * `meta.json` carries what the clip cannot say about itself and a later test
 * needs: the music's tempo and the routine origin (`--bpm`, `--origin`), so the
 * pulse estimator (PR F) can be scored against a ground truth. As everywhere
 * else in this repo, meta is provenance for a reader, not a staleness guard.
 *
 * Usage: vite-node scripts/build_body_fixture.ts <scenario> <pose.ndjson[.gz]> [--bpm N] [--origin S] [--clip "<desc>"]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { replayNode, serializeRecords, parseRecords, type StreamRecord } from '@/dag';
import { bodyFeatureVectorNode, type BodyFrame } from '@/nodes';
import { roundVector } from '../test/helpers/fixtures';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'test', 'fixtures');

// Video frames are raw (not a mirrored selfie), so don't mirror.
const VEC = { mirrorX: false };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [scenario, srcPath] = process.argv.slice(2);
  if (!scenario || !srcPath) {
    console.error('usage: build_body_fixture.ts <scenario> <pose.ndjson[.gz]> [--bpm N] [--origin S] [--clip "<desc>"]');
    process.exit(1);
  }
  const raw = readFileSync(srcPath);
  const text = srcPath.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const srcRecords = parseRecords(text);
  const frames = srcRecords.map((r) => r.value) as BodyFrame[];
  // Frame rate from the recorded timestamps, rounded to 3 dp: `t` is written at 6 dp,
  // so the raw reciprocal is 30.00003 for a 30 fps clip, and the replay test must
  // reproduce this exact dt (it reads `meta.fps`) for the regression gate to hold.
  const fps = srcRecords.length > 1 ? Math.round((1 / (srcRecords[1].t - srcRecords[0].t)) * 1000) / 1000 : 30;
  const dt = 1 / fps;

  // Parse params through the node's Zod schema first (defaults) — the engine does
  // this; calling make() directly does not.
  const vecOut = await replayNode(bodyFeatureVectorNode.make(bodyFeatureVectorNode.params.parse(VEC)), { body: frames }, { dt });

  const toRecords = (vals: unknown[]): StreamRecord[] =>
    vals.map((value, i) => ({ tick: i, t: srcRecords[i]?.t ?? i * dt, value }));

  const dir = join(FIXTURES, scenario);
  mkdirSync(dir, { recursive: true });
  // The raw pose is the big stream: gzip it (loadStream decompresses transparently).
  writeFileSync(join(dir, 'camBody.body.ndjson.gz'), gzipSync(Buffer.from(serializeRecords(srcRecords)), { level: 9 }));
  // The vector stream: round to 6 dp (a meter cannot see less) and gzip — 600 frames
  // of ~50 features is over a megabyte raw.
  writeFileSync(
    join(dir, 'bodyVec.vector.ndjson.gz'),
    gzipSync(Buffer.from(serializeRecords(toRecords(vecOut.map((o) => roundVector(o.vector as Record<string, number>))))), { level: 9 }),
  );

  const detected = frames.filter((f) => f.present).length;
  const bpm = arg('--bpm');
  const origin = arg('--origin');
  const meta = {
    scenario,
    source: 'video',
    clip: arg('--clip') ?? null,
    frames: frames.length,
    fps,
    bodyDetectedFrames: detected,
    detectionRate: Math.round((detected / Math.max(1, frames.length)) * 100),
    // Ground truth the clip cannot supply: the music's tempo and where the routine
    // starts, in seconds of the ORIGINAL video (the excerpt's own t starts at 0).
    music: bpm ? { bpm: Number(bpm), originS: origin ? Number(origin) : null } : null,
    // Hash the CONTENT, not the gz bytes: Python's gzip stamps an mtime, so the same
    // stream re-gzipped would otherwise change the hash.
    srcHash: createHash('sha256').update(text).digest('hex').slice(0, 12),
    recorderVersion: 1,
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`built ${scenario}: ${frames.length} frames, ${meta.detectionRate}% body-detected -> ${dir}`);
}

void main();
