/**
 * A lean (#349): the face held while the player leans toward the camera and away. The take spreads
 * the lean's frames over several holds by distance, each pointing at the hold it leaned on; the
 * carve puts them with it (pinned), so the Distance dial's fit has one category seen at several
 * distances. Acceptance, in synthetic form: a take with the step enables the fit and keeps the
 * features distance explains, drops the ones it does not; a take without it learns nothing.
 */
import { describe, expect, it } from 'vitest';
import { createFaceTake, FACE_TAKE_DEFAULTS, leanParts } from '@thoremin/ext-faces/lib/take';
import { SYNTHETIC_TIMELINE, syntheticFaceVector } from '@thoremin/ext-faces/lib/synthetic';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { CATEGORIZER_FORMAT, CATEGORIZER_VERSION, PersonalCategorizerSchema } from '@thoremin/sdk/enroll/categorizer';
import { fitDistance } from '@thoremin/sdk/enroll/live';
import { placeOf, placeWith } from '@thoremin/sdk/enroll/sorting';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

const SCALE = 'face.head.scale';
const withScale = (v: FeatureVector, scale: number): FeatureVector => ({ ...v, [SCALE]: scale });

describe('leanParts', () => {
  const frames = (scales: number[]) => scales.map((s) => ({ [SCALE]: s, x: s }));
  it('cuts the frames into holds sorted by distance, spanning the range leaned through', () => {
    const parts = leanParts(faceModality, frames(Array.from({ length: 50 }, (_, i) => 0.5 + ((i * 7) % 50) / 50)), 5, 5);
    expect(parts).toHaveLength(5);
    const means = parts.map((p) => p.reduce((a, f) => a + f[SCALE], 0) / p.length);
    expect([...means].sort((a, b) => a - b)).toEqual(means);
    expect(means[4] - means[0]).toBeGreaterThan(0.5);
  });
  it('makes fewer holds from a short lean and none from a shorter one', () => {
    expect(leanParts(faceModality, frames(Array.from({ length: 12 }, (_, i) => 1 + i / 20)), 5, 5)).toHaveLength(2);
    expect(leanParts(faceModality, frames([1, 1.1, 1.2]), 5, 5)).toHaveLength(0);
  });
  it('keeps time order when the frames carry no distance proxy', () => {
    const parts = leanParts(faceModality, Array.from({ length: 10 }, (_, i) => ({ x: i })), 5, 5);
    expect(parts.map((p) => p.map((f) => f.x))).toEqual([[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]);
  });
});

describe('a lean in the take', () => {
  /** A take run on the synthetic face until it has taken a hold; returns it with the clock. */
  function takeWithAHold() {
    const take = createFaceTake();
    take.start(0);
    let f = 0;
    let t = 0;
    const limit = SYNTHETIC_TIMELINE.restMs + 3 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
    for (; take.pointCount() === 0 && t < limit; f++, t = (f * 1000) / 30) take.push(withScale(syntheticFaceVector(t, f), 1), t);
    return { take, f, t };
  }

  it('is refused with nothing to lean on, and otherwise makes holds that point at the hold before it', () => {
    const fresh = createFaceTake();
    fresh.start(0);
    expect(fresh.beginBurst(0, '', { lean: true })).toBe(false);

    const { take, f: f0, t: t0 } = takeWithAHold();
    const anchor = take.pointCount() - 1;
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(take.beginBurst(t0, '', { lean: true })).toBe(true);
    for (let i = 0; i < 60; i++) {
      const t = t0 + ((i + 1) * 1000) / 30;
      take.push(withScale(syntheticFaceVector(t0, f0 + i), 0.7 + (i / 59) * 0.6), t);
    }
    expect(take.endBurst(t0 + 2100)).toBe(true);
    const made = [...take.leans()];
    expect(made.length).toBe(FACE_TAKE_DEFAULTS.leanHolds);
    expect(made.every(([, on]) => on === anchor)).toBe(true);
    const scales = made.map(([i]) => take.session().points()[i].vector[SCALE]);
    expect([...scales].sort((a, b) => a - b)).toEqual(scales);
    expect(scales[scales.length - 1] - scales[0]).toBeGreaterThan(0.4);
  });
});

describe('placeWith', () => {
  const doc = (pins?: Record<string, string>) =>
    PersonalCategorizerSchema.parse({
      format: CATEGORIZER_FORMAT,
      version: CATEGORIZER_VERSION,
      name: 't',
      features: ['x'],
      weights: { x: 1 },
      strangers: 'nearest',
      samples: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, vector: { x: i < 2 ? i : 10 + i }, t: i, cue: 'c' })),
      categories: [
        { id: 'cat-1', label: 'one', members: ['a', 'b'] },
        { id: 'cat-2', label: 'two', members: ['c', 'd'] },
      ],
      neutral: [],
      ...(pins ? { pins } : {}),
    });

  it('puts a hold where the one it leans on is, pinned, and skips unknown ones', () => {
    const r = placeWith(doc(), [{ id: 'd', with: 'a' }, { id: 'zzz', with: 'a' }, { id: 'b', with: 'nope' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(placeOf(r.categorizer, 'd')).toBe('cat-1');
    expect(placeOf(r.categorizer, 'b')).toBe('cat-1');
    expect(r.categorizer.pins?.d).toBe('cat-1');
    expect(r.categorizer.pins?.a).toBe('cat-1');
  });
});

describe('the Distance dial learns from a lean', () => {
  /** Samples of two categories; `lean` adds the first category's face at five distances, with the
   *  clean feature following log scale and the other one not at all. */
  const categorizer = (lean: boolean) => {
    const samples = [
      { id: 'a', vector: withScale({ clean: 0.5, noise: 0.5 }, 1), t: 0, cue: 'c' },
      { id: 'b', vector: withScale({ clean: 0.52, noise: 0.52 }, 1), t: 1, cue: 'c' },
      { id: 'c', vector: withScale({ clean: 0.1, noise: 0.9 }, 1), t: 2, cue: 'c' },
      { id: 'd', vector: withScale({ clean: 0.12, noise: 0.88 }, 1), t: 3, cue: 'c' },
    ];
    const leans = lean
      ? [0.6, 0.8, 1, 1.25, 1.6].map((s, i) => ({ id: `l${i}`, vector: withScale({ clean: 0.5 + 0.2 * Math.log(s), noise: [0.9, 0.1, 0.7, 0.3, 0.5][i] }, s), t: 10 + i, cue: 'c' }))
      : [];
    return PersonalCategorizerSchema.parse({
      format: CATEGORIZER_FORMAT,
      version: CATEGORIZER_VERSION,
      name: 't',
      features: ['clean', 'noise'],
      weights: { clean: 1, noise: 1 },
      strangers: 'nearest',
      samples: [...samples, ...leans],
      categories: [
        { id: 'cat-1', label: 'one', members: ['a', 'b', ...leans.map((l) => l.id)] },
        { id: 'cat-2', label: 'two', members: ['c', 'd'] },
      ],
      neutral: [],
    });
  };

  it('learns nothing from a take at one distance', () => {
    expect(fitDistance(categorizer(false), ['clean', 'noise']).learned).toBe(false);
  });
  it('learns the feature distance explains and leaves the one it does not', () => {
    const fit = fitDistance(categorizer(true), ['clean', 'noise']);
    expect(fit.learned).toBe(true);
    expect(fit.slopes.clean).toBeCloseTo(0.2, 1);
    expect(fit.slopes.noise).toBeUndefined();
  });
});
