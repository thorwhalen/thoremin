/**
 * The carve-quality chip against the live readout, on the real face recording
 * `video_face_expressions` (#553, the check #436 asked for): are the chips, now with a category's
 * spread taken from the holds' supporting frames (#552), closer to what Trying shows frame by frame?
 *
 * The recording is 97 frames: a resting face, a smile, a smile with the mouth open. Holds are cut
 * from it as the still-point sampler would cut a longer take: consecutive dwell windows
 * (`HOLD_FRAMES`), each hold the mean of its frames and those frames its support. The "live
 * readout" is every recorded frame classified against the model (what the tracker sees), with the
 * margin meter's state; its flips are the frame-to-frame changes of the winning category.
 * The numbers this prints are recorded in `docs/research/carve-quality-vs-live.md`.
 */
import { describe, expect, it } from 'vitest';
import { classify, trainModel, type FeatureVector } from '@thoremin/sdk/enroll';
import { carveQuality, liveMargin } from '@thoremin/sdk/enroll/quality';
import { BLENDSHAPE_NAME_BY_FEATURE } from '@thoremin/sdk/features/face_catalog';
import { SEGMENTS, recordedFrames, vectorOf } from '../helpers/faceRecording';

/** The dwell a hold averages, in frames (the sweep in the test varies it). */
const HOLD_FRAMES = 6;
const MIN_JITTER = 0.01;
const FEATURES = Object.keys(BLENDSHAPE_NAME_BY_FEATURE);

const range = ([a, b]: readonly [number, number]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const mean = (rows: FeatureVector[]): FeatureVector => Object.fromEntries(FEATURES.map((f) => [f, rows.reduce((s, r) => s + (r[f] ?? 0), 0) / rows.length]));
const chunks = (idx: number[], n = HOLD_FRAMES) => Array.from({ length: Math.floor(idx.length / n) }, (_, i) => idx.slice(i * n, (i + 1) * n));

/** The recording carved into holds, and the model trained on them (the categorizer's reject mode). */
function carve(holdFrames = HOLD_FRAMES) {
  const frames = recordedFrames();
  const vec = frames.map(vectorOf);
  const rest = range(SEGMENTS.rest).map((i) => vec[i]);
  const weights = Object.fromEntries(
    FEATURES.map((f) => {
      const d = rest.slice(1).map((v, i) => (v[f] ?? 0) - (rest[i][f] ?? 0));
      const sd = Math.sqrt(d.reduce((a, x) => a + x * x, 0) / Math.max(1, d.length));
      return [f, 1 / Math.max(sd, MIN_JITTER)];
    }),
  );
  const groups = { smile: chunks(range(SEGMENTS.smile), holdFrames), open: chunks(range(SEGMENTS.open), holdFrames) };
  const holds = [...groups.smile, ...groups.open];
  const vectors = holds.map((g) => mean(g.map((i) => vec[i])));
  const supports = holds.map((g) => g.map((i) => vec[i]));
  const clusters = [groups.smile.map((_, k) => k), groups.open.map((_, k) => groups.smile.length + k)];
  const model = trainModel(vectors, clusters, FEATURES, weights, { restVectors: rest });
  return { vec, model, vectors, supports, groups };
}

/** One carve's chips and the live readout of its own frames, per category. */
function analyse(holdFrames: number) {
  const { vec, model, vectors, supports, groups } = carve(holdFrames);
  const before = carveQuality(model, vectors);
  const after = carveQuality(model, vectors, { supports });
  const dist = (a: FeatureVector, b: FeatureVector) =>
    Math.sqrt(FEATURES.reduce((s, f) => s + (model.weights[f] * ((a[f] ?? 0) - (b[f] ?? 0))) ** 2, 0) / FEATURES.length);
  const avg = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  const live = model.categories.map((c, k) => {
    const frames = (k === 0 ? groups.smile : groups.open).flat();
    const reads = frames.map((i) => classify(model, vec[i]).categoryId);
    const other = model.categories[1 - k];
    return {
      id: c.id,
      // Share of its frames read as itself, as the other category, as none of these.
      own: reads.filter((r) => r === c.id).length / frames.length,
      other: reads.filter((r) => r === other.id).length / frames.length,
      none: reads.filter((r) => r === null).length / frames.length,
      flips: reads.filter((r, i) => i > 0 && r !== reads[i - 1]).length,
      edge: frames.filter((i) => liveMargin(model, vec[i]).state !== 'inside').length / frames.length,
      // Frame-level separation: how far its frames are from the other centre, over from their own.
      frameRatio: avg(frames.map((i) => dist(vec[i], other.centroid))) / avg(frames.map((i) => dist(vec[i], c.centroid))),
    };
  });
  return { before, after, live };
}

describe('carve quality vs the live readout, on video_face_expressions (#553)', () => {
  const r = analyse(HOLD_FRAMES);

  it('the chips with supporting frames sit nearer the frames\' own separation, in every category', () => {
    r.after.categories.forEach((c, k) => {
      const b = r.before.categories[k];
      expect(c.spread).toBeGreaterThanOrEqual(b.spread);
      expect(Math.abs(c.ratio - r.live[k].frameRatio)).toBeLessThan(Math.abs(b.ratio - r.live[k].frameRatio));
    });
  });

  it('ranks the categories as the live readout does: the open smile is the less separated, and reads as itself less', () => {
    const [smile, open] = r.after.categories;
    expect(open.ratio).toBeLessThan(smile.ratio);
    expect(r.live[1].own).toBeLessThan(r.live[0].own);
  });

  it('reports the share of a category\'s frames past the reject radius, which the chip alone missed (#564)', () => {
    // The open smile is read as "none of these" in a third to a half of its frames at every
    // hold length while its chip is OK; the smile hardly ever is. The share names the first.
    for (const n of [4, 6, 8, 10]) {
      const x = analyse(n);
      const [smile, open] = x.after.categories;
      expect(smile.outside, `smile ${n}f`).not.toBeNull();
      expect(smile.sloppy, `smile ${n}f ${smile.outside}`).toBe(false);
      expect(open.sloppy, `open ${n}f ${open.outside}`).toBe(true);
      expect(open.grade).not.toBe('close');
      // It tracks the live readout's own "none of these" share (the radius is the same one).
      expect(Math.abs((open.outside ?? 0) - x.live[1].none)).toBeLessThan(0.15);
    }
    // Without supporting frames there is nothing to count.
    expect(r.before.categories.every((c) => c.outside === null && !c.sloppy)).toBe(true);
  });

  it('prints the numbers recorded in docs/research/carve-quality-vs-live.md', () => {
    const chip = (q: typeof r.before) => q.categories.map((c) => `${c.id} ${c.grade} ${c.ratio.toFixed(2)}`).join(' | ');
    for (const n of [4, 6, 8, 10]) {
      const x = analyse(n);
      console.log(`hold=${n}f  before: ${chip(x.before)}  after: ${chip(x.after)}`);
      console.log(`   live: ${x.live.map((l) => `${l.id} own ${(l.own * 100).toFixed(0)}% other ${(l.other * 100).toFixed(0)}% none ${(l.none * 100).toFixed(0)}% flips ${l.flips} edge ${(l.edge * 100).toFixed(0)}% frameRatio ${l.frameRatio.toFixed(2)}`).join(' | ')}`);
    }
  });
});
