/**
 * The chord-shape classifier on self-made data: three synthetic "players", each with a
 * systematic offset on every joint, five shapes, per-frame jitter, world landmarks and
 * out-of-plane rotation (the path real footage takes). Leave-one-player-out is the
 * honest number; the model must transfer to a hand it never saw. Also the evaluation
 * arithmetic, the smoothing, the holdout guarantee (checked with a spy, not a number),
 * that class balancing actually changes a rare class's recall, and that a model
 * survives JSON (it ships as JSON to the browser).
 */
import { describe, expect, it } from 'vitest';
import { chordShapeFeatureIds, chordShapeVector } from '../../scripts/air/lib_chord_shape_features';
import {
  centroidTrainer,
  enrolmentSplit,
  evaluate,
  formatFolds,
  leaveOneGroupOut,
  predict,
  predictCentroid,
  predictProba,
  smoothPredictions,
  softmaxTrainer,
  trainCentroid,
  trainSoftmax,
  withinGroupSplit,
  type Sample,
  type SoftmaxModel,
  type Trainer,
} from '../../scripts/air/lib_chord_shape_model';
import { SHAPES, frameOf, noise, perturb, rng, syntheticHand } from './synthetic_hand';

const FEATURES = chordShapeFeatureIds();

interface DatasetOptions {
  offsetSd?: number;
  jitterSd?: number;
  seed?: number;
  /** Frames per shape per player; a map overrides per label (for imbalance). */
  perShape?: number | Record<string, number>;
  shapes?: Record<string, (typeof SHAPES)[string]>;
}

/** `perPlayer` systematic offsets + `jitter` per frame; random pose incl. yaw/pitch. */
function makeDataset(players: number, n: number, opts: DatasetOptions = {}): Sample[] {
  const r = rng(opts.seed ?? 42);
  const offsetSd = opts.offsetSd ?? 0.08;
  const jitterSd = opts.jitterSd ?? 0.06;
  const shapes = opts.shapes ?? SHAPES;
  const out: Sample[] = [];
  for (let p = 0; p < players; p++) {
    const offsets = new Map<string, number>();
    const offset = (k: string) => {
      if (!offsets.has(k)) offsets.set(k, noise(r, offsetSd));
      return offsets.get(k) as number;
    };
    let t = 0;
    for (const [label, shape] of Object.entries(shapes)) {
      const count = typeof opts.perShape === 'object' ? (opts.perShape[label] ?? n) : (opts.perShape ?? n);
      for (let i = 0; i < count; i++) {
        const s = perturb(shape, offset, () => noise(r, jitterSd));
        const hand = syntheticHand(s, {
          cx: 200 + r() * 200,
          cy: 200 + r() * 100,
          scale: 80 + r() * 60,
          rotation: (r() - 0.5) * 0.6,
          yaw: (r() - 0.5) * 0.8,
          pitch: (r() - 0.5) * 0.6,
          world: true,
        });
        out.push({ vector: chordShapeVector(hand, frameOf([hand])), label, group: `player-${p}`, t: t++ / 30 });
      }
    }
  }
  return out;
}

describe('evaluate', () => {
  it('computes accuracy, per-class precision/recall and the confusion matrix', () => {
    const e = evaluate(['C', 'C', 'G', 'G', 'D'], ['C', 'G', 'G', 'G', 'C']);
    expect(e.n).toBe(5);
    expect(e.accuracy).toBeCloseTo(3 / 5);
    expect(e.confusion.C.G).toBe(1);
    expect(e.confusion.D.C).toBe(1);
    expect(e.perClass.G.recall).toBe(1);
    expect(e.perClass.G.precision).toBeCloseTo(2 / 3);
    expect(e.perClass.D.recall).toBe(0);
    expect(e.macroF1).toBeGreaterThan(0);
    expect(e.macroF1).toBeLessThan(1);
  });

  it('rejects mismatched lengths', () => {
    expect(() => evaluate(['C'], [])).toThrow();
  });
});

describe('smoothPredictions', () => {
  it('removes a one-frame flicker and keeps a real change', () => {
    const p = ['C', 'C', 'G', 'C', 'C', 'C', 'G', 'G', 'G', 'G'];
    expect(smoothPredictions(p, 3)).toEqual(['C', 'C', 'C', 'C', 'C', 'C', 'G', 'G', 'G', 'G']);
    expect(smoothPredictions(p, 1)).toEqual(p);
  });

  it('keeps the frame’s own prediction on a tie', () => {
    expect(smoothPredictions(['X', 'X', 'Y', 'Y', 'Z'], 5)).toEqual(['X', 'X', 'Y', 'Y', 'Y']);
  });

  it('never votes across a time gap', () => {
    const p = ['C', 'C', 'C', 'G', 'G', 'G'];
    const t = [0, 0.033, 0.066, 5.0, 5.033, 5.066];
    expect(smoothPredictions(p, 5, t)).toEqual(p);
    // Index 1 sees C,G,C,G (a tie) and keeps its own G; index 3 sees three C against two G.
    expect(smoothPredictions(['C', 'G', 'C', 'G', 'C', 'C'], 5, [0, 0.03, 0.06, 0.09, 0.12, 0.15])).toEqual(['C', 'G', 'C', 'C', 'C', 'C']);
  });
});

describe('softmax regression', () => {
  const data = makeDataset(3, 30);

  it('learns the five synthetic shapes and transfers to an unseen player', () => {
    const r = leaveOneGroupOut(data, FEATURES, softmaxTrainer({ epochs: 200 }), { smoothWindow: 5 });
    expect(r.folds.length).toBe(3);
    // Seed sweep (5 seeds, 0.08 rad per-player offsets): 88 to 100% raw; 0.8 leaves margin.
    expect(r.pooledRaw.accuracy).toBeGreaterThan(0.8);
    expect(r.pooledSmoothed.accuracy).toBeGreaterThanOrEqual(r.pooledRaw.accuracy - 0.02);
    expect(r.folds.every((f) => f.unscorable === 0)).toBe(true);
    expect(formatFolds(r)).toContain('| **pooled** |');
  });

  it('gives a within-player split at least as good as the honest one', () => {
    const honest = leaveOneGroupOut(data, FEATURES, softmaxTrainer({ epochs: 200 }));
    const optimistic = withinGroupSplit(data, FEATURES, softmaxTrainer({ epochs: 200 }));
    expect(optimistic.accuracy).toBeGreaterThanOrEqual(honest.pooledRaw.accuracy - 0.05);
  });

  it('class balancing raises a rare, overlapping class’s recall over the unbalanced fit', () => {
    // Two shapes that differ by little, 12:1 imbalance, heavy jitter so they overlap.
    const near = {
      A: SHAPES.A,
      A2: { ...SHAPES.A, curl: { ...SHAPES.A.curl, ring: SHAPES.A.curl.ring - 0.15 } },
    };
    const train = makeDataset(2, 120, { shapes: near, perShape: { A: 120, A2: 10 }, jitterSd: 0.12, seed: 5 });
    const test = makeDataset(1, 60, { shapes: near, jitterSd: 0.12, seed: 6 });
    const balanced = trainSoftmax(train, FEATURES, { epochs: 200 });
    const unbalanced = trainSoftmax(train, FEATURES, { epochs: 200, classBalanced: false });
    const rare = test.filter((s) => s.label === 'A2');
    const recall = (m: SoftmaxModel) => rare.filter((s) => predict(m, s.vector) === 'A2').length / rare.length;
    expect(recall(balanced)).toBeGreaterThan(recall(unbalanced));
  });

  it('survives a JSON round trip and returns probabilities that sum to one', () => {
    const m = trainSoftmax(data, FEATURES, { epochs: 100 });
    const back = JSON.parse(JSON.stringify(m)) as SoftmaxModel;
    for (const s of data.slice(0, 20)) {
      expect(predict(back, s.vector)).toBe(predict(m, s.vector));
      const p = predictProba(back, s.vector);
      expect(Object.values(p).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });

  it('imputes a missing feature instead of failing', () => {
    const m = trainSoftmax(data, FEATURES, { epochs: 100 });
    const s = data[0];
    const holey = { ...s.vector, 'index.curl': NaN, 'spread.indexMiddle': NaN };
    expect(typeof predict(m, holey)).toBe('string');
  });

  it('is deterministic for a seed', () => {
    const a = trainSoftmax(data, FEATURES, { epochs: 30, seed: 3 });
    const b = trainSoftmax(data, FEATURES, { epochs: 30, seed: 3 });
    expect(a.weights).toEqual(b.weights);
  });

  it('refuses an empty training set and an unknown class', () => {
    expect(() => trainSoftmax([], FEATURES)).toThrow();
    expect(() => trainSoftmax(data, FEATURES, { classes: ['C'] })).toThrow(/not in classes/);
  });
});

describe('nearest-centroid baseline (the trainer classifier)', () => {
  const data = makeDataset(3, 30);

  it('also transfers across players on the synthetic shapes', () => {
    const r = leaveOneGroupOut(data, FEATURES, centroidTrainer);
    expect(r.pooledRaw.accuracy).toBeGreaterThan(0.75);
  });

  it('ignores a missing feature rather than reading it as zero', () => {
    const m = trainCentroid(data, FEATURES);
    let flips = 0;
    for (const s of data) {
      const holey = { ...s.vector, 'index.curl': NaN, 'ring.curl': NaN, 'spread.indexMiddle': NaN };
      if (predictCentroid(m, holey) !== predictCentroid(m, s.vector)) flips += 1;
    }
    expect(flips / data.length).toBeLessThan(0.1);
  });
});

describe('leaveOneGroupOut', () => {
  it('never trains on a holdout-only group (checked with a spy trainer)', () => {
    const data = makeDataset(2, 10);
    const probe = makeDataset(1, 10, { seed: 99 }).map((s) => ({ ...s, group: 'probe' }));
    const seen: string[][] = [];
    const spy: Trainer = (train, features) => {
      seen.push([...new Set(train.map((s) => s.group))]);
      return softmaxTrainer({ epochs: 20 })(train, features);
    };
    const r = leaveOneGroupOut([...data, ...probe], FEATURES, spy, { holdoutOnly: new Set(['probe']) });
    expect(r.folds.map((f) => f.group)).toContain('probe');
    expect(seen.length).toBe(3);
    for (const groups of seen) expect(groups).not.toContain('probe');
  });

  it('never trains on the held-out group itself', () => {
    const data = makeDataset(3, 5);
    const pairs: [string, string[]][] = [];
    let i = 0;
    const spy: Trainer = (train, features) => {
      pairs.push([`fold-${i++}`, [...new Set(train.map((s) => s.group))]]);
      return softmaxTrainer({ epochs: 5 })(train, features);
    };
    const r = leaveOneGroupOut(data, FEATURES, spy);
    r.folds.forEach((f, k) => expect(pairs[k][1]).not.toContain(f.group));
  });

  it('counts labels the training folds never saw as unscorable, and in the all-frames accuracy', () => {
    const data = makeDataset(2, 10);
    const odd = data.map((s) => (s.group === 'player-1' && s.label === 'C' ? { ...s, label: 'Zz' } : s));
    const r = leaveOneGroupOut(odd, FEATURES, softmaxTrainer({ epochs: 50 }));
    const fold = r.folds.find((f) => f.group === 'player-1')!;
    expect(Object.keys(fold.raw.perClass)).not.toContain('Zz');
    expect(fold.unscorable).toBe(10);
    expect(fold.accuracyAllFrames).toBeCloseTo((fold.raw.accuracy * fold.raw.n) / (fold.raw.n + 10), 9);
    expect(formatFolds(r)).toContain('| 10 |');
  });
});

describe('enrolmentSplit', () => {
  it('enrols the first seconds of each label and tests only after a gap', () => {
    const data = makeDataset(1, 60); // t runs 0..(5*60-1)/30 s, labels in blocks of 2 s
    const { enrol, test } = enrolmentSplit(data, { seconds: 0.5, fps: 30, gapSeconds: 0.5 });
    const labels = [...new Set(data.map((s) => s.label))];
    for (const l of labels) {
      const e = enrol.filter((s) => s.label === l);
      expect(e.length).toBe(15);
      const lastEnrolT = Math.max(...e.map((s) => s.t ?? 0));
      for (const s of test.filter((x) => x.label === l)) expect(s.t).toBeGreaterThan(lastEnrolT + 0.5);
    }
    expect(enrol.length + test.length).toBeLessThan(data.length);
    expect(test.length).toBeGreaterThan(0);
  });

  it('a few seconds of a new player beat every other player put together on synthetic hands', () => {
    // A player whose offsets are large (a different fingering), enrolled for 1 s per shape.
    const others = makeDataset(2, 40, { seed: 11 });
    const mine = makeDataset(1, 40, { seed: 12, offsetSd: 0.25 }).map((s) => ({ ...s, group: 'new' }));
    const { enrol, test } = enrolmentSplit(mine, { seconds: 1, fps: 30, gapSeconds: 0.2 });
    const truth = test.map((s) => s.label);
    const own = trainSoftmax(enrol, FEATURES, { epochs: 150 });
    const transfer = trainSoftmax(others, FEATURES, { epochs: 150 });
    const accOwn = evaluate(truth, test.map((s) => predict(own, s.vector))).accuracy;
    const accTransfer = evaluate(truth, test.map((s) => predict(transfer, s.vector))).accuracy;
    expect(accOwn).toBeGreaterThan(accTransfer);
  });
});
