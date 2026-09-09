/**
 * The body branch's "from-video" tier (#186): a real dancer, recorded once through
 * MediaPipe PoseLandmarker (`scripts/video_to_pose.py`) and committed as a gzipped
 * `BodyFrame` stream, replayed through the real `body-feature-vector` node.
 *
 * Two roles, like `test/fixture_replay.test.ts`:
 *  - a VERIFICATION gate — every emitted value finite, every group present, the
 *    detection rate the recording claimed; and
 *  - a REGRESSION gate — replaying the raw pose must reproduce the committed vector
 *    stream. If a body feature changes on purpose, rebuild the fixture
 *    (`scripts/build_body_fixture.ts`, see docs/TESTING.md) to update the baseline.
 *
 * `meta.json` carries the ground truth a clip cannot supply — the song is 129.2 bpm
 * and the routine starts at 51.2 s of the original — for the pulse estimator's test
 * (PR F of #186), which is why it is asserted here rather than left as prose.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { replayNode } from '@/dag';
import { bodyFeatureVectorNode, type BodyFrame } from '@/nodes';
import { BODY_GROUP_IDS } from '@/features/labConfig';
import type { FeatureVector } from '@/features/catalog';
import { FIXTURES, loadStream, roundVector } from './helpers/fixtures';

const SC = 'video_body_que_calor';
const allFinite = (v: FeatureVector) => Object.values(v).every((x) => Number.isFinite(x));

describe(`${SC}: a real dancer through the body pipeline`, () => {
  const frames = loadStream(SC, 'camBody.body') as BodyFrame[];
  const recorded = loadStream(SC, 'bodyVec.vector') as FeatureVector[];
  const meta = JSON.parse(readFileSync(`${FIXTURES}/${SC}/meta.json`, 'utf8')) as {
    frames: number;
    fps: number;
    detectionRate: number;
    music: { bpm: number; originS: number };
  };

  it('is the clip the meta describes: 20 s at 30 fps, a body in every frame, a known tempo', () => {
    expect(frames).toHaveLength(meta.frames);
    expect(frames).toHaveLength(600);
    expect(meta.fps).toBe(30);
    expect(meta.detectionRate).toBe(100);
    expect(frames.every((f) => f.present && f.landmarks.length === 33 && f.world?.length === 33)).toBe(true);
    // A pin, not a verification: the tempo was measured by the paces project, not here.
    expect(meta.music).toEqual({ bpm: 129.2, originS: 51.2 });
  });

  it('replays to an all-finite vector with every body group present', async () => {
    const params = bodyFeatureVectorNode.params.parse({ mirrorX: false });
    const out = await replayNode(bodyFeatureVectorNode.make(params), { body: frames }, { dt: 1 / meta.fps });
    const vectors = out.map((o) => o.vector as FeatureVector);
    expect(vectors).toHaveLength(frames.length);
    for (const v of vectors) expect(allFinite(v)).toBe(true);
    // From a few frames in, every group has produced something — including the
    // window-based effort features.
    const keys = Object.keys(vectors[40]);
    // (body.rhythm needs the pulse node, which this single-node replay omits; it is
    // covered on this fixture by test/body_pulse.test.ts.)
    for (const g of BODY_GROUP_IDS.filter((g) => g !== 'body.rhythm')) expect(keys.some((k) => k.startsWith(g + '.')), g).toBe(true);
    expect(keys.length).toBeGreaterThanOrEqual(45);
    // A dancer MOVES — not a standing person with tracker jitter: the mean quantity of
    // motion is well above jitter level, and the hips travel across the frame.
    const qom = vectors.map((v) => v['body.kin.qom']).filter((x) => Number.isFinite(x));
    expect(qom.length).toBeGreaterThan(590);
    expect(qom.reduce((a, b) => a + b, 0) / qom.length).toBeGreaterThan(0.5);
    const hipX = frames.map((f) => f.landmarks[23].x);
    expect(Math.max(...hipX) - Math.min(...hipX)).toBeGreaterThan(200);
  });

  it('REGRESSION: replaying the recorded pose reproduces the committed vector stream (6 dp)', async () => {
    const params = bodyFeatureVectorNode.params.parse({ mirrorX: false });
    const out = await replayNode(bodyFeatureVectorNode.make(params), { body: frames }, { dt: 1 / meta.fps });
    expect(out.map((o) => roundVector(o.vector as FeatureVector))).toEqual(recorded);
  });
});
