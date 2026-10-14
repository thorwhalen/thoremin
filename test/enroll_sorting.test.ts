/**
 * One editable carve (#385 E4), the pure half: the constrained forest, and the edits over a
 * categorizer file (`@thoremin/sdk/enroll/sorting`). The design's acceptance, stated as tests:
 * pins survive k changes (a property over random pin sets), cannot-link is never violated, k is
 * clamped by the pinned categories, a re-cut is path-independent, and the schema's "every hold
 * in one place" holds after every edit.
 */
import { describe, expect, it } from 'vitest';
import { buildConstrainedForest, buildHierarchy, cutAt, cutForest, forestRange } from '@thoremin/sdk/enroll/cluster';
import { ASIDE_BIN, CATEGORIZER_FORMAT, CATEGORIZER_VERSION, NEUTRAL_BIN, PersonalCategorizerSchema, modelFromCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import {
  NEW_CATEGORY,
  deleteHolds,
  mergeCategories,
  moveHolds,
  nameCategory,
  pinnedCategories,
  pinsHold,
  placeOf,
  recut,
  recutRange,
  splitCategory,
  type SortResult,
} from '@thoremin/sdk/enroll/sorting';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/** A small seeded PRNG (mulberry32): the property runs are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `blobs` clusters of `per` holds in two features, jittered. */
function vectors(rand: () => number, blobs = 4, per = 6): FeatureVector[] {
  const out: FeatureVector[] = [];
  for (let b = 0; b < blobs; b++) for (let i = 0; i < per; i++) out.push({ x: b * 3 + rand() * 0.8, y: (b % 2) * 2 + rand() * 0.8 });
  return out;
}

/** A categorizer over `vs`, every hold in one category, then re-cut at `k` (no pins). */
function doc(vs: readonly FeatureVector[], k = 3, strangers: 'neutral' | 'nearest' = 'nearest'): PersonalCategorizer {
  const ids = vs.map((_, i) => `t:${i}`);
  const base = PersonalCategorizerSchema.parse({
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    name: 'test',
    features: ['x', 'y'],
    weights: { x: 1, y: 1 },
    strangers,
    ...(strangers === 'neutral' ? { rejectRadius: 1 } : {}),
    samples: vs.map((vector, i) => ({ id: ids[i], vector, t: i, cue: 'c' })),
    categories: [{ id: 'cat-1', label: '', members: ids }],
    neutral: [],
  });
  return ok(recut(base, k));
}

function ok(r: SortResult): PersonalCategorizer {
  if (!r.ok) throw new Error(r.error);
  // Every edit's output is a valid file, and keeps the pin invariant.
  PersonalCategorizerSchema.parse(r.categorizer);
  expect(pinsHold(r.categorizer)).toBe(true);
  return r.categorizer;
}

describe('the constrained forest', () => {
  it('without constraints is the plain hierarchy, cut for cut', () => {
    const vs = vectors(rng(1));
    const plain = buildHierarchy(vs, ['x', 'y'], {});
    const forest = buildConstrainedForest(vs, ['x', 'y'], {});
    expect(forest.roots).toHaveLength(1);
    for (let k = 1; k <= vs.length; k++) expect(cutForest(forest, k)).toEqual(cutAt(plain, k));
  });

  it('keeps a must-link group whole and two groups apart at every k', () => {
    const vs = vectors(rng(2));
    // Two groups that are the SAME blob: nothing unconstrained would split them.
    const forest = buildConstrainedForest(vs, ['x', 'y'], {}, { mustLink: [[0, 1], [2, 3]] });
    expect(forestRange(forest)).toEqual({ minK: 2, maxK: vs.length - 2 });
    for (let k = 0; k <= vs.length + 2; k++) {
      const cut = cutForest(forest, k);
      const a = cut.find((c) => c.includes(0))!;
      const b = cut.find((c) => c.includes(2))!;
      expect(a).toContain(1);
      expect(b).toContain(3);
      expect(a).not.toBe(b);
      expect(cut.flat().sort((p, q) => p - q)).toEqual(vs.map((_, i) => i));
    }
  });

  it('refuses a point in two groups', () => {
    expect(() => buildConstrainedForest([{ x: 0 }, { x: 1 }], ['x'], {}, { mustLink: [[0], [0, 1]] })).toThrow(/two groups/);
  });
});

describe('re-cut honouring pins', () => {
  it('pins survive k changes, cannot-link holds, k is clamped (a property over random pin sets)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = rng(seed);
      let c = doc(vectors(rand, 4, 5), 3);
      // Random moves: each a pin (to a category, a new one, or a bin).
      const moves = 1 + Math.floor(rand() * 6);
      for (let m = 0; m < moves; m++) {
        const s = c.samples[Math.floor(rand() * c.samples.length)].id;
        const r = rand();
        const to = r < 0.15 ? NEUTRAL_BIN : r < 0.25 ? ASIDE_BIN : r < 0.4 ? NEW_CATEGORY : c.categories[Math.floor(rand() * c.categories.length)].id;
        const next = moveHolds(c, [s], to);
        if (next.ok) c = ok(next);
      }
      const pins = { ...(c.pins ?? {}) };
      const pinnedCats = pinnedCategories(c);
      const range = recutRange(c);
      expect(range.minK).toBe(Math.max(1, pinnedCats.size));
      for (const k of [1, 2, 3, 5, 8, 0, 100, range.minK - 1, range.maxK + 1]) {
        const cut = ok(recut(c, k));
        // Clamped.
        expect(cut.categories.length).toBe(Math.max(range.minK, Math.min(range.maxK, k)));
        // Every pin is where it says (must-link: one category per pin target).
        for (const [id, to] of Object.entries(pins)) expect(placeOf(cut, id)).toBe(to);
        // Cannot-link: no category holds holds pinned to two different categories.
        for (const cat of cut.categories) {
          const targets = new Set(cat.members.flatMap((m) => (pins[m] !== undefined ? [pins[m]] : [])));
          expect(targets.size).toBeLessThanOrEqual(1);
          if (targets.size === 1) expect([...targets][0]).toBe(cat.id);
        }
        // Path-independent: a re-cut depends on the samples, bins and pins only.
        expect(ok(recut(ok(recut(c, k + 2)), k))).toEqual(cut);
      }
    }
  });

  it('with no pins it is the carve the hierarchy gives', () => {
    const vs = vectors(rng(7));
    const c = doc(vs, 4);
    const clusters = cutAt(buildHierarchy(vs, ['x', 'y'], { x: 1, y: 1 }), 4);
    expect(c.categories.map((x) => x.members)).toEqual(clusters.map((cl) => cl.map((i) => `t:${i}`)));
    expect(c.categories.map((x) => x.id)).toEqual(['cat-1', 'cat-2', 'cat-3', 'cat-4']);
  });

  it('a pinned category keeps its id and label; others are new and unnamed', () => {
    let c = doc(vectors(rng(3)), 4);
    const target = c.categories[2];
    c = ok(nameCategory(c, target.id, 'grin'));
    const cut = ok(recut(c, 2));
    expect(cut.categories.find((x) => x.id === target.id)!.label).toBe('grin');
    expect(cut.categories.filter((x) => x.id !== target.id).every((x) => x.label === '')).toBe(true);
  });

  it('a reopened categorizer (no take) re-cuts: unpinned bins stay, categories re-cut', () => {
    const c0 = doc(vectors(rng(4)), 2, 'neutral');
    const binned = c0.categories[0].members.slice(0, 2);
    // A file as saved: two holds in neutral, unpinned (the rest cloud).
    const saved = PersonalCategorizerSchema.parse({
      ...c0,
      categories: c0.categories.map((x, i) => (i === 0 ? { ...x, members: x.members.slice(2) } : x)),
      neutral: binned,
    });
    const cut = ok(recut(saved, 4));
    expect(cut.categories).toHaveLength(4);
    expect(cut.neutral).toEqual(binned);
    // The reject radius is trained again (floored to accept the training holds), from the radius
    // given, so k up and down does not drift.
    expect(ok(recut(ok(recut(saved, 4, { baseRejectRadius: 1 })), 2, { baseRejectRadius: 1 })).rejectRadius).toBe(ok(recut(saved, 2, { baseRejectRadius: 1 })).rejectRadius);
    expect(() => modelFromCategorizer(cut)).not.toThrow();
  });

  it('places unpinned holds by the neutral set it is given (a fresh take changing mode)', () => {
    const c = doc(vectors(rng(5)), 3, 'neutral');
    const rest = new Set(c.samples.slice(0, 5).map((s) => s.id));
    const cut = ok(recut(c, 3, { neutral: rest }));
    expect(new Set(cut.neutral)).toEqual(rest);
    const back = ok(recut(cut, 3, { neutral: new Set() }));
    expect(back.neutral).toEqual([]);
  });
});

describe('the forest cache', () => {
  it('is keyed on the vectors, not the ids: same ids, other faces, another cut', () => {
    const one = doc(vectors(rng(12)), 3);
    const other = PersonalCategorizerSchema.parse({ ...one, samples: one.samples.map((x, i) => ({ ...x, vector: { x: (i % 3) * 10, y: 0 } })) });
    const cut = ok(recut(other, 3));
    for (const cat of cut.categories) {
      const xs = new Set(cat.members.map((m) => other.samples.find((x) => x.id === m)!.vector.x));
      expect(xs.size).toBe(1);
    }
  });
});

describe('the edits', () => {
  it('moves pin, and a move that would empty a category is refused', () => {
    const c = doc(vectors(rng(6)), 3);
    const [a, b] = c.categories;
    const moved = ok(moveHolds(c, [a.members[0]], b.id));
    expect(placeOf(moved, a.members[0])).toBe(b.id);
    expect(moved.pins).toEqual({ [a.members[0]]: b.id });
    const r = moveHolds(c, a.members, b.id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/keeps at least one/);
  });

  it('a new category from a selection', () => {
    const c = doc(vectors(rng(8)), 2);
    const sel = c.categories[0].members.slice(0, 2);
    const next = ok(moveHolds(c, sel, NEW_CATEGORY));
    const made = next.categories.find((x) => !c.categories.some((y) => y.id === x.id))!;
    expect(made.members).toEqual(sel);
    expect(made.label).toBe('');
    expect(recutRange(next).minK).toBe(1);
  });

  it('delete removes holds and a category it empties; never the last category', () => {
    const c = ok(moveHolds(doc(vectors(rng(9)), 3), [doc(vectors(rng(9)), 3).categories[0].members[0]], NEUTRAL_BIN));
    const third = c.categories[2];
    const next = ok(deleteHolds(c, third.members));
    expect(next.categories.map((x) => x.id)).not.toContain(third.id);
    expect(next.samples).toHaveLength(c.samples.length - third.members.length);
    const pinned = Object.keys(c.pins!)[0];
    expect(ok(deleteHolds(c, [pinned])).pins).toBeUndefined();
    expect(deleteHolds(c, c.categories.flatMap((x) => x.members)).ok).toBe(false);
  });

  it('merge keeps the pair together at every k; split keeps the halves apart', () => {
    const c = doc(vectors(rng(10)), 4);
    const [a, b] = c.categories;
    const merged = ok(mergeCategories(c, a.id, b.id));
    expect(merged.categories).toHaveLength(3);
    for (let k = 1; k <= 8; k++) {
      const cut = ok(recut(merged, k));
      expect(new Set([...a.members, ...b.members].map((m) => placeOf(cut, m)))).toEqual(new Set([b.id]));
    }
    const split = ok(splitCategory(c, c.categories[0].id));
    expect(split.categories).toHaveLength(5);
    expect(recutRange(split).minK).toBe(2);
    expect(ok(recut(split, 1)).categories).toHaveLength(2);
    expect(splitCategory(ok(moveHolds(c, [c.categories[0].members[0]], NEW_CATEGORY)), 'cat-5').ok).toBe(false);
  });

  it('merge into Neutral (#444): the holds go to the Neutral bin, pinned, at every k; the category is dropped; never the last one', () => {
    const c = doc(vectors(rng(12)), 4);
    const gone = c.categories[1];
    const into = ok(mergeCategories(c, gone.id, NEUTRAL_BIN));
    expect(into.categories.map((x) => x.id)).not.toContain(gone.id);
    expect(into.categories).toHaveLength(3);
    for (const id of gone.members) {
      expect(into.neutral).toContain(id);
      expect(into.pins?.[id]).toBe(NEUTRAL_BIN);
    }
    expect(into.samples).toHaveLength(c.samples.length);
    for (let k = 1; k <= 6; k++) for (const id of gone.members) expect(placeOf(ok(recut(into, k)), id)).toBe(NEUTRAL_BIN);
    expect(mergeCategories(c, 'nope', NEUTRAL_BIN).ok).toBe(false);
    let one = c;
    while (one.categories.length > 1) one = ok(mergeCategories(one, one.categories[0].id, one.categories[1].id));
    expect(mergeCategories(one, one.categories[0].id, NEUTRAL_BIN)).toEqual({ ok: false, error: 'that would leave no category; a categorizer keeps at least one' });
  });

  it('a name anchors its category: refused when taken, kept at every k', () => {
    let c = doc(vectors(rng(11)), 4);
    c = ok(nameCategory(c, c.categories[1].id, 'smile'));
    expect(nameCategory(c, c.categories[2].id, 'Smile').ok).toBe(false);
    const id = c.categories[1].id;
    for (let k = 1; k <= 6; k++) expect(ok(recut(c, k)).categories.find((x) => x.id === id)?.label).toBe('smile');
  });
});
