/**
 * Carve quality (#385 E6, design C.4.7 and C.4.8), pure: the separation chip, leave-one-hold-out
 * accuracy and the suspect holds, the hint in the modality's words, and the live margin.
 *
 * The acceptance: on a synthetic carve with two overlapping faces (a smile, and a smile whose
 * mouth is only a little more open), the pair is flagged CLOSE and the hint names the scripted
 * distinguishing movement, mouth open, while a third face (surprise) stays distinct.
 */
import { describe, expect, it } from 'vitest';
import { modelFromCategorizer, PersonalCategorizerSchema } from '@thoremin/sdk/enroll/categorizer';
import { carveQuality, distinguishingMovements, liveMargin, NEUTRAL_TARGET, qualityHint } from '@thoremin/sdk/enroll/quality';
import type { TrainedModel } from '@thoremin/sdk/enroll/types';
import { SCRIPTED_FEATURES as F, scriptedCarve as scripted } from './helpers/scripted_carve';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { faceWords } from '@thoremin/sdk/features/modalities/face_words';
import { FACE_FEATURES } from '@thoremin/sdk/features/face_catalog';
import { FACE_OMIT, FACE_TRAINING_GROUPS } from '@thoremin/sdk/features/face_groups';

const labelOf = (m: TrainedModel) => (id: string) => m.categories.find((c) => c.id === id)?.label ?? id;

describe('carve quality: the acceptance (two overlapping faces)', () => {
  const c = scripted();
  const model = modelFromCategorizer(c);
  const q = carveQuality(model, c.samples.map((s) => s.vector));
  const by = (id: string) => q.categories.find((x) => x.id === id)!;

  it('flags the smile and the open smile CLOSE to each other, and surprise distinct', () => {
    expect(by('cat-1')).toMatchObject({ grade: 'close', closeTo: 'cat-2', dots: 1 });
    expect(by('cat-2')).toMatchObject({ grade: 'close', closeTo: 'cat-1', dots: 1 });
    expect(by('cat-1').ratio).toBeLessThan(2);
    expect(by('cat-3')).toMatchObject({ grade: 'distinct', dots: 3, looAccuracy: 1, leaksTo: null });
    expect(by('cat-3').ratio).toBeGreaterThan(3);
  });

  it('the hint names the scripted difference, mouth open, in plain words and with a direction', () => {
    const hint = qualityHint(model, 'cat-2', 'cat-1', { describe: faceModality.describe, label: labelOf(model) })!;
    expect(hint.movements[0]).toMatchObject({ movement: 'mouth-open', name: 'mouth open', instruction: 'open your mouth wider' });
    expect(hint.movements[0].delta).toBeGreaterThan(0);
    expect(hint.text).toContain('They differ mostly in mouth open (+');
    expect(hint.text).toContain('open your mouth wider for "open smile", or merge them.');
    // And from the other side: less of it.
    const back = qualityHint(model, 'cat-1', 'cat-2', { describe: faceModality.describe, label: labelOf(model) })!;
    expect(back.movements[0]).toMatchObject({ movement: 'mouth-open', instruction: 'close your mouth more' });
  });

  it('the same carve gives the same chips (pure, ordered)', () => {
    const again = carveQuality(modelFromCategorizer(scripted()), scripted().samples.map((s) => s.vector));
    expect(again).toEqual(q);
  });
});

describe('suspect holds', () => {
  it('a hold filed in the wrong category is suspect, and "looks more like" its real one; so is a misplaced Neutral hold', () => {
    // Without the close pair (the open smiles set aside): a misfiled hold drags its category's
    // centre, and next to a close neighbour that alone makes the neighbour's holds suspect.
    const full = scripted({ sd: 0.01 });
    const c = PersonalCategorizerSchema.parse({ ...full, categories: [full.categories[0], { ...full.categories[2], id: 'cat-3' }], aside: full.categories[1].members });
    const smile = c.categories[0];
    const surprise = c.categories[1];
    // One surprise hold filed under smile, one rest hold under surprise, one smile hold in Neutral.
    const moved = structuredClone(c);
    moved.categories[0].members.push(surprise.members[0]);
    moved.categories[1].members = surprise.members.slice(1);
    moved.categories[1].members.push(c.neutral[0]);
    moved.neutral = c.neutral.slice(1);
    moved.categories[0].members = moved.categories[0].members.filter((id) => id !== smile.members[0]);
    moved.neutral.push(smile.members[0]);
    const doc = PersonalCategorizerSchema.parse(moved);
    const q = carveQuality(modelFromCategorizer(doc), doc.samples.map((s) => s.vector));
    const at = (id: string) => doc.samples.findIndex((s) => s.id === id);
    const found = new Map(q.suspects.map((s) => [s.index, s]));
    expect(found.get(at(surprise.members[0]))).toMatchObject({ from: 'cat-1', nearer: 'cat-3' });
    expect(found.get(at(c.neutral[0]))).toMatchObject({ from: 'cat-3', nearer: NEUTRAL_TARGET });
    expect(found.get(at(smile.members[0]))).toMatchObject({ from: NEUTRAL_TARGET });
    expect(q.suspects.every((s) => s.silhouette < 0)).toBe(true);
    // The well-sorted holds are not suspects.
    expect(q.suspects).toHaveLength(3);
  });

  it('one hold is "needs another hold", with no accuracy to state', () => {
    const c = scripted();
    const one = PersonalCategorizerSchema.parse({ ...c, categories: [...c.categories.slice(0, 2), { ...c.categories[2], members: c.categories[2].members.slice(0, 1) }], aside: c.categories[2].members.slice(1) });
    const q = carveQuality(modelFromCategorizer(one), one.samples.map((s) => s.vector));
    expect(q.categories[2]).toMatchObject({ grade: 'thin', looAccuracy: null, closeTo: null, dots: 1 });
  });
});

describe('distinguishing movements', () => {
  it('folds the features of one movement (the largest wins), and flips an inverted feature', () => {
    const model = { features: ['face.blendshape.jaw.open', 'face.geom.mouth.openness', 'face.geom.eye.earAvg'], weights: { 'face.blendshape.jaw.open': 10, 'face.geom.mouth.openness': 10, 'face.geom.eye.earAvg': 10 } };
    const a = { 'face.blendshape.jaw.open': 0.5, 'face.geom.mouth.openness': 0.2, 'face.geom.eye.earAvg': 0.1 };
    const b = { 'face.blendshape.jaw.open': 0.1, 'face.geom.mouth.openness': 0.1, 'face.geom.eye.earAvg': 0.3 };
    const ms = distinguishingMovements(model, a, b, faceWords);
    expect(ms.map((m) => m.movement)).toEqual(['mouth-open', 'eyes-closed']);
    expect(ms[0]).toMatchObject({ feature: 'face.blendshape.jaw.open', delta: 4 });
    // The eye aspect ratio FELL by 2: the eyes are MORE closed in `a`.
    expect(ms[1].delta).toBeCloseTo(2);
    expect(ms[1].instruction).toBe('close your eyes more');
  });

  it('names a feature the modality has no words for by its id', () => {
    const ms = distinguishingMovements({ features: ['x.y'], weights: {} }, { 'x.y': 1 }, { 'x.y': 3 }, () => undefined);
    expect(ms).toEqual([{ movement: 'x.y', name: 'x.y', delta: -2, instruction: 'less x.y', feature: 'x.y' }]);
  });

  it('the face has words for every feature it carves on', () => {
    const groups = new Set(FACE_TRAINING_GROUPS);
    const carved = FACE_FEATURES.filter((f) => groups.has(f.group) && !FACE_OMIT.includes(f.id));
    expect(carved.length).toBeGreaterThan(50);
    expect(carved.filter((f) => !faceModality.describe(f.id)).map((f) => f.id)).toEqual([]);
  });
});

describe('the live margin', () => {
  const c = scripted();
  const model = modelFromCategorizer(c);
  const smile = model.categories[0].centroid;
  const open = model.categories[1].centroid;
  const surprise = model.categories[2].centroid;

  it('on a centre: safely inside it', () => {
    const m = liveMargin(model, surprise);
    expect(m).toMatchObject({ nearest: 'cat-3', state: 'inside' });
    expect(m.margin).toBeGreaterThan(0.8);
    expect(m.reach).toBeCloseTo(0);
  });

  it('half-way between the close pair: on the edge', () => {
    const mid = Object.fromEntries(F.map((f) => [f, (smile[f] + open[f]) / 2]));
    const m = liveMargin(model, mid);
    expect(m.state).toBe('edge');
    expect(new Set([m.nearest, m.second])).toEqual(new Set(['cat-1', 'cat-2']));
  });

  it('far from everything, past the reject radius: outside; on a Neutral face, Neutral is the nearest', () => {
    const far = Object.fromEntries(F.map((f) => [f, 3]));
    expect(liveMargin(model, far).state).toBe('outside');
    const rest = c.samples.find((s) => s.id === 'rest:0')!.vector;
    expect(liveMargin(model, rest)).toMatchObject({ nearest: NEUTRAL_TARGET, reach: null });
  });

  it('with no reject radius (strangers read as the nearest face) nothing is outside', () => {
    const m = liveMargin({ ...model, rejectRadius: Number.MAX_VALUE }, Object.fromEntries(F.map((f) => [f, 3])));
    expect(m.reach).toBeNull();
    expect(m.state).not.toBe('outside');
  });
});
