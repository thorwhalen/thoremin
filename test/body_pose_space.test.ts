/**
 * The body pose feature space (#381, body-movement B1): segment directions in the torso
 * frame, `bodyPoseCollects()`, the visibility mask and coverage, and the mirror map.
 *
 * The acceptance replays: `synthetic-body` frames with scale, translation and a small yaw
 * applied, where every pose feature labelled invariant to that nuisance must move by less
 * than one noise unit (the noise measured, as the trainer does, from a jittered rest); and
 * a replay with the legs cropped out of the frame, which must drop the leg features and
 * read a coverage below 1.
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { syntheticBodyNode, bodyFeatureVectorNode } from '@/nodes';
import { BLM, makeBodyKeypoints, type BodyFrame, type Keypoint } from '@thoremin/sdk/nodes/domain';
import { BODY_FEATURES, FEATURE_BY_ID, type FeatureVector } from '@thoremin/sdk/features/catalog';
import type { Invariance } from '@thoremin/sdk/features/types';
import {
  BODY_POSE_FEATURE_IDS,
  BODY_POSE_GROUPS,
  BODY_POSE_OMIT,
  bodyPoseCollects,
  bodyPoseCoverage,
  featureCoverage,
} from '@thoremin/sdk/features/body_groups';
import { BODY_MIRROR, mirrorBodyVector } from '@thoremin/sdk/features/body_mirror';
import { createNoiseEstimator } from '@thoremin/sdk/enroll/noise';

const W = 640;
const H = 480;
const FPS = 30;
const ctxAt = (time: number): NodeContext => ({ tick: Math.round(time * FPS), time, dt: 1 / FPS, resources: {} });

function frameOf(over: Partial<Parameters<typeof makeBodyKeypoints>[0]> = {}): BodyFrame {
  const { landmarks, world } = makeBodyKeypoints({ width: W, height: H, cx: 0.5, cy: 0.6, torso: 100, leftArm: 0, rightArm: 0, kneeBend: 0, lean: 0, ...over });
  return { width: W, height: H, present: true, landmarks, world, visibility: new Array(33).fill(1) };
}

/** Three seconds of the animated synthetic body (arms, bounce, sway, steps), by its node. */
function syntheticReplay(seconds = 3): BodyFrame[] {
  const src = syntheticBodyNode.make(syntheticBodyNode.params.parse({}));
  const out: BodyFrame[] = [];
  for (let k = 0; k < seconds * FPS; k++) out.push((src.process({}, ctxAt(k / FPS)) as { body: BodyFrame }).body);
  return out;
}

/** Feed frames through one `body-feature-vector` instance (the vector the trainer taps). */
function vectors(frames: BodyFrame[], params: Record<string, unknown> = {}): FeatureVector[] {
  const h = bodyFeatureVectorNode.make(bodyFeatureVectorNode.params.parse(params));
  return frames.map((f, k) => (h.process({ body: f }, ctxAt(k / FPS)) as { vector: FeatureVector }).vector);
}

const mapPts = (pts: Keypoint[], f: (p: Keypoint) => Keypoint): Keypoint[] => pts.map(f);
const hipMid = (pts: Keypoint[]): Keypoint => ({
  x: (pts[BLM.left_hip].x + pts[BLM.right_hip].x) / 2,
  y: (pts[BLM.left_hip].y + pts[BLM.right_hip].y) / 2,
});

/** The nuisances, each a whole-frame transform. Scale and translation move the image set
 *  only (the world set is metric and hip-centred, as MediaPipe's is); yaw turns the body
 *  about its vertical axis in the world set and foreshortens the image set to match. */
const NUISANCE: Record<'scale' | 'position' | 'yaw', (f: BodyFrame) => BodyFrame> = {
  scale: (f) => {
    const c = hipMid(f.landmarks);
    const k = 1.3;
    return { ...f, landmarks: mapPts(f.landmarks, (p) => ({ ...p, x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k })) };
  },
  position: (f) => ({ ...f, landmarks: mapPts(f.landmarks, (p) => ({ ...p, x: p.x + 0.15 * W, y: p.y - 0.05 * H })) }),
  yaw: (f) => {
    const a = (10 * Math.PI) / 180;
    const c = hipMid(f.landmarks);
    return {
      ...f,
      landmarks: mapPts(f.landmarks, (p) => ({ ...p, x: c.x + (p.x - c.x) * Math.cos(a) })),
      world: f.world!.map((p) => ({ x: p.x * Math.cos(a) + (p.z ?? 0) * Math.sin(a), y: p.y, z: -p.x * Math.sin(a) + (p.z ?? 0) * Math.cos(a) })),
    };
  },
};

const imageOnly = (f: BodyFrame): BodyFrame => ({ ...f, world: undefined });

/** A seeded Gaussian, so the noise estimate is the same every run. */
function gaussian(seed: number): () => number {
  let s = seed >>> 0;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** Noise units for the pose space: a still player whose landmarks jitter by 1 % of the
 *  torso (about a pixel on a 100 px torso, 5 mm in the world set), measured the way the
 *  trainer measures them. */
function poseNoise(withWorld: boolean): (id: string) => number {
  const g = gaussian(381);
  const base = frameOf({ leftArm: 0.3, rightArm: 0.1, kneeBend: 0.1 });
  const jitter = (pts: Keypoint[], sd: number) => pts.map((p) => ({ x: p.x + g() * sd, y: p.y + g() * sd, z: (p.z ?? 0) + g() * sd }));
  const frames = Array.from({ length: 90 }, () => {
    const f: BodyFrame = { ...base, landmarks: jitter(base.landmarks, 1), world: jitter(base.world!, 0.005) };
    return withWorld ? f : imageOnly(f);
  });
  const est = createNoiseEstimator();
  vectors(frames).forEach((v, k) => est.push(v, (k * 1000) / FPS));
  return (id) => est.sigma(id);
}

const invariantTo = (id: string, n: Invariance) => (FEATURE_BY_ID[id]?.invariantTo ?? []).includes(n);

describe('body.dir: segment directions in the torso frame', () => {
  const v = (over: Parameters<typeof frameOf>[0]) => vectors([frameOf(over)])[0];

  it('registers four segments x two sides x three components, unit length per segment', () => {
    const dir = BODY_FEATURES.filter((f) => f.group === 'body.dir');
    expect(dir).toHaveLength(24);
    const x = v({ leftArm: 0.37, rightArm: 0.8, kneeBend: 0.5, lean: 0.2 });
    for (const seg of ['upperArm', 'forearm', 'thigh', 'shank']) {
      for (const side of ['left', 'right']) {
        const k = `body.dir.${seg}.${side}`;
        expect(Math.hypot(x[`${k}.out`], x[`${k}.up`], x[`${k}.fwd`])).toBeCloseTo(1, 9);
      }
    }
  });

  it('tells an arm held up from an arm held out, and hanging from both', () => {
    const hanging = v({});
    const out = v({ leftArm: 0.5, rightArm: 0.5 });
    const up = v({ leftArm: 1, rightArm: 1 });
    for (const side of ['left', 'right']) {
      expect(hanging[`body.dir.upperArm.${side}.up`]).toBeCloseTo(-1, 6);
      expect(out[`body.dir.upperArm.${side}.out`]).toBeCloseTo(1, 6);
      expect(out[`body.dir.upperArm.${side}.up`]).toBeCloseTo(0, 6);
      expect(up[`body.dir.upperArm.${side}.up`]).toBeCloseTo(1, 6);
      // Straight arms in all three: the elbow angle alone cannot tell them apart.
      expect(hanging[`body.angle.elbow.${side}`]).toBeCloseTo(out[`body.angle.elbow.${side}`], 6);
    }
  });

  it('reads the limb against the TORSO, not the camera: a leaning body with hanging arms is still hanging', () => {
    const leaning = v({ lean: 0.4 });
    // The synthetic arm hangs along the image vertical while the torso leans, so in the torso
    // frame it points down and a little toward the side the shoulders moved away from.
    expect(leaning['body.dir.upperArm.left.up']).toBeCloseTo(-Math.cos(0.4), 6);
  });

  it('turns forward with the body: an arm pointing at the camera reads forward', () => {
    const f = frameOf();
    // Swing the left forearm toward the camera in the world set (MediaPipe: z away from the camera).
    const e = f.world![BLM.left_elbow];
    f.world![BLM.left_wrist] = { x: e.x, y: e.y, z: -0.25 };
    expect(vectors([f])[0]['body.dir.forearm.left.fwd']).toBeCloseTo(1, 6);
  });
});

describe('bodyPoseCollects(): the pose space', () => {
  it('claims the static groups and leaves motion, the pulse and the booleans out', () => {
    const c = bodyPoseCollects();
    expect(c.groups).toEqual(['body.angle', 'body.dir', 'body.pos', 'body.shape']);
    for (const g of ['body.kin', 'body.effort', 'body.rhythm', 'body.rel']) expect(c.groups).not.toContain(g);
    expect(BODY_POSE_FEATURE_IDS.some((id) => id.startsWith('body.rel.'))).toBe(false);
    expect(BODY_POSE_GROUPS).toEqual(c.groups);
  });

  it('omits exactly where the player stands (derived from the invariance labels)', () => {
    expect([...BODY_POSE_OMIT].sort()).toEqual([
      'body.pos.ankle.left.y', 'body.pos.ankle.right.y', 'body.pos.head.y', 'body.pos.hip.x', 'body.pos.hip.y',
      'body.pos.wrist.left.x', 'body.pos.wrist.left.y', 'body.pos.wrist.right.x', 'body.pos.wrist.right.y',
      'body.shape.com.x', 'body.shape.com.y', 'body.shape.sway',
    ].sort());
    expect(bodyPoseCollects().omit).toEqual([...BODY_POSE_OMIT]);
    expect(BODY_POSE_FEATURE_IDS).toContain('body.pos.wrist.left.rise');
  });

  it('every pose feature is invariant to scale and position, by its label', () => {
    for (const id of BODY_POSE_FEATURE_IDS) {
      expect(invariantTo(id, 'scale') && invariantTo(id, 'position'), id).toBe(true);
    }
  });
});

describe('the pose space under nuisance: replays of synthetic-body', () => {
  const replay = syntheticReplay();
  // Each nuisance on the set where its label applies: the world set (as the live camera
  // supplies it) for all three; the image set alone (a source without world landmarks)
  // for scale and position, which the labels promise there too.
  const cases: { set: 'world' | 'image'; nuisance: keyof typeof NUISANCE }[] = [
    { set: 'world', nuisance: 'scale' },
    { set: 'world', nuisance: 'position' },
    { set: 'world', nuisance: 'yaw' },
    { set: 'image', nuisance: 'scale' },
    { set: 'image', nuisance: 'position' },
  ];
  for (const { set, nuisance } of cases) {
    it(`${nuisance} (${set} set): every pose feature labelled invariant moves less than one noise unit`, () => {
      const sigma = poseNoise(set === 'world');
      const frames = set === 'world' ? replay : replay.map(imageOnly);
      const a = vectors(frames);
      const b = vectors(frames.map(NUISANCE[nuisance]));
      let checked = 0;
      for (let k = 0; k < frames.length; k++) {
        for (const id of BODY_POSE_FEATURE_IDS) {
          if (!invariantTo(id, nuisance)) continue;
          expect(Number.isFinite(a[k][id]), id).toBe(true);
          const s = sigma(id);
          // A feature that never jitters (the forward components on a flat skeleton) has
          // no unit and no weight; it must then not move at all.
          const moved = Math.abs(b[k][id] - a[k][id]);
          if (s > 0) expect(moved / s, `${id} @${k}`).toBeLessThan(1);
          else expect(moved, `${id} @${k}`).toBeLessThan(1e-9);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(frames.length * 10);
    });
  }

  it('the test has teeth: the omitted frame positions DO move by many noise units when the player steps aside', () => {
    const sigma = poseNoise(true);
    const a = vectors(replay.slice(0, 5));
    const b = vectors(replay.slice(0, 5).map(NUISANCE.position));
    expect(Math.abs(b[0]['body.pos.wrist.left.x'] - a[0]['body.pos.wrist.left.x']) / sigma('body.pos.wrist.left.x')).toBeGreaterThan(10);
  });
});

describe('the visibility mask and coverage: legs out of frame', () => {
  const LEGS: readonly number[] = [BLM.left_knee, BLM.right_knee, BLM.left_ankle, BLM.right_ankle, BLM.left_heel, BLM.right_heel, BLM.left_foot_index, BLM.right_foot_index];
  /** The frame cropped above the knees: the pose model still guesses the legs, below the
   *  frame and with a low visibility, as MediaPipe does. */
  const cropLegs = (f: BodyFrame): BodyFrame => {
    const visibility = [...f.visibility];
    for (const i of LEGS) visibility[i] = 0.1;
    const landmarks = f.landmarks.map((p, i) => (LEGS.includes(i) ? { ...p, y: p.y + H } : p));
    return { ...f, landmarks, visibility };
  };
  const LEG_FEATURES = BODY_POSE_FEATURE_IDS.filter((id) =>
    /\.(knee|hip)\.(left|right)$|body\.dir\.(thigh|shank)\.|body\.shape\.(stance|height|extension)$/.test(id),
  );

  it('drops every leg feature and keeps the upper body, so coverage falls below 1', () => {
    expect(LEG_FEATURES.length).toBeGreaterThan(10);
    const replay = syntheticReplay(1);
    const full = vectors(replay);
    const cropped = vectors(replay.map(cropLegs));
    for (let k = 0; k < replay.length; k++) {
      expect(bodyPoseCoverage(full[k])).toBe(1);
      for (const id of LEG_FEATURES) expect(cropped[k][id], id).toBeUndefined();
      for (const id of ['body.angle.elbow.left', 'body.dir.forearm.right.up', 'body.pos.wrist.left.rise', 'body.shape.openness']) {
        expect(cropped[k][id], id).toBeCloseTo(full[k][id], 9);
      }
      const c = bodyPoseCoverage(cropped[k]);
      expect(c).toBeLessThan(1);
      expect(c).toBeCloseTo(1 - LEG_FEATURES.length / BODY_POSE_FEATURE_IDS.length, 9);
    }
  });

  it('the mask is what drops them: with minVisibility 0 the guessed legs come back', () => {
    const [v] = vectors([cropLegs(frameOf())], { minVisibility: 0 });
    expect(bodyPoseCoverage(v)).toBe(1);
  });

  it('never masks the torso anchors: a seated player whose hips are just out of view keeps the upper body', () => {
    const f = frameOf({ leftArm: 0.5 });
    for (const i of [BLM.left_hip, BLM.right_hip]) f.visibility[i] = 0.2;
    const [v] = vectors([f]);
    expect(v['body.dir.upperArm.left.out']).toBeCloseTo(1, 6);
  });

  it('featureCoverage counts finite values over the given ids', () => {
    expect(featureCoverage({ a: 1, b: NaN }, ['a', 'b', 'c', 'd'])).toBe(0.25);
    expect(featureCoverage({}, [])).toBe(1);
  });
});

describe('the mirror map', () => {
  const SIDE_SWAP = Object.fromEntries(
    Object.entries(BLM).map(([name, i]) => {
      const twin = name.startsWith('left_') ? `right_${name.slice(5)}` : name.startsWith('right_') ? `left_${name.slice(6)}` : name;
      return [i, BLM[twin as keyof typeof BLM]];
    }),
  ) as Record<number, number>;

  /** The player reflected left to right: points reflected across the frame (image) and the
   *  sagittal plane (world), then relabelled so the subject's left is their left again. */
  function mirrorFrame(f: BodyFrame): BodyFrame {
    const reflect = (pts: Keypoint[], axis: number) => pts.map((_, i) => {
      const p = pts[SIDE_SWAP[i]];
      return { ...p, x: axis - p.x };
    });
    return { ...f, landmarks: reflect(f.landmarks, W), world: reflect(f.world!, 0), visibility: f.visibility.map((_, i) => f.visibility[SIDE_SWAP[i]]) };
  }

  it('covers every body feature and is an involution', () => {
    for (const f of BODY_FEATURES) {
      const m = BODY_MIRROR[f.id];
      expect(FEATURE_BY_ID[m.to], f.id).toBeTruthy();
      expect(BODY_MIRROR[m.to].to).toBe(f.id);
      expect(BODY_MIRROR[m.to].flip).toBe(m.flip);
    }
  });

  it('agrees with a skeleton actually reflected, on every feature (motion included)', () => {
    // An asymmetric pose with depth, moving, so every group has a value.
    const frames = [0, 1, 2, 3].map((k) => {
      const f = frameOf({ leftArm: 0.7 + 0.02 * k, rightArm: 0.2, kneeBend: 0.3, lean: 0.15, step: 0.2, cx: 0.4 + 0.01 * k });
      f.world![BLM.left_wrist] = { ...f.world![BLM.left_wrist], z: -0.2 };
      f.world![BLM.right_elbow] = { ...f.world![BLM.right_elbow], z: 0.1 };
      return f;
    });
    const orig = vectors(frames).at(-1)!;
    const refl = vectors(frames.map(mirrorFrame)).at(-1)!;
    const predicted = mirrorBodyVector(orig);
    expect(Object.keys(refl).sort()).toEqual(Object.keys(predicted).sort());
    for (const id of Object.keys(refl)) expect(refl[id], id).toBeCloseTo(predicted[id], 6);
    // The pose differs from its mirror (the test is not vacuous).
    expect(orig['body.dir.upperArm.left.up']).not.toBeCloseTo(orig['body.dir.upperArm.right.up'], 2);
  });

  it('passes non-body keys through', () => {
    expect(mirrorBodyVector({ 'face.head.yaw': 3 })).toEqual({ 'face.head.yaw': 3 });
  });
});
