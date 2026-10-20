/**
 * A category's radius from the holds' supporting frames (#413), on the real face recording
 * `video_face_expressions`: the option is off unless asked for (no `supports` = today's model, a
 * categorizer without `radiusFrom` = the model it always had), and on, the reject radius is steadier
 * against the recording's own frames than the one measured from still-points alone.
 */
import { describe, expect, it } from 'vitest';
import { classify, trainModel, modelFromCategorizer, categorizerFromModel, type FeatureVector } from '@thoremin/sdk/enroll';
import { setRadiusFrom } from '@thoremin/sdk/enroll/sorting';
import { BLENDSHAPE_NAME_BY_FEATURE } from '@thoremin/sdk/features/face_catalog';
import { SEGMENTS, recordedFrames, vectorOf } from '../helpers/faceRecording';

const HOLD_FRAMES = 6;
const MIN_JITTER = 0.01;
const FEATURES = Object.keys(BLENDSHAPE_NAME_BY_FEATURE);
const range = ([a, b]: readonly [number, number]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const mean = (rows: FeatureVector[]): FeatureVector => Object.fromEntries(FEATURES.map((f) => [f, rows.reduce((s, r) => s + (r[f] ?? 0), 0) / rows.length]));
const chunks = (idx: number[]) => Array.from({ length: Math.floor(idx.length / HOLD_FRAMES) }, (_, i) => idx.slice(i * HOLD_FRAMES, (i + 1) * HOLD_FRAMES));

function carve() {
  const vec = recordedFrames().map(vectorOf);
  const rest = range(SEGMENTS.rest).map((i) => vec[i]);
  const weights = Object.fromEntries(
    FEATURES.map((f) => {
      const d = rest.slice(1).map((v, i) => (v[f] ?? 0) - (rest[i][f] ?? 0));
      return [f, 1 / Math.max(Math.sqrt(d.reduce((a, x) => a + x * x, 0) / Math.max(1, d.length)), MIN_JITTER)];
    }),
  );
  const smile = chunks(range(SEGMENTS.smile));
  const open = chunks(range(SEGMENTS.open));
  const holds = [...smile, ...open];
  const vectors = holds.map((g) => mean(g.map((i) => vec[i])));
  const supports = holds.map((g) => g.map((i) => vec[i]));
  const clusters = [smile.map((_, k) => k), open.map((_, k) => smile.length + k)];
  return { vec, rest, weights, vectors, supports, clusters, frames: [smile.flat(), open.flat()] };
}

describe('radius from supporting frames (#413)', () => {
  const x = carve();
  const train = (extra = {}) => trainModel(x.vectors, x.clusters, FEATURES, x.weights, { restVectors: x.rest, ...extra });

  it('is off unless supports are given: the model is byte-identical', () => {
    expect(train({ supports: undefined })).toEqual(train());
  });

  it('a hold with no frames counts its still-point: all-absent supports change nothing', () => {
    expect(train({ supports: x.vectors.map(() => undefined) })).toEqual(train());
  });

  it('measures the radius and the floor from the frames: wider, never narrower', () => {
    const a = train();
    const b = train({ supports: x.supports });
    b.categories.forEach((c, k) => expect(c.radius).toBeGreaterThanOrEqual(a.categories[k].radius));
    expect(b.rejectRadius).toBeGreaterThanOrEqual(a.rejectRadius);
    expect(b.categories.map((c) => c.centroid)).toEqual(a.categories.map((c) => c.centroid));
  });

  it('rejects fewer of the recording\'s own frames than the still-points alone', () => {
    const none = (m: ReturnType<typeof train>) => x.frames.flat().filter((i) => classify(m, x.vec[i]).categoryId === null).length;
    const a = none(train());
    const b = none(train({ supports: x.supports }));
    console.log(`frames read as none of these: holds ${a}, frames ${b} of ${x.frames.flat().length}`);
    expect(b).toBeLessThan(a);
  });

  it('a categorizer reads its frames only when radiusFrom says so, and setRadiusFrom round-trips', () => {
    const model = train();
    const pts = x.vectors.map((vector, i) => ({ vector, cue: 'c', support: x.supports[i] }));
    const file = categorizerFromModel(model, pts as never, { name: 't', strangers: 'neutral' });
    expect(file.radiusFrom).toBeUndefined();
    const before = modelFromCategorizer(file);
    const on = setRadiusFrom(file, 'frames');
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    expect(on.categorizer.radiusFrom).toBe('frames');
    const framed = modelFromCategorizer(on.categorizer);
    framed.categories.forEach((c, k) => expect(c.radius).toBeGreaterThanOrEqual(before.categories[k].radius));
    expect(framed.categories[0].radius).toBeGreaterThan(before.categories[0].radius);
    const off = setRadiusFrom(on.categorizer, 'holds');
    expect(off.ok && off.categorizer.radiusFrom).toBeUndefined();
    expect(off.ok && modelFromCategorizer(off.categorizer).categories.map((c) => c.radius)).toEqual(before.categories.map((c) => c.radius));
  });
});
