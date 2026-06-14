/**
 * Build a committed test fixture from a recorded video landmark stream.
 *
 * Pairs with `scripts/video_to_landmarks.py`: that produces a `src.hands.ndjson`
 * (HandsFrame per frame) from a video; this replays it through the real
 * `hand-features` and `voice-mapping` nodes and writes the full per-edge fixture
 * (`src.hands` / `feat.features` / `map.params` + `meta.json`) into
 * `test/fixtures/<scenario>/`. The raw .mp4 stays gitignored under media/; only
 * the derived NDJSON is committed and replayed in CI — the "from-video" tier of
 * the test strategy, made durable.
 *
 * Usage: vite-node scripts/build_video_fixture.ts <scenario> <src.hands.ndjson>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { replayNode, serializeRecords, parseRecords, type StreamRecord } from '@/dag';
import { handFeaturesNode, voiceMappingNode, type HandsFrame } from '@/nodes';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'test', 'fixtures');

// Video frames are raw (not a mirrored selfie), so don't mirror.
const FEAT = { mirrorX: false, mirrorHandedness: false };
const MAP = {
  magnetism: 1,
  right: { scale: { root: 0, type: 'major', octaves: 2, baseOctave: 3 }, instrument: 'sine' },
  left: { scale: { root: 0, type: 'major', octaves: 2, baseOctave: 3 }, instrument: 'triangle' },
};

async function main(): Promise<void> {
  const [scenario, srcPath] = process.argv.slice(2);
  if (!scenario || !srcPath) {
    console.error('usage: build_video_fixture.ts <scenario> <src.hands.ndjson>');
    process.exit(1);
  }
  const srcRecords = parseRecords(readFileSync(srcPath, 'utf8'));
  const frames = srcRecords.map((r) => r.value) as HandsFrame[];
  const dt = 1 / 30;

  // Parse params through each node's Zod schema first (applies defaults like
  // opennessMin/Max) — the engine does this; calling make() directly does not.
  const featOut = await replayNode(handFeaturesNode.make(handFeaturesNode.params.parse(FEAT)), { hands: frames }, { dt });
  const features = featOut.map((o) => o.features);
  const mapOut = await replayNode(voiceMappingNode.make(voiceMappingNode.params.parse(MAP)), { features }, { dt });

  const toRecords = (vals: unknown[]): StreamRecord[] =>
    vals.map((value, i) => ({ tick: i, t: srcRecords[i]?.t ?? i * dt, value }));

  const dir = join(FIXTURES, scenario);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'src.hands.ndjson'), serializeRecords(srcRecords));
  writeFileSync(join(dir, 'feat.features.ndjson'), serializeRecords(toRecords(features)));
  writeFileSync(join(dir, 'map.params.ndjson'), serializeRecords(toRecords(mapOut.map((o) => o.params))));

  const detected = frames.filter((f) => f.hands.length > 0).length;
  const meta = {
    scenario,
    source: 'video',
    frames: frames.length,
    handDetectedFrames: detected,
    detectionRate: Math.round((detected / Math.max(1, frames.length)) * 100),
    srcHash: createHash('sha256').update(readFileSync(srcPath)).digest('hex').slice(0, 12),
    recorderVersion: 1,
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`built ${scenario}: ${frames.length} frames, ${meta.detectionRate}% hand-detected -> ${dir}`);
}

void main();
