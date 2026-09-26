/**
 * The chord-shape classifier on self-made data: three synthetic "players", each with a
 * systematic offset on every joint, five shapes, per-frame jitter. Leave-one-player-out
 * is the honest number; the model must transfer to a hand it never saw. Also the
 * evaluation arithmetic, the smoothing, and that a model survives JSON (it ships as
 * JSON to the browser).
 */
import { describe, expect, it } from 'vitest';
import { chordShapeFeatureIds, chordShapeVector } from '../../scripts/air/lib_chord_shape_features';
import {
  centroidTrainer,
  evaluate,
  formatFolds,
  leaveOneGroupOut,
  predict,
  predictProba,
  smoothPredictions,
  softmaxTrainer,
  trainSoftmax,
  withinGroupSplit,
  type Sample,
  type SoftmaxModel,
} from '../../scripts/air/lib_chord_shape_model';
import { SHAPES, frameOf, noise, perturb, rng, syntheticHand } from './synthetic_hand';

const FEATURES = chordShapeFeatureIds();

/** `perPlayer` systematic offsets + `jitter` per frame, `n` frames per shape per player. */
function makeDataset(players: number, n: number, opts: { offsetSd?: number; jitterSd?: number; seed?: number } = {}): Sample[] {
  const r = rng(opts.seed ?? 42);
  const offsetSd = opts.offsetSd ?? 0.08;
  const jitterSd = opts.jitterSd ?? 0.06;
  const out: Sample[] = [];
  for (let p = 0; p < players; p++) {
    const offsets = new Map<string, number>();
    const offset = (k: string) => {
      if (!offsets.has(k)) offsets.set(k, noise(r, offsetSd));
      return offsets.get(k) as number;
    };
    let t = 0;
    for (const [label, shape] of Object.entries(SHAPES)) {
      for (let i = 0; i < n; i++) {
        const s = perturb(shape, offset, () => noise(r, jitterSd));
        const hand = syntheticHand(s, { cx: 200 + r() * 200, cy: 200 + r() * 100, scale: 80 + r() * 60, rotation: (r() - 0.5) * 0.6 });
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

  it('never votes across a time gap', () => {
    const p = ['C', 'C', 'C', 'G', 'G', 'G'];
    const t = [0, 0.033, 0.066, 5.0, 5.033, 5.066];
    // A 5-wide window would otherwise pull the G edge toward C and vice versa.
    expect(smoothPredictions(p, 5, t)).toEqual(p);
    expect(smoothPredictions(['C', 'G', 'C', 'G', 'C', 'C'], 5, [0, 0.03, 0.06, 0.09, 0.12, 0.15])).toEqual(['C', 'C', 'C', 'C', 'C', 'C']);
  });
});

describe('softmax regression', () => {
  const data = makeDataset(3, 30);

  it('learns the five synthetic shapes and transfers to an unseen player', () => {
    const r = leaveOneGroupOut(data, FEATURES, softmaxTrainer({ epochs: 200 }), { smoothWindow: 5 });
    expect(r.folds.length).toBe(3);
    // Seed sweep (5 seeds, 0.08 rad per-player offsets): 92 to 100% raw; 0.85 leaves margin.
    expect(r.pooledRaw.accuracy).toBeGreaterThan(0.85);
    expect(r.pooledSmoothed.accuracy).toBeGreaterThanOrEqual(r.pooledRaw.accuracy - 0.02);
    expect(formatFolds(r)).toContain('| **pooled** |');
  });

  it('gives a within-player split at least as good as the honest one', () => {
    const honest = leaveOneGroupOut(data, FEATURES, softmaxTrainer({ epochs: 200 }));
    const optimistic = withinGroupSplit(data, FEATURES, softmaxTrainer({ epochs: 200 }));
    expect(optimistic.accuracy).toBeGreaterThanOrEqual(honest.pooledRaw.accuracy - 0.05);
  });

  it('is class-balanced: a rare shape is still recalled', () => {
    const rare = data.filter((s) => s.label !== 'D' || s.group === 'player-0');
    const m = trainSoftmax(rare, FEATURES, { epochs: 200 });
    const dFrames = data.filter((s) => s.label === 'D' && s.group !== 'player-0');
    const recall = dFrames.filter((s) => predict(m, s.vector) === 'D').length / dFrames.length;
    expect(recall).toBeGreaterThan(0.6);
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
  it('also transfers across players on the synthetic shapes', () => {
    const data = makeDataset(3, 30);
    const r = leaveOneGroupOut(data, FEATURES, centroidTrainer);
    expect(r.pooledRaw.accuracy).toBeGreaterThan(0.8);
  });
});

describe('leaveOneGroupOut', () => {
  it('scores a holdout-only group without training on it', () => {
    const data = makeDataset(3, 20);
    const probe = makeDataset(1, 20, { seed: 99, offsetSd: 0.3 }).map((s) => ({ ...s, group: 'probe' }));
    const r = leaveOneGroupOut([...data, ...probe], FEATURES, softmaxTrainer({ epochs: 100 }), { holdoutOnly: new Set(['probe']) });
    expect(r.folds.map((f) => f.group)).toContain('probe');
    expect(r.folds.length).toBe(4);
  });

  it('skips labels the training folds never saw', () => {
    const data = makeDataset(2, 10);
    const odd = data.map((s) => (s.group === 'player-1' && s.label === 'C' ? { ...s, label: 'Zz' } : s));
    const r = leaveOneGroupOut(odd, FEATURES, softmaxTrainer({ epochs: 50 }));
    const fold = r.folds.find((f) => f.group === 'player-1')!;
    expect(Object.keys(fold.raw.perClass)).not.toContain('Zz');
  });
});
