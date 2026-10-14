/**
 * The body as a carve modality, pure (#382 = #385 E9): the mirror's canonical side, the stick
 * figure, the words, the registry, the coverage bar and the file's two additive fields
 * (`skeleton` per sample, `mirror`).
 */
import { describe, expect, it } from 'vitest';
import { bodyFrameVector, bodyModality, canonicalPose, mirrorAsymmetry, poseSkeleton, POSE_FIGURE_LINES } from '@thoremin/sdk/features/modalities/body';
import { bodyWords } from '@thoremin/sdk/features/modalities/body_words';
import { modalityById } from '@thoremin/sdk/features/modalities';
import { BODY_POSE_FEATURE_IDS, BODY_POSE_MIN_COVERAGE } from '@thoremin/sdk/features/body_groups';
import { mirrorBodyVector } from '@thoremin/sdk/features/body_mirror';
import { inView } from '@thoremin/sdk/enroll/modality';
import { CATEGORIZER_VERSION, categorizerFromModel, exportCategorizer, importCategorizer, MAX_SKELETON_POINTS, PersonalCategorizerSchema } from '@thoremin/sdk/enroll/categorizer';
import { syntheticBodyFrame, SYNTHETIC_BODY_TIMELINE as T } from '@thoremin/ext-faces/lib/synthetic_body';
import { CategoryReadSchema } from '@thoremin/sdk/enroll/bind';

const POSES_AT = T.restMs + 3 * T.nuisanceMs;
const span = T.holdMs + T.glideMs;
const at = (ms: number, frame = 3) => bodyFrameVector(syntheticBodyFrame(ms, frame));
const rest = at(1000);
const armsUp = at(POSES_AT + 600);
const leftOut = at(POSES_AT + 2 * span + 600);
const rightOut = at(POSES_AT + 4 * span + 600);

describe('the body modality', () => {
  it('is registered and reads only the pose space', () => {
    expect(modalityById('body')).toBe(bodyModality);
    const read = bodyModality.read(armsUp)!;
    expect(Object.keys(read).length).toBeGreaterThan(30);
    for (const k of Object.keys(read)) expect(BODY_POSE_FEATURE_IDS).toContain(k);
    expect(bodyModality.read({ 'face.mouth.open': 1 })).toBeNull();
  });

  it('the mirror picks one side: a pose and its mirror image project to the same vector, idempotently', () => {
    expect(mirrorAsymmetry(leftOut)).toBeGreaterThan(1);
    expect(mirrorAsymmetry(rightOut)).toBeLessThan(-1);
    const a = canonicalPose(leftOut);
    const b = canonicalPose(mirrorBodyVector(leftOut));
    for (const k of BODY_POSE_FEATURE_IDS) if (Number.isFinite(a[k])) expect(b[k]).toBeCloseTo(a[k], 9);
    expect(canonicalPose(a)).toBe(a);
    // Off by default: `project` without the option is the identity.
    expect(bodyModality.project!(rightOut)).toBe(rightOut);
    expect(mirrorAsymmetry(bodyModality.project!(rightOut, { mirror: true }))).toBeGreaterThan(0);
  });

  it('draws the stick figure from the segment directions: the raised arm is drawn up, the one held out drawn out', () => {
    const up = poseSkeleton(armsUp)!;
    expect(up['wrist.left'][1]).toBeGreaterThan(1.5);
    expect(up['wrist.right'][1]).toBeGreaterThan(1.5);
    const out = poseSkeleton(leftOut)!;
    // The player's left is drawn on the left (a mirror's view), out at shoulder height.
    expect(out['wrist.left'][0]).toBeLessThan(-1.2);
    expect(Math.abs(out['wrist.left'][1] - 1)).toBeLessThan(0.15);
    expect(out['wrist.right'][1]).toBeLessThan(0.2);
    // A leg out of view is left out of the figure, the rest of it kept.
    const noLegs = Object.fromEntries(Object.entries(rest).filter(([k]) => !/thigh|shank/.test(k)));
    const fig = poseSkeleton(noLegs)!;
    expect(fig['knee.left']).toBeUndefined();
    expect(fig['wrist.left']).toBeDefined();
    expect(poseSkeleton({})).toBeNull();
    for (const line of POSE_FIGURE_LINES) for (const j of line) expect(Object.keys(up)).toContain(j);
  });

  it('has words for every pose feature', () => {
    for (const id of BODY_POSE_FEATURE_IDS) expect(bodyWords(id), id).toBeDefined();
    expect(bodyWords('body.angle.elbow.left')).toMatchObject({ name: 'left elbow bend', invert: true });
    expect(bodyWords('body.dir.upperArm.right.up')!.movement).toBe(bodyWords('body.angle.shoulder.right')!.movement);
    expect(bodyWords('face.mouth.open')).toBeUndefined();
  });

  it('is in view only with most of the trained features (the visibility mask)', () => {
    const ids = BODY_POSE_FEATURE_IDS;
    expect(inView(bodyModality, rest, ids)).toBe(true);
    const keep = Math.floor(ids.length * BODY_POSE_MIN_COVERAGE) - 1;
    const partial = Object.fromEntries(ids.slice(0, keep).map((id) => [id, rest[id]]));
    expect(inView(bodyModality, partial, ids)).toBe(false);
    // The face and the hand keep their rule: any one trained feature.
    expect(inView({}, { a: 1 }, ['a', 'b', 'c'])).toBe(true);
  });

  it('has three nuisance demonstrations: distance, a step aside, a turn', () => {
    expect(bodyModality.nuisanceCues!.map((c) => c.axes[0])).toEqual(['scale', 'position', 'yaw']);
  });
});

describe('the categorizer file carries skeletons and the mirror (additive, no version change)', () => {
  const build = (mirror: boolean) => {
    const points = [rest, armsUp, leftOut].map((v, i) => ({ vector: bodyModality.read(v)!, t: i, cue: 'poses-yours', id: `t:${i}`, skeleton: poseSkeleton(v) }));
    const features = BODY_POSE_FEATURE_IDS.filter((f) => Number.isFinite(rest[f]));
    const trained = { features, weights: Object.fromEntries(features.map((f) => [f, 1])), rejectRadius: 10, categories: [0, 1, 2].map((i) => ({ id: `c${i}`, label: `pose ${i + 1}`, members: [i], centroid: points[i].vector, radius: 1, cues: {} })) };
    return categorizerFromModel(trained as never, points, { name: 'P', strangers: 'neutral', modality: 'body', mirror });
  };

  it('round-trips the skeletons and the mirror through export and import', () => {
    const c = build(true);
    expect(c.version).toBe(CATEGORIZER_VERSION);
    expect(c.mirror).toBe(true);
    expect(c.samples.every((s) => s.skeleton !== undefined)).toBe(true);
    const back = importCategorizer(exportCategorizer(c));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.categorizer.mirror).toBe(true);
      expect(back.categorizer.samples.map((s) => s.skeleton)).toEqual(c.samples.map((s) => s.skeleton));
    }
    expect(build(false).mirror).toBeUndefined();
  });

  it('a file without them still reads, and an oversized skeleton is refused', () => {
    const c = build(false);
    const bare = { ...c, samples: c.samples.map(({ skeleton: _s, ...rest }) => rest) };
    expect(importCategorizer(JSON.stringify(bare)).ok).toBe(true);
    const big = Object.fromEntries(Array.from({ length: MAX_SKELETON_POINTS + 1 }, (_, i) => [`j${i}`, [0, 0]]));
    const bad = { ...c, samples: c.samples.map((s, i) => (i === 0 ? { ...s, skeleton: big } : s)) };
    expect(PersonalCategorizerSchema.safeParse(bad).success).toBe(false);
  });

  it('a bound set may say it reads mirrored', () => {
    expect(CategoryReadSchema.parse({ modality: 'body', mirror: true })).toEqual({ modality: 'body', mirror: true });
  });
});
