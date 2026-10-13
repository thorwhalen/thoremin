/**
 * A saved face categorizer read live, and corrected (#330 P3), purely: the reject radius floored
 * (a file whose radius is too small still accepts its own faces) and clamped in partition mode
 * (never `MAX_VALUE x scale`); sensitivity scaling a live face from the player's rest; the
 * distance residual learned from the samples' own scale and taken out of a live face at another
 * distance; and the corrections (a live face added, a sample moved) as edits of the samples.
 */
import { describe, expect, it } from 'vitest';
import { classify } from '@thoremin/sdk/enroll/classify';
import { categorizerFromModel, CATEGORIZER_FORMAT, CATEGORIZER_VERSION, modelFromCategorizer, NO_REJECT_RADIUS, PersonalCategorizerSchema, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { TrainedModelSchema } from '@thoremin/sdk/enroll/bind';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { createFaceTake } from '@thoremin/ext-faces/lib/take';
import { carveView, carverFor } from '@thoremin/ext-faces/lib/carving';
import { SYNTHETIC_TIMELINE, syntheticFaceVector } from '@thoremin/ext-faces/lib/synthetic';
import { clampTuning, createLiveReader, DEFAULT_TUNING, fitDistance, flooredRejectRadius, liveModel, restOf, tunedRejectRadius, tuneVector } from '@thoremin/ext-faces/lib/live';
import { addSample, categoryOf, CORRECTION_CUE, moveSample } from '@thoremin/ext-faces/lib/corrections';

/** A categorizer carved from the synthetic face, in `mode`. */
function syntheticCategorizer(mode: 'reject' | 'partition'): PersonalCategorizer {
  const take = createFaceTake();
  take.start(0);
  const ms = SYNTHETIC_TIMELINE.restMs + 12 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
  for (let f = 0, t = 0; t <= ms; f++, t = (f * 1000) / 30) take.push(syntheticFaceVector(t, f), t);
  expect(take.stop()).toBe(true);
  const session = take.session();
  const carver = carverFor(session, take.restVectors(), mode);
  const view = carveView({ session, restVectors: take.restVectors(), carver, k: carver.suggestedK() });
  return categorizerFromModel(view.model, session.points(), { name: `synthetic ${mode}`, mode, modality: 'face' });
}

const ownAcceptance = (c: PersonalCategorizer, model = liveModel(c).model) => {
  const members = c.categories.flatMap((cat) => cat.members);
  return members.filter((j) => !classify(model, c.samples[j].vector).rejected).length / members.length;
};

describe('the reject radius dial', () => {
  it('floors a file whose radius would reject its own faces', () => {
    const c = syntheticCategorizer('reject');
    const tiny = PersonalCategorizerSchema.parse({ ...c, rejectRadius: 1e-3 });
    // Untuned, the loaded model is born unable to recognise itself (P1's review finding).
    expect(ownAcceptance(tiny, modelFromCategorizer(tiny))).toBeLessThan(0.2);
    // Through the dial at x1, the floor holds: at least nine in ten of its own faces.
    expect(flooredRejectRadius(tiny)).toBeGreaterThan(1e-3);
    expect(ownAcceptance(tiny)).toBeGreaterThanOrEqual(0.9);
    // A sane stored radius is kept as the base, not lowered to the floor.
    expect(flooredRejectRadius(c)).toBeGreaterThanOrEqual(c.rejectRadius!);
  });

  it('scales the floored base, within its bounds', () => {
    const c = syntheticCategorizer('reject');
    const base = liveModel(c).baseRadius;
    expect(liveModel(c, { rejectScale: 2 }).model.rejectRadius).toBeCloseTo(base * 2);
    expect(liveModel(c, { rejectScale: 0.5 }).model.rejectRadius).toBeCloseTo(base * 0.5);
    // Out of range values are pulled in, not trusted.
    expect(liveModel(c, { rejectScale: 100 }).model.rejectRadius).toBeCloseTo(base * 3);
    expect(clampTuning({ rejectScale: Number.NaN }).rejectScale).toBe(DEFAULT_TUNING.rejectScale);
  });

  it('is clamped out in partition mode: the radius stays NO_REJECT_RADIUS, finite, and persists', () => {
    const c = syntheticCategorizer('partition');
    for (const rejectScale of [0.5, 1, 3]) {
      const m = liveModel(c, { rejectScale }).model;
      expect(m.rejectRadius).toBe(NO_REJECT_RADIUS);
      expect(Number.isFinite(m.rejectRadius)).toBe(true);
      expect(TrainedModelSchema.safeParse(m).success).toBe(true);
    }
    expect(tunedRejectRadius(NO_REJECT_RADIUS, 'reject', 3)).toBe(NO_REJECT_RADIUS);
    expect(tunedRejectRadius(5, 'partition', 3)).toBe(NO_REJECT_RADIUS);
  });
});

describe('sensitivity', () => {
  it('scales a live face from the rest: at x2 a half-strength face reads as the full one', () => {
    const c = syntheticCategorizer('reject');
    const live = liveModel(c, { sensitivity: 2 });
    expect(live.rest).not.toBeNull();
    const target = live.model.categories[0];
    const half: FeatureVector = {};
    for (const f of live.model.features) half[f] = live.rest![f] + 0.5 * (target.centroid[f] - live.rest![f]);
    const tuned = tuneVector(live, half);
    for (const f of live.model.features) expect(tuned[f]).toBeCloseTo(target.centroid[f], 6);
    // The reader settles on it after its entry hysteresis.
    const reader = createLiveReader(live);
    let r = reader.push(half);
    for (let i = 0; i < 5; i++) r = reader.push(half);
    expect(r.categoryId).toBe(target.id);
    // At x1, the same half face is not the full one.
    expect(tuneVector(liveModel(c), half)).toEqual(half);
  });

  it('measures from the neutral category in partition mode, and from nothing when there is none', () => {
    const c = syntheticCategorizer('partition');
    const live = liveModel(c);
    expect(live.rest).not.toBeNull();
    const renamed = { ...c, categories: c.categories.map((cat) => ({ ...cat, label: cat.label === 'neutral' ? 'calm' : cat.label })) };
    expect(restOf(renamed, live.model.features)).toBeNull();
    // No rest: the dial changes nothing.
    const v = c.samples[0].vector;
    expect(tuneVector(liveModel(renamed, { sensitivity: 2 }), v)).toEqual(v);
  });
});

/** Two categories on feature `f` (0 and 1), which also rises with log scale at `slope`. */
function distanceCategorizer({ slope, spread }: { slope: number; spread: number }): PersonalCategorizer {
  const samples: { vector: FeatureVector; t: number; cue: string }[] = [];
  const members: number[][] = [[], []];
  for (let cat = 0; cat < 2; cat++)
    for (let i = 0; i < 8; i++) {
      const logScale = Math.log(0.2) + spread * Math.sin(i * 1.7 + cat);
      members[cat].push(samples.length);
      samples.push({ vector: { 'face.f': cat + slope * (logScale - Math.log(0.2)) + 0.01 * Math.cos(i), 'face.g': 0.5 + 0.01 * Math.sin(i), 'face.head.scale': Math.exp(logScale) }, t: i, cue: 'x' });
    }
  return PersonalCategorizerSchema.parse({
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    name: 'distance',
    features: ['face.f', 'face.g'],
    weights: { 'face.f': 10, 'face.g': 10 },
    mode: 'partition',
    k: 2,
    samples,
    categories: [
      { id: 'cat-1', label: 'a', members: members[0] },
      { id: 'cat-2', label: 'b', members: members[1] },
    ],
  });
}

describe('the distance residual', () => {
  it('learns the slope against log scale within categories, and takes it out of a live face', () => {
    const c = distanceCategorizer({ slope: 2, spread: 0.2 });
    const fit = fitDistance(c, ['face.f', 'face.g']);
    expect(fit.proxy).toBe('face.head.scale');
    expect(fit.learned).toBe(true);
    expect(fit.slopes['face.f']).toBeCloseTo(2, 1);
    // Distance explains nothing of g (noise only): no slope, it is left alone.
    expect(fit.slopes['face.g']).toBeUndefined();
    // Category a, leaning in: scale x1.5 moves f by 2 * ln 1.5 = 0.81, nearer b than a.
    const leaning: FeatureVector = { 'face.f': 0 + 2 * Math.log(1.5), 'face.g': 0.5, 'face.head.scale': 0.2 * 1.5 };
    const off = liveModel(c);
    expect(classify(off.model, tuneVector(off, leaning), { temperature: off.temperature }).categoryId).toBe('cat-2');
    const on = liveModel(c, { distance: 1 });
    expect(classify(on.model, tuneVector(on, leaning), { temperature: on.temperature }).categoryId).toBe('cat-1');
  });

  it('a take keeps the distance proxy in its samples, out of the features', () => {
    const take = createFaceTake();
    take.start(0);
    const ms = SYNTHETIC_TIMELINE.restMs + 8 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
    for (let f = 0, t = 0; t <= ms; f++, t = (f * 1000) / 30) take.push({ ...syntheticFaceVector(t, f), 'face.head.scale': 0.2 + 0.03 * Math.sin(t / 900) }, t);
    expect(take.stop()).toBe(true);
    const session = take.session();
    const carver = carverFor(session, take.restVectors(), 'reject');
    const view = carveView({ session, restVectors: take.restVectors(), carver, k: carver.suggestedK() });
    const c = categorizerFromModel(view.model, session.points(), { name: 'scaled', mode: 'reject' });
    expect(c.features).not.toContain('face.head.scale');
    expect(c.samples.every((x) => Number.isFinite(x.vector['face.head.scale']))).toBe(true);
    expect(fitDistance(c, c.features).proxy).toBe('face.head.scale');
  });

  it('learns nothing from a take at one distance, or with no distance measure', () => {
    const still = distanceCategorizer({ slope: 2, spread: 0.001 });
    const fit = fitDistance(still, ['face.f', 'face.g']);
    expect(fit.learned).toBe(false);
    const leaning: FeatureVector = { 'face.f': 0.8, 'face.g': 0.5, 'face.head.scale': 0.3 };
    expect(tuneVector(liveModel(still, { distance: 1 }), leaning)).toEqual(leaning);
    const none = syntheticCategorizer('reject');
    expect(liveModel(none).distance.proxy).toBeNull();
  });
});

describe('corrections', () => {
  it('"this face is X" adds the live face to X as a sample, and the model is derived again', () => {
    const c = syntheticCategorizer('reject');
    const target = c.categories[0];
    const face = { ...c.samples[target.members[0]].vector, 'hand.right.x': 0.5 };
    const r = addSample(c, target.id, face, { t: 42 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.categorizer.samples).toHaveLength(c.samples.length + 1);
    expect(r.categorizer.samples.at(-1)!.cue).toBe(CORRECTION_CUE);
    expect(categoryOf(r.categorizer, c.samples.length)).toBe(target.id);
    expect(modelFromCategorizer(r.categorizer).categories[0].size).toBe(target.members.length + 1);
    expect(addSample(c, 'nope', face).ok).toBe(false);
    expect(addSample(c, target.id, { 'hand.right.x': 0.5 })).toEqual({ ok: false, error: 'no face in view' });
  });

  it('moves a sample between categories or out of them, and never empties one', () => {
    const c = syntheticCategorizer('reject');
    const [a, b] = c.categories;
    const j = a.members[0];
    const moved = moveSample(c, j, b.id);
    expect(moved.ok && categoryOf(moved.categorizer, j)).toBe(b.id);
    const out = moveSample(c, j, null);
    expect(out.ok && categoryOf(out.categorizer, j)).toBeNull();
    // Out of every category in reject mode, it joins the neutral faces the rest is measured from.
    if (out.ok) expect(restOf(out.categorizer, c.features)).not.toEqual(restOf(c, c.features));
    const lonely = PersonalCategorizerSchema.parse({ ...c, categories: c.categories.map((x) => (x.id === a.id ? { ...x, members: [j] } : { ...x, members: x.members.filter((m) => m !== j) })) });
    const refused = moveSample(lonely, j, b.id);
    expect(refused.ok).toBe(false);
    expect(moveSample(c, c.samples.length + 3, b.id).ok).toBe(false);
  });
});
