/**
 * The still-point sampler's output over the real head-pose clip, pinned (#751).
 *
 * The sampler's window-displacement code moved into `motion.ts` so the motion segmenter
 * (the dynamic gestures' front end) reads the same signal in the same units. The other
 * sampler tests count points within a range (`2 < n < 60`), which a refactor can pass while
 * changing what is taken; this one records every point (its time, its cue and its vector
 * rounded to 5 places) as it was before the move and compares after, for both metrics, a
 * disarmed start with a seed, and a session take through two cues.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { matrixToHeadPose } from '@thoremin/sdk/nodes/domain';
import { createStillPointSampler, type SamplerOptions } from '@thoremin/sdk/enroll/sampler';
import { createSession } from '@thoremin/sdk/enroll/session';
import type { Cue } from '@thoremin/sdk/enroll/cue';
import type { FeatureVector, StillPoint } from '@thoremin/sdk/enroll/types';
import { loadStream } from './helpers/fixtures';

interface PoseRecord {
  present: boolean;
  blendshapes: Record<string, number>;
  transformMatrix: number[];
}
const frames = loadStream('video_head_pose', 'face.pose') as PoseRecord[];
const FRAME_MS = 1000 / 29.3;

/** Raw units, as the runner's real-clip test reads the clip: degrees beside 0..1. */
const vecAt = (i: number): FeatureVector => {
  const f = frames[i];
  const p = matrixToHeadPose(f.transformMatrix);
  const b = f.blendshapes;
  return {
    yaw: p.yaw,
    pitch: p.pitch,
    roll: p.roll,
    smile: ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2,
    jaw: b.jawOpen ?? 0,
  };
};

const round = (x: number) => Math.round(x * 1e5) / 1e5;
const summary = (points: readonly StillPoint[]) =>
  points.map((p) => ({ t: round(p.t), cue: p.cue, v: Object.fromEntries(Object.entries(p.vector).map(([k, x]) => [k, round(x)])) }));
const digest = (points: readonly StillPoint[]) => ({
  n: points.length,
  hash: createHash('sha256').update(JSON.stringify(summary(points))).digest('hex').slice(0, 16),
});

function sample(options: SamplerOptions, vec: (i: number) => FeatureVector = vecAt): StillPoint[] {
  const s = createStillPointSampler(options);
  frames.forEach((_, i) => s.push(vec(i), i * FRAME_MS));
  return s.points();
}

const cue = (id: string, produces: Cue['produces'], sufficiency: Cue['sufficiency']): Cue => ({
  id,
  name: id,
  instruction: id,
  rationale: '',
  collects: { groups: ['head'], omit: [], axes: [] },
  produces,
  sufficiency,
  variations: [],
  tags: [],
});

describe('the still-point sampler over the real head-pose clip (golden)', () => {
  it('noise-relative (the default), every key attended', () => {
    const points = sample({});
    expect(points.length).toBeGreaterThan(2);
    expect({ ...digest(points), first: summary(points.slice(0, 2)) }).toMatchSnapshot();
  });

  it('noise-relative on the head only, disarmed, seeded from frame 0', () => {
    expect(digest(sample({ features: ['yaw', 'pitch', 'roll'], armed: false, seed: { v: vecAt(0), t: -FRAME_MS } }))).toMatchSnapshot();
  });

  it('absolute (the v1 rule), on the 0..1 features it assumes', () => {
    const points = sample({ metric: 'absolute' }, (i) => {
      const { smile, jaw } = vecAt(i);
      return { smile, jaw };
    });
    expect(points.length).toBeGreaterThan(0);
    expect(digest(points)).toMatchSnapshot();
  });

  it('a session take: a rest cue, then a vocabulary cue over the rest of the clip', () => {
    const groupOf = (id: string) => (['yaw', 'pitch', 'roll'].includes(id) ? 'head' : 'face');
    const session = createSession({ groupOf, allFeatureIds: ['yaw', 'pitch', 'roll', 'smile', 'jaw'] });
    session.beginCue(cue('rest', 'baseline', { kind: 'frames', minFrames: 30, patienceMs: 20000 }));
    let i = 0;
    for (; i < 60; i++) session.push(vecAt(i), i * FRAME_MS);
    session.endCue();
    for (; i < 90; i++) session.push(vecAt(i), i * FRAME_MS);
    session.beginCue(cue('moves', 'vocabulary', { kind: 'variety', minPoints: 6, minSeparation: 10, holdNudgeMs: 8000, patienceMs: 60000 }));
    for (; i < frames.length; i++) session.push(vecAt(i), i * FRAME_MS);
    session.endCue();
    expect(digest(session.points())).toMatchSnapshot();
  });
});
