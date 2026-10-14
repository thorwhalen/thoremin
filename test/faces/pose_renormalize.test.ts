/**
 * #458: a pose read with some of its trained features masked (a hidden landmark under the
 * coverage bar) is as far from its category as the same pose in full. The body's live model
 * renormalises a distance over the features present; faces and hands keep the plain sum.
 */
import { describe, expect, it } from 'vitest';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { createNoiseEstimator, scaleWeights } from '@thoremin/sdk/enroll/noise';
import { modelDistance, presentDistance, weightedDistance } from '@thoremin/sdk/enroll/cluster';
import { classify } from '@thoremin/sdk/enroll/classify';
import { liveModel } from '@thoremin/sdk/enroll/live';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { POSES, poseVector, scriptedPoseCategorizer } from '../helpers/body_poses';

/** The lower legs (both shanks, as under a desk): 6 of the 40 trained features, 15 %. */
const LOWER_LEGS = (f: string) => f.startsWith('body.dir.shank.');
const mask = (v: FeatureVector): FeatureVector => Object.fromEntries(Object.entries(v).filter(([k]) => !LOWER_LEGS(k)));
const rest = (frame: number) => bodyModality.read(poseVector(POSES.rest, frame))!;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The scripted categorizer in NOISE units, as a take weights it: each feature over its own
 *  frame-to-frame jitter at rest. */
function noiseWeighted(): PersonalCategorizer {
  const c = scriptedPoseCategorizer(['rest', 'arms up', 'arms out']);
  const noise = createNoiseEstimator();
  for (let i = 0; i < 60; i++) noise.push(rest(2000 + i), i * 33);
  const w = scaleWeights(noise.snapshot());
  return { ...c, weights: Object.fromEntries(c.features.map((f) => [f, w[f] ?? 0])) };
}

describe('pose distance over the features present (#458)', () => {
  const c = noiseWeighted();
  const live = liveModel(c, {}, { modality: bodyModality });
  const centroid = live.model.categories.find((k) => k.label === 'rest')!.centroid;
  const frames = Array.from({ length: 80 }, (_, i) => rest(3000 + i));

  it('masks 15 % of the trained features and stays in view', () => {
    const missing = c.features.filter(LOWER_LEGS);
    expect(missing.length / c.features.length).toBeCloseTo(0.15, 2);
    for (const v of frames) expect(live.inView(live.project(mask(v)))).toBe(true);
  });

  it('a masked pose is as far from its category as the full pose, where the plain sum reads it closer', () => {
    const full = mean(frames.map((v) => modelDistance(live.model, v, centroid)));
    const renorm = mean(frames.map((v) => modelDistance(live.model, mask(v), centroid)));
    const plain = mean(frames.map((v) => weightedDistance(mask(v), centroid, live.model.features, live.model.weights)));
    expect(Math.abs(renorm / full - 1)).toBeLessThan(0.05);
    expect(plain / full).toBeLessThan(0.95);
  });

  it('the classifier and its reject radius read the renormalised distance', () => {
    expect(live.model.renormalize).toBe(true);
    for (const v of frames.slice(0, 10)) {
      const r = classify(live.model, mask(v));
      expect(c.categories.find((k) => k.id === r.categoryId)?.label).toBe('rest');
      expect(r.distance).toBeCloseTo(presentDistance(mask(v), centroid, live.model.features, live.model.weights), 9);
    }
  });

  it('is a no-op in full view, and faces keep the plain sum', () => {
    const v = frames[0];
    expect(presentDistance(v, centroid, live.model.features, live.model.weights)).toBe(weightedDistance(v, centroid, live.model.features, live.model.weights));
    const asFace = liveModel(c, {});
    expect('renormalize' in asFace.model).toBe(false);
    expect(modelDistance(asFace.model, mask(v), centroid)).toBe(weightedDistance(mask(v), centroid, asFace.model.features, asFace.model.weights));
  });
});
