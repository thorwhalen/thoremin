/**
 * The projection (#163 §7-§8): UMAP over the take in the model's own metric, a live
 * cursor in the same embedding, thinning, and rectangle selection — headless, over
 * synthetic blobs (where the right picture is known) and the real head-pose clip.
 */
import { describe, it, expect } from 'vitest';
import { createSession, weightedDistance, type Cue, type FeatureVector, type StillPoint } from '@/enroll';
import {
  fitProjection,
  MIN_POINTS_FOR_PROJECTION,
  safeEpochs,
  seededRandom,
  selectInRect,
  thinLayout,
  toMetricRow,
  type Point2,
} from '@/enroll/projection';
import { matrixToHeadPose } from '@/nodes/domain';
import { loadStream } from './helpers/fixtures';

const v = (o: Record<string, number>): FeatureVector => o;
const pt = (vector: FeatureVector, cue: string, t = 0): StillPoint => ({ vector, t, cue });
const dist = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mean = (ps: Point2[]): Point2 => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];

describe('fitProjection', () => {
  const r = seededRandom(3);
  /** Three well-separated blobs of 8 points in a 3-feature space, in NOISE units.
   *  Blob 2 is blob 0 shifted along `c` only, so dropping `c` makes them one. */
  const blobs: StillPoint[] = [];
  for (let b = 0; b < 3; b++) {
    for (let i = 0; i < 8; i++) {
      blobs.push(pt(v({ a: (b === 1 ? 0 : 20) + r(), b: (b === 1 ? 20 : 0) + r(), c: (b === 2 ? 20 : 0) + r() }), `blob-${b}`));
    }
  }
  const features = ['a', 'b', 'c'];
  const weights = { a: 1, b: 1, c: 1 };

  it('lays three blobs out as three separate groups, and is deterministic', () => {
    const p1 = fitProjection(blobs, features, weights);
    const p2 = fitProjection(blobs, features, weights);
    expect(p1.layout).toHaveLength(24);
    expect(p1.layout).toEqual(p2.layout);
    const groups = [0, 1, 2].map((b) => p1.layout.filter((_, i) => blobs[i].cue === `blob-${b}`));
    const centres = groups.map(mean);
    const within = Math.max(...groups.flatMap((g, b) => g.map((q) => dist(q, centres[b]))));
    const between = Math.min(dist(centres[0], centres[1]), dist(centres[1], centres[2]), dist(centres[0], centres[2]));
    expect(between).toBeGreaterThan(within * 2);
    expect(p1.bounds.maxX).toBeGreaterThan(p1.bounds.minX);
  });

  it('transform() is STABLE: the same vector maps to the same point on every call (a held pose does not jitter)', () => {
    const p = fitProjection(blobs, features, weights);
    const q = v({ a: 0.4, b: 20.3, c: 0.5 });
    const first = p.transform(q);
    for (let i = 0; i < 20; i++) {
      const again = p.transform(q);
      expect(again[0]).toBeCloseTo(first[0], 9);
      expect(again[1]).toBeCloseTo(first[1], 9);
    }
  });

  it('transform() puts a live vector near its own blob — the cursor lives in the SAME embedding', () => {
    const p = fitProjection(blobs, features, weights);
    const groups = [0, 1, 2].map((b) => mean(p.layout.filter((_, i) => blobs[i].cue === `blob-${b}`)));
    const live = p.transform(v({ a: 0.4, b: 20.3, c: 0.5 })); // blob 1
    const d = groups.map((c) => dist(live, c));
    expect(d[1]).toBeLessThan(d[0]);
    expect(d[1]).toBeLessThan(d[2]);
  });

  it('uses the MODEL metric: a weight of 0 removes a feature from the picture', () => {
    // Blob 2 is blob 0 shifted along c; with c weighted out, the two are one cloud.
    const p = fitProjection(blobs, features, { a: 1, b: 1, c: 0 });
    const groups = [0, 1, 2].map((b) => mean(p.layout.filter((_, i) => blobs[i].cue === `blob-${b}`)));
    expect(dist(groups[0], groups[2])).toBeLessThan(dist(groups[0], groups[1]) / 2);
    expect(toMetricRow(v({ a: 2, c: 5 }), ['a', 'b', 'c'], { a: 0.5, b: 1, c: 0 })).toEqual([1, 0, 0]);
  });

  it('never hands umap-js an epoch count that would hang transform() (a multiple of 3 always)', () => {
    expect(safeEpochs(200)).toBe(201);
    expect(safeEpochs(300)).toBe(300);
    expect(safeEpochs(1)).toBe(3);
    expect(safeEpochs(3.5)).toBe(6);
    // And a caller's odd value still yields a working cursor (this hung before).
    const p = fitProjection(blobs, features, weights, { nEpochs: 200 });
    expect(p.transform(v({ a: 0, b: 20, c: 0 }))).toHaveLength(2);
  });

  it('refuses a take too small to lay out, and says how many held poses it wants', () => {
    expect(() => fitProjection(blobs.slice(0, MIN_POINTS_FOR_PROJECTION - 1), features, weights)).toThrow(/held poses/);
    expect(() => fitProjection(blobs, [], weights)).toThrow(/build\(\)/);
  });
});

describe('thinning and selection', () => {
  it('below the cap every point is its own representative; above it, bins merge and counts add up', () => {
    const r = seededRandom(5);
    const layout: Point2[] = Array.from({ length: 300 }, () => [r() * 10, r() * 10]);
    const reps = thinLayout(layout, { cap: 200, cells: 8 });
    expect(reps.length).toBeLessThan(300);
    expect(reps.reduce((s, x) => s + x.members.length, 0)).toBe(300);
    expect(thinLayout(layout.slice(0, 50), { cap: 200 })).toHaveLength(50);
  });

  it('selectInRect returns the indices inside the drag, whichever way it was dragged', () => {
    const layout: Point2[] = [[0, 0], [5, 5], [10, 10], [5, 6]];
    expect(selectInRect(layout, { x0: 4, y0: 4, x1: 7, y1: 7 })).toEqual([1, 3]);
    expect(selectInRect(layout, { x0: 7, y0: 7, x1: 4, y1: 4 })).toEqual([1, 3]);
    expect(selectInRect(layout, { x0: 20, y0: 20, x1: 30, y1: 30 })).toEqual([]);
  });
});

describe('over the REAL recording', () => {
  interface PoseRecord {
    present: boolean;
    blendshapes: Record<string, number>;
    transformMatrix: number[];
  }
  const frames = loadStream('video_head_pose', 'face.pose') as PoseRecord[];
  const FPS = 29.3;
  const vecAt = (i: number): FeatureVector => {
    const f = frames[i];
    const p = matrixToHeadPose(f.transformMatrix);
    const b = f.blendshapes;
    return { yaw: p.yaw, pitch: p.pitch, roll: p.roll, smile: ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2, jaw: b.jawOpen ?? 0, brow: b.browInnerUp ?? 0 };
  };
  const registry = { allFeatureIds: ['yaw', 'pitch', 'roll', 'smile', 'jaw', 'brow'], groupOf: (id: string) => (['yaw', 'pitch', 'roll'].includes(id) ? 'head' : 'expr') };
  const cue = (id: string, produces: Cue['produces']): Cue =>
    ({ id, name: id, instruction: 'x.', rationale: '', collects: { groups: ['head', 'expr'], omit: [], axes: [] }, produces, sufficiency: produces === 'vocabulary' ? { kind: 'variety', minPoints: 2, minSeparation: 3, holdNudgeMs: 8000, patienceMs: 60000 } : { kind: 'frames', minFrames: 10, patienceMs: 20000 }, variations: [], tags: [] }) as Cue;

  it('the take projects, a cut\'s clusters are separable in the picture, and the live cursor lands where its pose is', () => {
    const session = createSession({ ...registry, sampler: { dwellMs: 100, stillSigma: 8 } });
    const feed = (c: Cue, from: number, to: number) => {
      session.beginCue(c);
      for (let i = Math.round(from * FPS); i <= Math.round(to * FPS) && i < frames.length; i++) session.push(vecAt(i), (i / FPS) * 1000);
      session.endCue();
    };
    feed(cue('rest', 'baseline'), 7.7, 8.5);
    feed(cue('faces', 'vocabulary'), 0, 10.5);
    session.build();
    const pts = session.points();
    expect(pts.length).toBeGreaterThanOrEqual(MIN_POINTS_FOR_PROJECTION);
    const proj = fitProjection(pts, session.features(), session.weights());
    expect(proj.layout).toHaveLength(pts.length);
    // The cursor is honest — within what UMAP's transform can do on a take this small
    // (neighbourhood-accurate, not exact): a point's own vector lands in the picture
    // nearer to its layout position than to the layout's farthest point, and its
    // nearest layout neighbour is not among the feature-space FARTHEST points from it.
    const feats = session.features();
    const w = session.weights();
    for (const i of [0, Math.floor(pts.length / 2), pts.length - 1]) {
      const here = proj.transform(pts[i].vector);
      const own = dist(here, proj.layout[i]);
      const farthest = Math.max(...proj.layout.map((q) => dist(here, q)));
      expect(own).toBeLessThan(farthest);
      let nearest = -1;
      let best = Infinity;
      proj.layout.forEach((q, j) => {
        const d = dist(here, q);
        if (d < best) {
          best = d;
          nearest = j;
        }
      });
      const fd = pts.map((q) => weightedDistance(pts[i].vector, q.vector, feats, w)).sort((x, y) => x - y);
      const worstQuartile = fd[Math.floor(fd.length * 0.75)];
      expect(weightedDistance(pts[i].vector, pts[nearest].vector, feats, w)).toBeLessThan(worstQuartile);
    }
  });
});
