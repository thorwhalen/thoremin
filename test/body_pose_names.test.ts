/**
 * Default pose names (#383, body-movement B3): the body's hand-written prototype categorizer, by
 * context, through the one-to-one matcher (`matchLabels`). The acceptance: on synthetic poses of
 * each vocabulary the defaults name every category correctly and never twice, and a pose outside
 * the vocabulary gets `pose n`. Here over each pose's mean vector (a category's centroid); the
 * take end to end is `test/faces/body_names_session.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { matchLabels } from '@thoremin/sdk/enroll/match';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { BODY_VOCABULARIES, bodyLabels, bodyPoseScores, bodyVocabulary, isLegFeature } from '@thoremin/sdk/features/modalities/body_names';
import { BODY_POSE_FEATURE_IDS } from '@thoremin/sdk/features/body_groups';
import type { GeneralContext } from '@thoremin/sdk/enroll/modality';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { POSES, poseVector, type PoseName, type PoseSpec } from './helpers/body_poses';

/** A pose's centroid: the mean of a few jittered frames, the pose keys only (as a carve keeps). */
function centroid(spec: PoseSpec): FeatureVector {
  const sum: Record<string, number> = {};
  const n = 8;
  for (let f = 0; f < n; f++) {
    const v = bodyModality.read(poseVector(spec, f))!;
    for (const [k, x] of Object.entries(v)) if (Number.isFinite(x)) sum[k] = (sum[k] ?? 0) + x / n;
  }
  return sum;
}

/** Name the given poses as categories (in this order) under a context. */
function name(poses: readonly (PoseName | PoseSpec)[], context: GeneralContext = {}) {
  const cats = poses.map((p, i) => ({ id: `c${i}`, label: '', centroid: centroid(typeof p === 'string' ? POSES[p] : p) }));
  return matchLabels(cats, { ...bodyModality.general!(context), fallback: bodyModality.words.fallback });
}

const labels = (m: ReturnType<typeof name>) => m.map((x) => x.label);

const STANDING = ['rest', 'arms up', 'left arm up', 'right arm up', 'arms out', 'hands together', 'lean left', 'lean right', 'crouch'] as const satisfies readonly PoseName[];
const CONDUCTOR = ['ready', 'fermata', 'cut-off', 'rest'] as const satisfies readonly PoseName[];
const seated = (p: PoseName): PoseSpec => ({ ...POSES[p], legs: false });
const SEATED_FEATURES = Object.keys(centroid(seated('rest')));

describe('the body vocabularies by context', () => {
  it('standing by default, seated when the trained features have no leg, conductor when asked', () => {
    expect(bodyVocabulary()).toBe('standing');
    expect(bodyVocabulary({ features: BODY_POSE_FEATURE_IDS })).toBe('standing');
    expect(SEATED_FEATURES.some(isLegFeature)).toBe(false);
    expect(bodyVocabulary({ features: SEATED_FEATURES })).toBe('seated');
    expect(bodyVocabulary({ features: SEATED_FEATURES, vocabulary: 'conductor' })).toBe('conductor');
    expect(BODY_VOCABULARIES.seated).toEqual(BODY_VOCABULARIES.standing.filter((l) => l !== 'crouch'));
  });

  it('the mirror merges the sided names', () => {
    expect(bodyLabels({ mirror: true })).toEqual(['rest', 'arms up', 'one arm up', 'arms out', 'hands together', 'lean', 'crouch']);
    expect(bodyLabels({ mirror: true, vocabulary: 'conductor' })).toEqual(['ready', 'fermata', 'cut-off', 'rest']);
  });

  it('a missing feature scores 0 and names nothing', () => {
    for (const s of Object.values(bodyPoseScores({}))) expect(s).toBe(0);
  });
});

describe('default pose names, one-to-one', () => {
  it('names every standing pose correctly and never twice', () => {
    expect(labels(name(STANDING))).toEqual([...STANDING]);
    // Order does not matter: the assignment is one-to-one, not first come.
    const reversed = [...STANDING].reverse();
    expect(labels(name(reversed))).toEqual(reversed);
    for (const m of name(STANDING)) expect(m.source).toBe('matched');
  });

  it('names every seated pose correctly, with no crouch in the pool', () => {
    const poses = BODY_VOCABULARIES.seated as readonly PoseName[];
    const m = name(poses.map(seated), { features: SEATED_FEATURES });
    expect(labels(m)).toEqual([...poses]);
    expect(labels(m)).not.toContain('crouch');
  });

  it('names every conductor pose correctly', () => {
    expect(labels(name(CONDUCTOR, { vocabulary: 'conductor' }))).toEqual([...CONDUCTOR]);
    expect(labels(name([...CONDUCTOR].reverse(), { vocabulary: 'conductor' }))).toEqual([...CONDUCTOR].reverse());
  });

  it('a pose outside the vocabulary gets `pose n`', () => {
    const m = name(['arms up', 'arms forward', 'crouch', 'up and out']);
    expect(labels(m)).toEqual(['arms up', 'pose 2', 'crouch', 'pose 4']);
    expect(m[1].source).toBe('fallback');
    // A standing pose is outside the conductor's vocabulary, and the reverse.
    expect(labels(name(['ready', 'lean left'], { vocabulary: 'conductor' }))).toEqual(['ready', 'pose 2']);
    expect(labels(name(['ready', 'arms up']))).toEqual(['pose 1', 'arms up']);
  });

  it('two categories of one pose: the name is given once, the other gets `pose n`', () => {
    const m = name(['arms up', 'arms up', 'crouch']);
    expect(m.filter((x) => x.label === 'arms up')).toHaveLength(1);
    expect(labels(m)).toContain('crouch');
    expect(m.find((x) => x.label !== 'arms up' && x.label !== 'crouch')!.label).toMatch(/^pose \d+$/);
  });

  it('with the mirror: one arm up (either side) and lean', () => {
    const m = name(['rest', 'arms up', 'left arm up', 'lean right'], { mirror: true });
    expect(labels(m)).toEqual(['rest', 'arms up', 'one arm up', 'lean']);
    expect(labels(name(['right arm up', 'lean left'], { mirror: true }))).toEqual(['one arm up', 'lean']);
  });

  it('the player keeps a name they typed; it leaves the pool', () => {
    const cats = (['arms up', 'crouch'] as const).map((p, i) => ({ id: `c${i}`, label: i === 0 ? 'hooray' : '', centroid: centroid(POSES[p]) }));
    const m = matchLabels(cats, { ...bodyModality.general!({}), fallback: bodyModality.words.fallback });
    expect(labels(m)).toEqual(['hooray', 'crouch']);
  });
});
