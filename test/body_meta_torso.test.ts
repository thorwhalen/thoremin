/**
 * The torso-confidence reading and the world-only invariance labels (#432).
 */
import { describe, expect, it } from 'vitest';
import { BODY_FEATURES, FEATURE_BY_ID } from '@thoremin/sdk/features/catalog';
import { selectByInvariance } from '@thoremin/sdk/enroll/invariance';
import { BLM } from '@thoremin/sdk/nodes/domain';
import { buildBodyCtx, torsoVisibility } from '@thoremin/sdk/features/catalog';
import type { BodyFrame } from '@thoremin/sdk/nodes/domain';

function frame(vis: Partial<Record<number, number>>): BodyFrame {
  const landmarks = Array.from({ length: 33 }, (_, i) => ({ x: 100 + i, y: 100 + 3 * i, z: 0 }));
  return { t: 0, present: true, width: 640, height: 360, landmarks, visibility: Array.from({ length: 33 }, (_, i) => vis[i] ?? 0.99) } as unknown as BodyFrame;
}

describe('torsoVisibility (#432)', () => {
  it('is the lowest visibility of the four anchors, which the mask still never hides', () => {
    expect(torsoVisibility(frame({}))).toBeCloseTo(0.99, 9);
    expect(torsoVisibility(frame({ [BLM.left_hip]: 0.05, [BLM.right_hip]: 0.2 }))).toBeCloseTo(0.05, 9);
    // A hidden elbow does not lower it: it is about the frame, not the limbs.
    expect(torsoVisibility(frame({ [BLM.left_elbow]: 0.01 }))).toBeCloseTo(0.99, 9);
    expect(torsoVisibility({ present: false, visibility: [] })).toBeNaN();
    // The mask hides the elbow's features but not the torso's: a guessed frame stays unmasked.
    const ctx = buildBodyCtx(frame({ [BLM.left_hip]: 0.05, [BLM.left_elbow]: 0.05 }), { dtS: 1 / 30, history: [], mirrorX: false, minVisibility: 0.5 });
    expect(ctx.P(BLM.left_hip)).toBeDefined();
    expect(ctx.P(BLM.left_elbow)).toBeUndefined();
  });

  it('is not a catalog feature: recorded vectors keep their keys', () => {
    expect(BODY_FEATURES.some((f) => f.id.startsWith('body.meta'))).toBe(false);
  });
});

describe('world-only invariance (#432)', () => {
  it('body.dir and body.angle claim yaw and pitch only on world landmarks', () => {
    const dir = FEATURE_BY_ID['body.dir.upperArm.left.out'];
    expect(dir.invariantTo).toContain('yaw');
    expect(dir.worldOnly).toEqual(['yaw', 'pitch']);
    expect(FEATURE_BY_ID['body.angle.torso.lean'].worldOnly).toBeUndefined();
  });

  it('an image-only source is not given what only the world set holds', () => {
    const ids = ['body.dir.upperArm.left.out', 'body.angle.elbow.left', 'body.angle.torso.lean'];
    expect(selectByInvariance(['yaw'], ids).keep).toEqual(['body.dir.upperArm.left.out', 'body.angle.elbow.left']);
    const image = selectByInvariance(['yaw'], ids, { world: false });
    expect(image.keep).toEqual([]);
    expect(image.drop).toEqual(ids);
    expect(selectByInvariance(['scale'], ids, { world: false }).keep).toEqual(ids);
  });
});
