/**
 * Neutral as a modelled null class (#385 E5, #426), in the SDK: the classifier reads a vector
 * nearest the taught Neutral as no category (in either setting of `strangers`), the tracker
 * enters it like a category and never holds through it, `trainNeutral` keeps two different
 * "nothings" apart, a merged take sorts a new resting face into Neutral, and the strangers
 * switch moves no hold. What old files classify as is `test/faces/classify_golden.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { classify, createCategoryTracker, trainModel, trainNeutral } from '@thoremin/sdk/enroll/classify';
import { categorizerFromModel, modelFromCategorizer, NO_REJECT_RADIUS, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { mergeSession } from '@thoremin/sdk/enroll/from_model';
import { mergeCategories, moveHolds, setNeutralTrained, setStrangers } from '@thoremin/sdk/enroll/sorting';
import type { FeatureVector, TrainedModel } from '@thoremin/sdk/enroll/types';

const F = ['x', 'y'];
const W = { x: 1, y: 1 };
const v = (x: number, y: number): FeatureVector => ({ x, y });

/** Two categories (around (4,0) and (0,4)), and a Neutral cloud around the origin. */
function file(strangers: 'neutral' | 'nearest' = 'neutral'): PersonalCategorizer {
  const points = [
    v(4, 0), v(4.2, 0.1), v(3.9, -0.1), // cat-1
    v(0, 4), v(0.1, 4.2), v(-0.1, 3.9), // cat-2
    v(0, 0), v(0.1, 0.1), v(-0.1, 0), v(0, -0.1), v(0.1, -0.1), // neutral
  ].map((vector, i) => ({ vector, t: i, cue: 'faces' }));
  const model = trainModel(points.map((p) => p.vector), [[0, 1, 2], [3, 4, 5]], F, W);
  return categorizerFromModel(model, points, { name: 'toy', strangers });
}

describe('the classifier reads the taught Neutral as no category', () => {
  it('a face nearest Neutral is none of these in both settings, by example and not by rejection', () => {
    for (const strangers of ['neutral', 'nearest'] as const) {
      const model = modelFromCategorizer(file(strangers));
      expect(model.neutral).toHaveLength(1);
      // Within the reject radius of cat-1 (or with no radius at all), yet nearer Neutral.
      const r = classify(model, v(1.5, 0));
      expect(r).toMatchObject({ categoryId: null, neutral: true, rejected: false });
      expect(r.neutralMembership).toBeGreaterThan(0.5);
      expect(classify(model, v(3.8, 0))).toMatchObject({ categoryId: 'cat-1', neutral: false });
    }
  });

  it('untrained (an older file), the same Neutral holds change nothing', () => {
    const c = { ...file('nearest'), neutralTrained: false };
    const model = modelFromCategorizer(c);
    expect(model.neutral).toBeUndefined();
    expect(model.rejectRadius).toBe(NO_REJECT_RADIUS);
    expect(classify(model, v(1.5, 0))).toEqual({ categoryId: 'cat-1', memberships: expect.any(Object), distance: expect.any(Number), rejected: false });
  });

  it('strangers read as Neutral still reject a face far from everything', () => {
    const model = modelFromCategorizer(file('neutral'));
    expect(classify(model, v(30, 30))).toMatchObject({ categoryId: null, rejected: true, neutral: false });
    // ...and as the nearest face, it is that face (the open-set rule is the switch's alone).
    expect(classify(modelFromCategorizer(file('nearest')), v(30, 20))).toMatchObject({ categoryId: 'cat-1', rejected: false });
  });

  it('the memberships leave Neutral its share, and sum to one with it', () => {
    const model = modelFromCategorizer(file());
    const r = classify(model, v(0.5, 0.5));
    const cats = Object.values(r.memberships).reduce((a, b) => a + b, 0);
    expect(cats + r.neutralMembership!).toBeCloseTo(1, 12);
    expect(cats).toBeLessThan(0.5);
  });
});

describe('the tracker treats Neutral as a class', () => {
  const model = modelFromCategorizer(file('neutral'));
  const run = (holdOnReject: boolean, frames: FeatureVector[]) => {
    const t = createCategoryTracker(model, { enterFrames: 3, exitFrames: 8, holdOnReject });
    return frames.map((f) => t.push(f).categoryId);
  };

  it('enters Neutral after the entry hysteresis (not the longer exit one), and never holds through it', () => {
    for (const hold of [true, false]) {
      const out = run(hold, [...Array(4).fill(v(4, 0)), ...Array(4).fill(v(0, 0))]);
      expect(out.slice(0, 4)).toEqual([null, null, 'cat-1', 'cat-1']);
      // Two frames of Neutral keep the category (hysteresis), the third commits nothing.
      expect(out.slice(4)).toEqual(['cat-1', 'cat-1', null, null]);
    }
  });

  it('a face alternating Neutral and rejected frames still leaves its category (review of #426)', () => {
    const alternating = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? v(0, 0) : v(30, 30)));
    for (const hold of [true, false]) {
      const out = run(hold, [...Array(4).fill(v(4, 0)), ...alternating]);
      expect(out.at(-1)).toBeNull();
    }
  });

  it('a single Neutral frame inside a held category changes nothing', () => {
    const out = run(true, [...Array(4).fill(v(4, 0)), v(0, 0), ...Array(3).fill(v(4, 0))]);
    expect(out.slice(2)).toEqual(Array(6).fill('cat-1'));
  });
});

describe('trainNeutral', () => {
  const cats = [{ radius: 0.2 }, { radius: 0.3 }];
  it('one compact cloud is one prototype', () => {
    const vs = [v(0, 0), v(0.1, 0), v(0, 0.1), v(0.1, 0.1)];
    expect(trainNeutral(vs, [0, 1, 2, 3], F, W, cats).map((p) => p.members)).toEqual([[0, 1, 2, 3]]);
  });

  it('two different nothings (a rest and a look away) are two prototypes, not one centroid between them', () => {
    const vs = [v(0, 0), v(0.1, 0), v(0, 0.1), v(0, -6), v(0.1, -6), v(0, -6.1)];
    const protos = trainNeutral(vs, [0, 1, 2, 3, 4, 5], F, W, cats);
    expect(protos.map((p) => p.id)).toEqual(['neutral-1', 'neutral-2']);
    expect(protos.map((p) => p.members)).toEqual([[0, 1, 2], [3, 4, 5]]);
  });

  it('is bounded: at most maxPrototypes, none without holds', () => {
    const vs = Array.from({ length: 12 }, (_, i) => v(i * 10, 0));
    const idx = vs.map((_, i) => i);
    expect(trainNeutral(vs, idx, F, W, cats, { maxPrototypes: 3 })).toHaveLength(3);
    expect(trainNeutral(vs, [], F, W, cats)).toEqual([]);
  });

  it('has no cliff: the split is decided on a strided sample, and one more hold does not reshape the class', () => {
    const cloud = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? v((i % 7) * 0.01, 0) : v((i % 5) * 0.01, -6)));
    for (const n of [119, 120, 121, 400, 401]) {
      const vs = cloud(n);
      const protos = trainNeutral(vs, vs.map((_, i) => i), F, W, cats);
      expect(protos).toHaveLength(2);
      expect(protos.reduce((a, p) => a + p.size, 0)).toBe(n);
    }
  });

  it('a stray hold or two is never a prototype of its own (review of #426)', () => {
    const vs = [v(0, 0), v(0.1, 0), v(0, 0.1), v(0.1, 0.1), v(-0.1, 0), v(3.5, 0)];
    const protos = trainNeutral(vs, vs.map((_, i) => i), F, W, [{ radius: 1 }]);
    expect(protos.map((p) => p.members)).toEqual([[0, 1, 2, 3, 4, 5]]);
  });

  it('categories of radius 0 do not split a tight cloud', () => {
    const vs = Array.from({ length: 10 }, (_, i) => v((i % 3) * 0.05, (i % 4) * 0.05));
    expect(trainNeutral(vs, vs.map((_, i) => i), F, W, [{ radius: 0 }, { radius: 0 }])).toHaveLength(1);
  });
});

describe('the categorizer around it', () => {
  it('a merged take sorts a new resting face into Neutral (it is nearer than any category)', () => {
    const base = file('nearest');
    const { categorizer, assigned } = mergeSession(base, [{ id: 't2:0', vector: v(1.2, 0.1), t: 0, cue: 'faces' }, { id: 't2:1', vector: v(4.1, 0), t: 1, cue: 'faces' }]);
    expect(assigned).toEqual([-1, 0]);
    expect(categorizer.neutral).toContain('t2:0');
    // Untrained, the same face joined the nearest category, as before.
    expect(mergeSession({ ...base, neutralTrained: false }, [{ id: 't2:0', vector: v(1.2, 0.1), t: 0, cue: 'faces' }]).assigned).toEqual([0]);
  });

  it('the strangers switch moves no hold: it drops the reject radius, and trains one back', () => {
    const c = file('neutral');
    const near = setStrangers(c, 'nearest');
    expect(near.ok).toBe(true);
    if (!near.ok) return;
    expect(near.categorizer.rejectRadius).toBeUndefined();
    const back = setStrangers(near.categorizer, 'neutral');
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    for (const x of [near.categorizer, back.categorizer]) {
      expect({ c: x.categories, n: x.neutral, s: x.samples }).toEqual({ c: c.categories, n: c.neutral, s: c.samples });
    }
    // Trained from the Neutral holds' spread, floored to accept the categories' holds.
    const model: TrainedModel = modelFromCategorizer(back.categorizer);
    for (const s of c.samples.slice(0, 6)) expect(classify(model, s.vector).categoryId).not.toBeNull();
  });

  it('teaching Neutral is an edit that turns the null class on', () => {
    const old = { ...file('neutral'), neutralTrained: false };
    expect(modelFromCategorizer(old).neutral).toBeUndefined();
    const r = setNeutralTrained(old, true);
    expect(r.ok && modelFromCategorizer(r.categorizer).neutral?.length).toBe(1);
  });
});

describe('holds a whole-category merge moved to Neutral are not folded away (#536)', () => {
  // Eight resting holds around the origin, a big category at (4,0) and a one-hold category
  // at (0,4): merging the small one into Neutral is the player's "this face means nothing".
  function withSmallCategory(): PersonalCategorizer {
    const points = [
      v(4, 0), v(4.2, 0.1), v(3.9, -0.1), v(4.1, 0.2), // cat-1
      v(3, 3), // cat-2, one hold
      v(0, 0), v(0.1, 0.1), v(-0.1, 0), v(0, -0.1), v(0.1, -0.1), v(0.05, 0), v(-0.05, 0.05), v(0, 0.1), // neutral
    ].map((vector, i) => ({ vector, t: i, cue: 'faces' }));
    const model = trainModel(points.map((p) => p.vector), [[0, 1, 2, 3], [4]], F, W);
    return categorizerFromModel(model, points, { name: 'toy', strangers: 'neutral' });
  }
  const merge = (c: PersonalCategorizer) => {
    const r = mergeCategories(c, 'cat-2', 'neutral');
    if (!r.ok) throw new Error(r.error);
    return r.categorizer;
  };

  it('a merged hold is a Neutral prototype of its own; unmarked, the fold swallows it', () => {
    const merged = merge(withSmallCategory());
    expect(merged.mergedNeutral).toHaveLength(1);
    const probe = v(3, 2.9);
    const marked = modelFromCategorizer(merged);
    expect(marked.neutral).toHaveLength(2);
    expect(classify(marked, probe)).toMatchObject({ categoryId: null, neutral: true });
    const { mergedNeutral: _m, ...unmarked } = merged;
    void _m;
    const folded = modelFromCategorizer(unmarked);
    expect(folded.neutral).toHaveLength(1);
    expect(classify(folded, probe).neutral).toBe(false);
  });

  it('the mark lasts only while the hold stays in Neutral', () => {
    const merged = merge(withSmallCategory());
    const id = merged.mergedNeutral![0];
    const moved = moveHolds(merged, [id], 'cat-1');
    expect(moved.ok && moved.categorizer.mergedNeutral).toBeFalsy();
  });

  it('a file with no merged holds classifies exactly as before (golden)', () => {
    const c = file('neutral');
    const vs = c.samples.map((s) => s.vector);
    const idx = c.samples.flatMap((s, i) => (c.neutral.includes(s.id) ? [i] : []));
    const cats = [{ radius: 0.2 }, { radius: 0.3 }];
    expect(trainNeutral(vs, idx, F, W, cats, { merged: [] })).toEqual(trainNeutral(vs, idx, F, W, cats));
    expect(c.mergedNeutral).toBeUndefined();
    const model = modelFromCategorizer(c);
    expect(model.neutral).toHaveLength(1);
    expect(classify(model, v(1.5, 0))).toMatchObject({ categoryId: null, neutral: true });
  });

  it('is bounded: merged prototypes share maxPrototypes with the rest', () => {
    const vs = [...Array.from({ length: 6 }, (_, i) => v(i * 0.01, 0)), ...Array.from({ length: 6 }, (_, i) => v(i * 10, 50))];
    const idx = vs.map((_, i) => i);
    const protos = trainNeutral(vs, idx, F, W, [{ radius: 0.2 }], { merged: [6, 7, 8, 9, 10, 11], maxPrototypes: 3 });
    expect(protos.length).toBeLessThanOrEqual(3);
    expect(protos.reduce((a, p) => a + p.size, 0)).toBe(12);
  });
});
