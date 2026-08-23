/**
 * The trainer / enrollment core (#160).
 *
 * Unit cases over synthetic vectors (where the right answer is known by construction),
 * plus an end-to-end pass over the REAL recording in `test/fixtures/video_head_pose/` —
 * which matters more than it sounds, because that clip is the only evidence we have that
 * the pipeline survives real data: real transitions, real noise, and a real camera-
 * distance confound the synthetic cases cannot fake.
 */
import { describe, it, expect } from 'vitest';
import {
  buildHierarchy,
  classify,
  createCategoryTracker,
  createNoiseEstimator,
  createSession,
  createStillPointSampler,
  cutAt,
  noiseDistance,
  nuisanceProfile,
  rankFeatures,
  scaleWeights,
  selectByInvariance,
  suggestK,
  trainModel,
  weightsFromNuisance,
  type Cue,
  type FeatureVector,
} from '@/enroll';
import { starterCueById } from '@/app/enroll/starterCues';
import { matrixToHeadPose } from '@/nodes/domain';
import { loadStream } from './helpers/fixtures';

/** A toy registry for sessions: every key is its own group named after itself. */
const toyRegistry = (ids: string[]) => ({ allFeatureIds: ids, groupOf: (id: string) => ids.includes(id) ? 'toy' : undefined });
const toyCue = (id: string, produces: Cue['produces'], extra: Partial<Cue> = {}): Cue =>
  ({
    id,
    name: id,
    instruction: `do ${id}.`,
    rationale: '',
    collects: { groups: ['toy'], omit: [], axes: produces === 'nuisance' ? ['scale'] : [] },
    produces,
    sufficiency:
      produces === 'vocabulary'
        ? { kind: 'variety', minPoints: 2, minSeparation: 3, holdNudgeMs: 8000, patienceMs: 60000 }
        : { kind: 'frames', minFrames: 10, patienceMs: 20000 },
    variations: [],
    tags: [],
    ...extra,
  }) as Cue;

/** A vector built from a few named channels. */
const v = (o: Record<string, number>): FeatureVector => o;

describe('still-point sampler (absolute metric, the v1 rule) — the "cluster poses, not transitions" guard', () => {
  const abs = { metric: 'absolute' as const };
  it('emits nothing while the vector is moving', () => {
    const s = createStillPointSampler({ ...abs, dwellMs: 200, speedThreshold: 0.3 });
    let emitted = 0;
    for (let i = 0; i < 60; i++) {
      // 0.02/frame at 60fps = 1.2/s, well over the threshold.
      if (s.push(v({ a: i * 0.02 }), i * 16.7)) emitted += 1;
    }
    expect(emitted).toBe(0);
  });

  it('emits ONE point for a held pose, not one per frame', () => {
    const s = createStillPointSampler({ ...abs, dwellMs: 200 });
    let emitted = 0;
    for (let i = 0; i < 120; i++) if (s.push(v({ a: 0.5 }), i * 16.7)) emitted += 1;
    expect(emitted).toBe(1);
  });

  it('emits again only after the player MOVES to a new pose', () => {
    const s = createStillPointSampler({ ...abs, dwellMs: 200 });
    const feed = (val: number, frames: number, t0: number) => {
      for (let i = 0; i < frames; i++) s.push(v({ a: val }), t0 + i * 16.7);
      return t0 + frames * 16.7;
    };
    let t = 0;
    t = feed(0.1, 40, t); // hold A
    // a fast transition
    for (let i = 0; i < 10; i++) s.push(v({ a: 0.1 + (i + 1) * 0.06 }), (t += 16.7));
    feed(0.7, 40, t); // hold B
    const pts = s.points();
    expect(pts).toHaveLength(2);
    expect(pts[0].vector.a).toBeCloseTo(0.1, 2);
    expect(pts[1].vector.a).toBeCloseTo(0.7, 2);
  });

  it('a SLOW DRIFT during one hold still emits only one point (the latch, isolated)', () => {
    // Guard-the-guard: the `armed` latch and the `minSeparation` check both block
    // duplicates, so a constant-value hold stays correct even if the latch is removed.
    // This case separates them — a pose that creeps below the speed threshold travels
    // far past `minSeparation`, so ONLY the latch can stop it emitting a point every
    // dwell window and handing the clusterer a dwell-time histogram.
    const s = createStillPointSampler({ ...abs, dwellMs: 200, speedWindowMs: 100, speedThreshold: 0.35 });
    let a = 0.1;
    for (let i = 0; i < 120; i++) {
      a += 0.005; // 0.3/s — under the threshold, but 0.6 total: 12x minSeparation
      s.push(v({ a }), i * 16.7);
    }
    expect(s.points()).toHaveLength(1);
  });

  it('averages the dwell window rather than taking the last frame', () => {
    const s = createStillPointSampler({ ...abs, dwellMs: 100 });
    // Tiny alternating jitter around 0.5 — slow enough to count as held.
    for (let i = 0; i < 40; i++) s.push(v({ a: i % 2 ? 0.51 : 0.49 }), i * 16.7);
    expect(s.points()[0].vector.a).toBeCloseTo(0.5, 2);
  });

  it('a NaN feature ("not measurable") does not wedge the sampler', () => {
    const s = createStillPointSampler({ ...abs, dwellMs: 100 });
    for (let i = 0; i < 40; i++) s.push(v({ a: 0.4, bad: NaN }), i * 16.7);
    expect(s.points()).toHaveLength(1);
  });
});

describe('noise units — the estimator every distance is measured in (#163)', () => {
  /** Deterministic "noise": a fixed pseudo-random sequence in [-1, 1). */
  const prng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 2147483648 - 1;
  };

  it('sigma converges to the per-frame jitter, per feature, in that feature\'s own units', () => {
    const n = createNoiseEstimator();
    const r = prng(1);
    // `deg` jitters +-0.3 (degrees), `bs` jitters +-0.01 (a blendshape): 30x apart.
    for (let i = 0; i < 300; i++) n.push(v({ deg: 10 + 0.3 * r(), bs: 0.2 + 0.01 * r() }), i * 33);
    const ratio = n.sigma('deg') / n.sigma('bs');
    expect(ratio).toBeGreaterThan(15);
    expect(ratio).toBeLessThan(60);
  });

  it('a deliberate move barely inflates the estimate (the clip), so the next hold still reads as held', () => {
    const n = createNoiseEstimator();
    const r = prng(7);
    let t = 0;
    for (let i = 0; i < 200; i++) n.push(v({ a: 0.5 + 0.01 * r() }), (t += 33));
    const before = n.sigma('a');
    // A 1 s move of 20x the jitter per frame.
    for (let i = 0; i < 30; i++) n.push(v({ a: 0.5 + 0.2 * i + 0.01 * r() }), (t += 33));
    const after = n.sigma('a');
    // The raw estimate inflates by a few tens of percent, not several times; the UNIT
    // (the floored sigma) may also rise with the range, but stays within a factor of
    // the jitter rather than tracking the move itself.
    expect(n.snapshot().sigma.a).toBeLessThan(before * 2);
    expect(after).toBeLessThan(before * 8);
  });

  it('a feature that has never varied has no unit (weight 0); one that varied once gets the range floor', () => {
    const n = createNoiseEstimator({ rangeFloor: 0.01 });
    for (let i = 0; i < 50; i++) n.push(v({ flat: 0, step: i < 25 ? 0 : 1 }), i * 33);
    const w = scaleWeights(n.snapshot(), { rangeFloor: 0.02 });
    expect(w.flat).toBe(0);
    // `step` jumped once (sigma ~ 0 apart from that frame) so the floor rules: 2% of range 1.
    expect(w.step).toBeGreaterThan(0);
    expect(w.step).toBeLessThanOrEqual(50 + 1e-9);
    expect(Number.isNaN(n.sigma('never'))).toBe(true);
  });

  it('noiseDistance is RMS over the attention features in sigma, skipping what is unseen', () => {
    const sigma = (id: string) => ({ a: 0.1, b: 1 })[id] ?? NaN;
    // a moved 0.3 (3 sigma), b moved 3 (3 sigma): RMS 3. c is unknown and ignored.
    expect(noiseDistance(v({ a: 0.3, b: 3, c: 9 }), v({ a: 0, b: 0, c: 0 }), sigma, ['a', 'b', 'c'])).toBeCloseTo(3, 6);
    expect(noiseDistance(v({ a: 0.3 }), v({ a: 0 }), sigma, ['zzz'])).toBe(0);
  });
});

describe('still-point sampler (noise-relative, the default) — "held" means "no feature moved more than a few sigma"', () => {
  const prng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 2147483648 - 1;
  };

  it('a head turn in DEGREES and a smile in 0..1 are both seen as motion, and both holds as held', () => {
    const s = createStillPointSampler({ dwellMs: 200 });
    const r = prng(3);
    let t = 0;
    const frame = (yaw: number, smile: number) => v({ yaw: yaw + 0.3 * r(), smile: smile + 0.01 * r() });
    // settle: hold (0, 0)
    for (let i = 0; i < 60; i++) s.push(frame(0, 0), (t += 33));
    // turn the head 25 degrees over 0.5 s, then hold
    for (let i = 1; i <= 15; i++) s.push(frame((25 * i) / 15, 0), (t += 33));
    for (let i = 0; i < 30; i++) s.push(frame(25, 0), (t += 33));
    // now smile (0 -> 0.8 over 0.5 s) with the head still turned, then hold
    for (let i = 1; i <= 15; i++) s.push(frame(25, (0.8 * i) / 15), (t += 33));
    for (let i = 0; i < 30; i++) s.push(frame(25, 0.8), (t += 33));
    const pts = s.points();
    expect(pts).toHaveLength(3);
    expect(pts[1].vector.yaw).toBeGreaterThan(20);
    expect(pts[2].vector.smile).toBeGreaterThan(0.7);
  });

  it('the latch: a slow creep within the noise emits one point, not one per dwell window', () => {
    const s = createStillPointSampler({ dwellMs: 200 });
    const r = prng(5);
    let a = 0.3;
    for (let i = 0; i < 240; i++) {
      a += 0.0005; // 0.12 total, but never more than a sigma or so per window
      s.push(v({ a: a + 0.01 * r() }), i * 33);
    }
    expect(s.points()).toHaveLength(1);
  });

  it('attends only to `features`: a moving mouth does not stop a head cue from reading as held', () => {
    const r = prng(11);
    let t = 0;
    // One shared estimator, warmed on a resting face first — as a session's is by the
    // rest cue. (Cold, a smooth sweep from frame 0 would be learnt as the "noise".)
    const noise = createNoiseEstimator();
    for (let i = 0; i < 60; i++) noise.push(v({ yaw: 5 + 0.3 * r(), mouth: 0.5 + 0.01 * r() }), (t += 33));
    const head = createStillPointSampler({ dwellMs: 200, features: ['yaw'], noise });
    const all = createStillPointSampler({ dwellMs: 200, noise });
    for (let i = 0; i < 90; i++) {
      // yaw held; mouth sweeping continuously (a real move, 10x its own jitter per frame)
      const f = v({ yaw: 5 + 0.3 * r(), mouth: 0.5 + 0.4 * Math.sin(i / 3) + 0.01 * r() });
      noise.push(f, (t += 33));
      head.push(f, t);
      all.push(f, t);
    }
    expect(head.points().length).toBeGreaterThanOrEqual(1);
    expect(all.points()).toHaveLength(0);
  });

  it('a SHARED estimator is not fed twice (the session feeds it; the sampler only reads)', () => {
    const noise = createNoiseEstimator();
    const s = createStillPointSampler({ dwellMs: 100, noise });
    for (let i = 0; i < 20; i++) s.push(v({ a: i * 0.1 }), i * 33);
    expect(noise.snapshot().frames).toBe(0);
  });
});

describe('hierarchy — k before OR after, from one recording', () => {
  /** Three well-separated blobs of three points each. */
  const blobs: FeatureVector[] = [
    v({ x: 0.0, y: 0.0 }), v({ x: 0.02, y: 0.01 }), v({ x: 0.01, y: 0.02 }),
    v({ x: 1.0, y: 0.0 }), v({ x: 1.02, y: 0.01 }), v({ x: 0.99, y: 0.02 }),
    v({ x: 0.5, y: 1.0 }), v({ x: 0.52, y: 1.01 }), v({ x: 0.49, y: 0.99 }),
  ];
  const feats = ['x', 'y'];
  const h = buildHierarchy(blobs, feats);

  it('recovers the three blobs when cut at 3', () => {
    const cut = cutAt(h, 3);
    expect(cut).toHaveLength(3);
    expect(cut.map((c) => c.length).sort()).toEqual([3, 3, 3]);
  });

  it('the SAME hierarchy answers 2, 3 and 4 with no rebuild — this is the feature', () => {
    expect(cutAt(h, 2)).toHaveLength(2);
    expect(cutAt(h, 3)).toHaveLength(3);
    expect(cutAt(h, 4)).toHaveLength(4);
    // and every cut is a partition of all 9 points
    for (const k of [2, 3, 4, 5]) {
      expect(cutAt(h, k).flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    }
  });

  it('clamps a k past either end instead of throwing (a slider must not crash)', () => {
    expect(cutAt(h, 0)).toHaveLength(1);
    expect(cutAt(h, -5)).toHaveLength(1);
    expect(cutAt(h, 999)).toHaveLength(9);
  });

  it('suggests 3 for three obvious blobs', () => {
    expect(suggestK(h)).toBe(3);
  });

  it('is deterministic and order-independent', () => {
    const shuffled = [8, 3, 0, 6, 1, 7, 4, 2, 5].map((i) => blobs[i]);
    const h2 = buildHierarchy(shuffled, feats);
    // Same partition (as sets of coordinates), regardless of input order.
    const asSets = (cut: number[][], src: FeatureVector[]) =>
      cut.map((c) => c.map((i) => `${src[i].x},${src[i].y}`).sort().join('|')).sort();
    expect(asSets(cutAt(h2, 3), shuffled)).toEqual(asSets(cutAt(h, 3), blobs));
  });

  it('handles degenerate sizes', () => {
    expect(cutAt(buildHierarchy([], feats), 3)).toEqual([]);
    expect(cutAt(buildHierarchy([v({ x: 1, y: 1 })], feats), 3)).toEqual([[0]]);
  });
});

describe('invariance — declared (#131) and demonstrated', () => {
  it('splits declared invariance three ways, keeping "unassessed" separate', () => {
    const sel = selectByInvariance(['scale']);
    // The catalog has real declarations; the point is that all three buckets are used
    // and nothing is silently guessed.
    expect(sel.keep.length + sel.drop.length + sel.unassessed.length).toBeGreaterThan(50);
    expect(sel.unassessed.length).toBeGreaterThan(0);
    for (const id of sel.keep) expect(sel.unassessed).not.toContain(id);
  });

  it('asking for NO axes excludes nothing', () => {
    const sel = selectByInvariance([]);
    expect(sel.drop).toEqual([]);
    expect(sel.unassessed).toEqual([]);
  });

  it('down-weights whatever moved during the nuisance demo', () => {
    // `steady` holds still while `drifty` sweeps — exactly the shape of a confound.
    const clip = Array.from({ length: 40 }, (_, i) => v({ steady: 0.5, drifty: i / 40 }));
    const w = weightsFromNuisance(nuisanceProfile(clip, ['scale']));
    expect(w.steady).toBeCloseTo(1, 2);
    expect(w.drifty).toBeLessThan(0.5);
    expect(w.drifty).toBeGreaterThan(0); // quieted, never deleted
  });

  it('ignores a profile built from too few samples', () => {
    const w = weightsFromNuisance(nuisanceProfile([v({ a: 0 }), v({ a: 1 })]));
    expect(w.a).toBe(1);
  });

  it('ranks by signal AFTER nuisance weighting', () => {
    const vocab = [v({ good: 0, noise: 0.5 }), v({ good: 1, noise: 0.5 })];
    const ranked = rankFeatures(vocab, { good: 1, noise: 1 }, 5);
    expect(ranked[0]).toBe('good');
  });
});

describe('classification — soft membership, reject, hysteresis', () => {
  const pts = [v({ x: 0 }), v({ x: 0.02 }), v({ x: 1 }), v({ x: 1.02 })];
  const model = trainModel(pts, [[0, 1], [2, 3]], ['x'], { x: 1 }, {
    restVectors: Array.from({ length: 10 }, () => v({ x: 0.5 })),
  });

  it('memberships sum to 1 and favour the nearer centroid', () => {
    const c = classify(model, v({ x: 0.01 }));
    const total = Object.values(c.memberships).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(c.memberships['cat-1']).toBeGreaterThan(c.memberships['cat-2']);
    expect(c.categoryId).toBe('cat-1');
  });

  it('never produces NaN memberships for a far-away vector', () => {
    // Softmax without the max-subtraction underflows to 0/0 here and silences the synth.
    const c = classify(model, v({ x: 1e6 }));
    for (const m of Object.values(c.memberships)) expect(Number.isFinite(m)).toBe(true);
    expect(Object.values(c.memberships).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('rejects a vector beyond the reject radius', () => {
    expect(classify(model, v({ x: 50 })).rejected).toBe(true);
    expect(classify(model, v({ x: 50 })).categoryId).toBeNull();
  });

  it('a perfectly still rest take cannot produce a model that rejects its own categories', () => {
    const m = trainModel(pts, [[0, 1], [2, 3]], ['x'], { x: 1 }, {
      restVectors: Array.from({ length: 10 }, () => v({ x: 0.5 })), // zero spread
    });
    expect(m.rejectRadius).toBeGreaterThan(0);
    expect(classify(m, v({ x: 0 })).rejected).toBe(false);
    expect(classify(m, v({ x: 1 })).rejected).toBe(false);
  });

  it('an empty model rejects rather than throwing', () => {
    const empty = trainModel([], [], ['x'], {});
    expect(classify(empty, v({ x: 0 })).rejected).toBe(true);
  });

  it('tracker requires enterFrames before switching category', () => {
    const t = createCategoryTracker(model, { enterFrames: 3 });
    expect(t.push(v({ x: 0 })).categoryId).toBeNull(); // 1st frame of cat-1
    expect(t.push(v({ x: 0 })).categoryId).toBeNull();
    expect(t.push(v({ x: 0 })).categoryId).toBe('cat-1'); // committed on the 3rd
    // one stray frame near cat-2 must NOT flip it
    expect(t.push(v({ x: 1 })).categoryId).toBe('cat-1');
    expect(t.current()).toBe('cat-1');
  });

  it('HOLDS the last category through no-man\'s-land rather than falling silent', () => {
    const t = createCategoryTracker(model, { enterFrames: 1, exitFrames: 5 });
    t.push(v({ x: 0 }));
    expect(t.current()).toBe('cat-1');
    // brief excursion into nothing
    for (let i = 0; i < 4; i++) {
      const r = t.push(v({ x: 50 }));
      expect(r.categoryId).toBe('cat-1');
      expect(r.held).toBe(true);
    }
  });

  it('holdOnReject:false does drop to null once exitFrames elapse', () => {
    const t = createCategoryTracker(model, { enterFrames: 1, exitFrames: 3, holdOnReject: false });
    t.push(v({ x: 0 }));
    for (let i = 0; i < 3; i++) t.push(v({ x: 50 }));
    expect(t.current()).toBeNull();
  });
});

describe('end-to-end over the REAL recording', () => {
  interface PoseRecord {
    present: boolean;
    blendshapes: Record<string, number>;
    transformMatrix: number[];
  }
  const frames = loadStream('video_head_pose', 'face.pose') as PoseRecord[];
  const FPS = 29.3;

  /** A small hand-picked feature vector per frame — blendshapes plus decoded pose. */
  const vecAt = (i: number): FeatureVector => {
    const f = frames[i];
    const p = matrixToHeadPose(f.transformMatrix);
    const b = f.blendshapes;
    return {
      smile: ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2,
      jaw: b.jawOpen ?? 0,
      brow: ((b.browOuterUpLeft ?? 0) + (b.browOuterUpRight ?? 0) + (b.browInnerUp ?? 0)) / 3,
      browDown: ((b.browDownLeft ?? 0) + (b.browDownRight ?? 0)) / 2,
      squint: ((b.eyeSquintLeft ?? 0) + (b.eyeSquintRight ?? 0)) / 2,
      yaw: p.yaw / 90,
      pitch: p.pitch / 90,
    };
  };
  const range = (from: number, to: number) => {
    const out: { v: FeatureVector; t: number }[] = [];
    for (let i = Math.round(from * FPS); i <= Math.round(to * FPS) && i < frames.length; i++) {
      out.push({ v: vecAt(i), t: (i / FPS) * 1000 });
    }
    return out;
  };

  it('the sampler (absolute metric) finds several distinct held poses in a real take', () => {
    const s = createStillPointSampler({ metric: 'absolute', dwellMs: 200, speedThreshold: 0.35 });
    for (const { v: vec, t } of range(0, 13.6)) s.push(vec, t);
    const pts = s.points();
    // Far fewer than the 400 frames, and more than one — i.e. it actually segmented.
    expect(pts.length).toBeGreaterThan(2);
    expect(pts.length).toBeLessThan(60);
  });

  it('the sampler (noise-relative, the default) finds several distinct held poses too', () => {
    const s = createStillPointSampler({ dwellMs: 200 });
    for (const { v: vec, t } of range(0, 13.6)) s.push(vec, t);
    const pts = s.points();
    expect(pts.length).toBeGreaterThan(2);
    expect(pts.length).toBeLessThan(60);
  });

  it('the dolly segment is correctly identified as nuisance, and quiets `brow`', () => {
    // 10.9-13.7s: the phone moves in and back out while the smile is HELD. The brow
    // channel swings 0.43->0.89 on that move alone (see the fixture README), which is
    // exactly the confound the maintainer asked about. The profile must catch it.
    const profile = nuisanceProfile(range(10.9, 13.6).map((r) => r.v), ['scale']);
    const w = weightsFromNuisance(profile);
    expect(profile.samples).toBeGreaterThan(40);
    expect(w.brow).toBeLessThan(0.85);
    // `jaw` genuinely does not move during the dolly, so it must NOT be penalised.
    expect(w.jaw).toBeGreaterThan(0.95);
    expect(w.brow).toBeLessThan(w.jaw);
  });

  /** The default face routine's cues, but attending to the toy keys above. */
  const reg = toyRegistry(['smile', 'jaw', 'brow', 'browDown', 'squint', 'yaw', 'pitch']);
  const rest = toyCue('rest', 'baseline');
  const dolly = toyCue('dolly', 'nuisance');
  const faces = toyCue('faces', 'vocabulary');
  const feed = (session: ReturnType<typeof createSession>, cue: Cue, from: number, to: number) => {
    session.beginCue(cue);
    for (const { v: vec, t } of range(from, to)) session.push(vec, t);
    session.endCue();
  };

  it('a full session trains, and re-cutting to a different k needs no rebuild', () => {
    const session = createSession({ ...reg, sampler: { dwellMs: 200 } });
    feed(session, rest, 7.7, 8.5); // a held, settled face
    feed(session, dolly, 10.9, 13.6);
    feed(session, faces, 0, 10.5);

    session.build();
    const k3 = session.retrain(3);
    expect(k3.categories).toHaveLength(3);
    expect(k3.features.length).toBeGreaterThan(0);
    expect(k3.rejectRadius).toBeGreaterThan(0);

    // The same built hierarchy answers a different k immediately — no rebuild.
    const k5 = session.retrain(5);
    expect(k5.categories).toHaveLength(5);
    const k2 = session.retrain(2);
    expect(k2.categories).toHaveLength(2);

    // Every category came from real points, and says which cue fed it.
    for (const c of k3.categories) {
      expect(c.size).toBeGreaterThan(0);
      expect(c.cues?.faces).toBe(c.size);
    }
  });

  it('a trained model recognises the take it was trained on', () => {
    const session = createSession({ ...reg, sampler: { dwellMs: 200 } });
    feed(session, rest, 7.7, 8.5);
    feed(session, faces, 0, 10.5);
    session.build();
    const model = session.retrain(3);

    // Each captured still-point should land in SOME category, not no-man's-land — a model
    // that rejects its own training data is the failure this asserts against.
    const pts = session.pointsFor('faces');
    const accepted = pts.filter((p) => !classify(model, p.vector).rejected).length;
    expect(accepted / pts.length).toBeGreaterThan(0.8);
  });

  it('the model is measured in NOISE units: its weights are 1/sigma, so a 1-degree yaw jitter cannot outweigh a smile', () => {
    const session = createSession({ ...reg, sampler: { dwellMs: 200 } });
    feed(session, rest, 7.7, 8.5);
    feed(session, faces, 0, 10.5);
    session.build();
    const w = session.weights();
    const scale = scaleWeights(session.noise().snapshot());
    // The weights carry the scale (times the nuisance factor, 1 here — no nuisance cue).
    for (const id of session.features()) expect(w[id]).toBeCloseTo(scale[id], 6);
    // And a distance between two vocabulary points is O(sigma), not O(raw units).
    const pts = session.pointsFor('faces');
    const d = noiseDistance(pts[0].vector, pts[1].vector, session.sigma, session.features());
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(1e4);
  });

  it('the dolly cue, in noise units, still quiets `brow` and leaves `jaw` alone', () => {
    const session = createSession({ ...reg, sampler: { dwellMs: 200 } });
    feed(session, rest, 7.7, 8.5);
    feed(session, dolly, 10.9, 13.6);
    feed(session, faces, 0, 10.5);
    session.build();
    const w = session.weights();
    const scale = scaleWeights(session.noise().snapshot());
    // Divide the scale out to read the nuisance factor alone.
    const brow = w.brow / scale.brow;
    const jaw = w.jaw / scale.jaw;
    expect(brow).toBeLessThan(jaw);
    expect(brow).toBeLessThan(0.6);
  });

  it('reports readiness only once there is a vocabulary to carve', () => {
    const session = createSession({ ...reg, sampler: { dwellMs: 200 } });
    expect(session.ready()).toBe(false);
    feed(session, rest, 7.7, 8.5);
    expect(session.ready()).toBe(false); // rest alone is not enough
    expect(session.framesFor('rest')).toBeGreaterThan(10);
    expect(session.baseline()).toBeDefined();
    feed(session, faces, 0, 10.5);
    expect(session.ready()).toBe(true);
  });

  it('the shipped starter cues resolve against the REAL catalog (face.head -> yaw/pitch/roll, raw position omitted)', () => {
    const session = createSession();
    const lookLeft = starterCueById('look-left')!;
    const feats = session.featuresFor(lookLeft);
    expect(feats).toContain('face.head.yaw');
    expect(feats).toContain('face.head.pitch');
    expect(feats).not.toContain('face.head.x');
    expect(feats).not.toContain('face.head.scale');
  });
});
