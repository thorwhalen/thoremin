/**
 * The chord-shape classifier and its evaluation harness. Plain TypeScript, no
 * dependencies, so the same code that scores the YouTube-derived dataset offline can run
 * a trained model in the browser later (the app is client-side; a model that needs
 * Python at play time is not an instrument).
 *
 * Two models, one evaluation, on purpose:
 *
 * - **Softmax regression** (multinomial logistic regression, Adam, L2) on standardized
 *   features. The workhorse. A linear model on ~30 joint angles is enough for a dozen
 *   open-chord shapes and it is small enough to ship as JSON.
 * - **Nearest centroid**, via the trainer's own `trainModel` / `classify`
 *   (`src/enroll/classify.ts`) with inverse-spread weights. The baseline that answers
 *   "would the existing trainer machinery, which learns a player's own categories from
 *   a few demonstrations, have been enough?" If it is close to the softmax number, the
 *   in-app path is already built.
 *
 * Held-out evaluation is **leave-one-video-out**: a chord shape learned from one
 * player's hand and camera must transfer to another's, and a random per-frame split
 * would let adjacent, near-identical frames leak across the split and report a number
 * nobody could reproduce on a new player. The within-video random split is reported too,
 * labelled as the optimistic bound.
 *
 * Missing features (`NaN`) are imputed to the training mean after standardization
 * (i.e. to 0), the least-informative value, so a frame where one finger is occluded is
 * still classifiable instead of being thrown away.
 */
import type { FeatureVector } from '@/features/catalog';
import { classify, trainModel } from '@/enroll/classify';

// ---- Data shapes -----------------------------------------------------------

/** One labelled frame: a feature vector, its chord-shape label, and which video it came from. */
export interface Sample {
  vector: FeatureVector;
  label: string;
  /** The grouping key for held-out splits (a video id, or a player). */
  group: string;
  /** Seconds into the source (kept for temporal smoothing and error inspection). */
  t?: number;
}

export interface Standardizer {
  features: string[];
  mean: number[];
  std: number[];
}

export interface SoftmaxModel {
  kind: 'softmax';
  classes: string[];
  standardizer: Standardizer;
  /** `weights[c][j]` for class c, feature j. */
  weights: number[][];
  bias: number[];
}

// ---- Standardization -------------------------------------------------------

export function fitStandardizer(samples: readonly Sample[], features: readonly string[]): Standardizer {
  const mean: number[] = [];
  const std: number[] = [];
  features.forEach((f, j) => {
    let n = 0;
    let s = 0;
    let s2 = 0;
    for (const x of samples) {
      const v = x.vector[f];
      if (!Number.isFinite(v)) continue;
      n += 1;
      s += v;
      s2 += v * v;
    }
    const m = n > 0 ? s / n : 0;
    const varc = n > 1 ? Math.max(0, s2 / n - m * m) : 0;
    mean[j] = m;
    std[j] = varc > 1e-12 ? Math.sqrt(varc) : 1;
  });
  return { features: [...features], mean, std };
}

/** Standardize one vector; a missing/non-finite feature becomes 0 (the mean). */
export function standardize(st: Standardizer, vector: FeatureVector): number[] {
  return st.features.map((f, j) => {
    const v = vector[f];
    return Number.isFinite(v) ? (v - st.mean[j]) / st.std[j] : 0;
  });
}

// ---- Softmax regression ----------------------------------------------------

export interface SoftmaxTrainOptions {
  epochs?: number;
  learningRate?: number;
  /** L2 penalty on the weights (not the bias). */
  l2?: number;
  seed?: number;
  /** Explicit class order; default = sorted labels seen in training. */
  classes?: readonly string[];
}

const SOFTMAX_DEFAULTS = { epochs: 300, learningRate: 0.05, l2: 1e-3, seed: 1 };

/** Deterministic tiny PRNG (mulberry32) so a training run is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function softmaxRow(logits: number[]): number[] {
  const m = Math.max(...logits);
  const e = logits.map((z) => Math.exp(z - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export function trainSoftmax(
  samples: readonly Sample[],
  features: readonly string[],
  options: SoftmaxTrainOptions = {},
): SoftmaxModel {
  const o = { ...SOFTMAX_DEFAULTS, ...options };
  if (samples.length === 0) throw new Error('trainSoftmax: no samples');
  const classes = o.classes ? [...o.classes] : [...new Set(samples.map((s) => s.label))].sort();
  const classIndex = new Map(classes.map((c, i) => [c, i]));
  for (const s of samples) if (!classIndex.has(s.label)) throw new Error(`trainSoftmax: label ${s.label} not in classes`);
  const st = fitStandardizer(samples, features);
  const X = samples.map((s) => standardize(st, s.vector));
  const y = samples.map((s) => classIndex.get(s.label) as number);
  const C = classes.length;
  const D = features.length;
  const N = samples.length;
  const rnd = mulberry32(o.seed);
  const W = Array.from({ length: C }, () => Array.from({ length: D }, () => (rnd() - 0.5) * 0.01));
  const b = new Array<number>(C).fill(0);
  // Adam state.
  const mW = W.map((r) => r.map(() => 0));
  const vW = W.map((r) => r.map(() => 0));
  const mB = new Array<number>(C).fill(0);
  const vB = new Array<number>(C).fill(0);
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  // Class-balanced loss: the audio labeller hands out very different amounts of each
  // chord, and a model that learns "it is usually G" is not a chord recogniser.
  const counts = new Array<number>(C).fill(0);
  for (const yi of y) counts[yi] += 1;
  const classWeight = counts.map((n) => (n > 0 ? N / (C * n) : 0));

  for (let epoch = 1; epoch <= o.epochs; epoch++) {
    const gW = W.map((r) => r.map(() => 0));
    const gB = new Array<number>(C).fill(0);
    for (let i = 0; i < N; i++) {
      const x = X[i];
      const logits = W.map((row, c) => b[c] + row.reduce((acc, w, j) => acc + w * x[j], 0));
      const p = softmaxRow(logits);
      const cw = classWeight[y[i]] / N;
      for (let c = 0; c < C; c++) {
        const g = (p[c] - (c === y[i] ? 1 : 0)) * cw;
        gB[c] += g;
        const row = gW[c];
        for (let j = 0; j < D; j++) row[j] += g * x[j];
      }
    }
    const lrT = o.learningRate * Math.sqrt(1 - beta2 ** epoch) / (1 - beta1 ** epoch);
    for (let c = 0; c < C; c++) {
      for (let j = 0; j < D; j++) {
        const g = gW[c][j] + o.l2 * W[c][j];
        mW[c][j] = beta1 * mW[c][j] + (1 - beta1) * g;
        vW[c][j] = beta2 * vW[c][j] + (1 - beta2) * g * g;
        W[c][j] -= (lrT * mW[c][j]) / (Math.sqrt(vW[c][j]) + eps);
      }
      mB[c] = beta1 * mB[c] + (1 - beta1) * gB[c];
      vB[c] = beta2 * vB[c] + (1 - beta2) * gB[c] * gB[c];
      b[c] -= (lrT * mB[c]) / (Math.sqrt(vB[c]) + eps);
    }
  }
  return { kind: 'softmax', classes, standardizer: st, weights: W, bias: b };
}

/** Class probabilities for one vector, keyed by class label. */
export function predictProba(model: SoftmaxModel, vector: FeatureVector): Record<string, number> {
  const x = standardize(model.standardizer, vector);
  const logits = model.weights.map((row, c) => model.bias[c] + row.reduce((acc, w, j) => acc + w * x[j], 0));
  const p = softmaxRow(logits);
  const out: Record<string, number> = {};
  model.classes.forEach((c, i) => (out[c] = p[i]));
  return out;
}

export function predict(model: SoftmaxModel, vector: FeatureVector): string {
  const p = predictProba(model, vector);
  let best = model.classes[0];
  for (const c of model.classes) if (p[c] > p[best]) best = c;
  return best;
}

// ---- Nearest-centroid baseline (the trainer's own classifier) ----------------

export interface CentroidModel {
  kind: 'centroid';
  classes: string[];
  model: ReturnType<typeof trainModel>;
}

/**
 * The trainer's nearest-centroid model with inverse-spread weights, one category per
 * label. Reject radius is set to infinity: this is a closed-set evaluation.
 */
export function trainCentroid(samples: readonly Sample[], features: readonly string[]): CentroidModel {
  const classes = [...new Set(samples.map((s) => s.label))].sort();
  const st = fitStandardizer(samples, features);
  const weights: Record<string, number> = {};
  features.forEach((f, j) => (weights[f] = 1 / st.std[j]));
  const clusters = classes.map((c) => samples.map((s, i) => (s.label === c ? i : -1)).filter((i) => i >= 0));
  // Impute NaN to the mean before handing over: the trainer's mean skips NaN but its
  // distance does not.
  const vectors = samples.map((s) => {
    const v: FeatureVector = {};
    features.forEach((f, j) => (v[f] = Number.isFinite(s.vector[f]) ? s.vector[f] : st.mean[j]));
    return v;
  });
  const m = trainModel(vectors, clusters, [...features], weights, { defaultRejectRadius: Infinity, acceptQuantile: 1 });
  m.rejectRadius = Infinity;
  m.categories.forEach((cat, i) => (cat.label = classes[i]));
  return { kind: 'centroid', classes, model: m };
}

export function predictCentroid(cm: CentroidModel, vector: FeatureVector): string {
  const st = cm.model.features;
  const v: FeatureVector = {};
  for (const f of st) v[f] = Number.isFinite(vector[f]) ? vector[f] : 0;
  const r = classify(cm.model, v);
  // categoryId maps to the category with that id; label carries the class.
  const cat = cm.model.categories.find((c) => c.id === r.categoryId) ?? cm.model.categories[0];
  return cat.label;
}

// ---- Evaluation ------------------------------------------------------------

export interface ClassReport {
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface Evaluation {
  n: number;
  accuracy: number;
  macroF1: number;
  perClass: Record<string, ClassReport>;
  /** `confusion[truth][predicted]` counts. */
  confusion: Record<string, Record<string, number>>;
}

export function evaluate(truth: readonly string[], predicted: readonly string[]): Evaluation {
  if (truth.length !== predicted.length) throw new Error('evaluate: length mismatch');
  const classes = [...new Set([...truth, ...predicted])].sort();
  const confusion: Record<string, Record<string, number>> = {};
  for (const a of classes) {
    confusion[a] = {};
    for (const b of classes) confusion[a][b] = 0;
  }
  let correct = 0;
  truth.forEach((t, i) => {
    confusion[t][predicted[i]] += 1;
    if (t === predicted[i]) correct += 1;
  });
  const perClass: Record<string, ClassReport> = {};
  let f1Sum = 0;
  let f1Count = 0;
  for (const c of classes) {
    const tp = confusion[c][c];
    const support = classes.reduce((s, b) => s + confusion[c][b], 0);
    const predictedAs = classes.reduce((s, a) => s + confusion[a][c], 0);
    const precision = predictedAs > 0 ? tp / predictedAs : 0;
    const recall = support > 0 ? tp / support : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[c] = { support, precision, recall, f1 };
    if (support > 0) {
      f1Sum += f1;
      f1Count += 1;
    }
  }
  return {
    n: truth.length,
    accuracy: truth.length ? correct / truth.length : 0,
    macroF1: f1Count ? f1Sum / f1Count : 0,
    perClass,
    confusion,
  };
}

/**
 * Majority vote over a sliding window of predictions (frames are ordered by time
 * within a group). A chord is held for beats, not frames; a one-frame flicker to a
 * neighbouring shape is noise the player never intended. `window` is in frames.
 *
 * When `times` are given the window never crosses a gap larger than `maxGap` seconds:
 * the scored frames of a video are not contiguous (the join drops the margin around
 * every chord change and every no-chord span), and a vote that reaches across such a
 * gap mixes two chords the player never played together.
 */
export function smoothPredictions(
  predicted: readonly string[],
  window: number,
  times?: readonly number[],
  maxGap = 0.2,
): string[] {
  if (window <= 1) return [...predicted];
  const half = Math.floor(window / 2);
  const contiguous = (a: number, b: number): boolean => {
    if (!times) return true;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let k = lo; k < hi; k++) if (times[k + 1] - times[k] > maxGap) return false;
    return true;
  };
  return predicted.map((_, i) => {
    const counts = new Map<string, number>();
    for (let j = Math.max(0, i - half); j <= Math.min(predicted.length - 1, i + half); j++) {
      if (!contiguous(i, j)) continue;
      counts.set(predicted[j], (counts.get(predicted[j]) ?? 0) + 1);
    }
    let best = predicted[i];
    let bestN = -1;
    for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
    return best;
  });
}

export type Trainer = (train: readonly Sample[], features: readonly string[]) => (v: FeatureVector) => string;

export const softmaxTrainer =
  (options: SoftmaxTrainOptions = {}): Trainer =>
  (train, features) => {
    const m = trainSoftmax(train, features, options);
    return (v) => predict(m, v);
  };

export const centroidTrainer: Trainer = (train, features) => {
  const m = trainCentroid(train, features);
  return (v) => predictCentroid(m, v);
};

export interface GroupFold {
  group: string;
  /** Frame-level evaluation on the held-out group. */
  raw: Evaluation;
  /** After majority-vote smoothing over `smoothWindow` frames. */
  smoothed: Evaluation;
}

export interface LeaveOneGroupOutResult {
  folds: GroupFold[];
  /** All held-out predictions pooled, frame level. */
  pooledRaw: Evaluation;
  pooledSmoothed: Evaluation;
  smoothWindow: number;
}

/**
 * Leave-one-group-out cross-validation. Every group is held out once; the model sees
 * the other groups only. Groups flagged in `holdoutOnly` are scored but never trained
 * on (an air-guitar clip is a domain-shift probe, not training data).
 */
export function leaveOneGroupOut(
  samples: readonly Sample[],
  features: readonly string[],
  trainer: Trainer,
  options: { smoothWindow?: number; holdoutOnly?: ReadonlySet<string> } = {},
): LeaveOneGroupOutResult {
  const smoothWindow = options.smoothWindow ?? 9;
  const holdoutOnly = options.holdoutOnly ?? new Set<string>();
  const groups = [...new Set(samples.map((s) => s.group))].sort();
  const trainable = samples.filter((s) => !holdoutOnly.has(s.group));
  const folds: GroupFold[] = [];
  const pooledT: string[] = [];
  const pooledP: string[] = [];
  const pooledS: string[] = [];
  for (const g of groups) {
    const train = trainable.filter((s) => s.group !== g);
    const test = samples.filter((s) => s.group === g).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    if (train.length === 0 || test.length === 0) continue;
    const trainLabels = new Set(train.map((s) => s.label));
    const scorable = test.filter((s) => trainLabels.has(s.label));
    if (scorable.length === 0) continue;
    const f = trainer(train, features);
    const truth = scorable.map((s) => s.label);
    const pred = scorable.map((s) => f(s.vector));
    const smooth = smoothPredictions(pred, smoothWindow, scorable.map((s) => s.t ?? 0));
    folds.push({ group: g, raw: evaluate(truth, pred), smoothed: evaluate(truth, smooth) });
    pooledT.push(...truth);
    pooledP.push(...pred);
    pooledS.push(...smooth);
  }
  return {
    folds,
    pooledRaw: evaluate(pooledT, pooledP),
    pooledSmoothed: evaluate(pooledT, pooledS),
    smoothWindow,
  };
}

/**
 * The optimistic bound: a random per-frame split inside every group, stratified by
 * group only. Adjacent frames leak across it; that is the point of reporting it next
 * to the honest number.
 */
export function withinGroupSplit(
  samples: readonly Sample[],
  features: readonly string[],
  trainer: Trainer,
  options: { testFraction?: number; seed?: number } = {},
): Evaluation {
  const frac = options.testFraction ?? 0.25;
  const rnd = mulberry32(options.seed ?? 7);
  const train: Sample[] = [];
  const test: Sample[] = [];
  for (const s of samples) (rnd() < frac ? test : train).push(s);
  const f = trainer(train, features);
  return evaluate(
    test.map((s) => s.label),
    test.map((s) => f(s.vector)),
  );
}

/** A markdown table of a leave-one-group-out result, for the docs. */
export function formatFolds(r: LeaveOneGroupOutResult): string {
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const rows = r.folds.map(
    (f) => `| ${f.group} | ${f.raw.n} | ${pct(f.raw.accuracy)} | ${pct(f.raw.macroF1)} | ${pct(f.smoothed.accuracy)} |`,
  );
  return [
    `| held-out group | frames | accuracy | macro-F1 | accuracy, ${r.smoothWindow}-frame vote |`,
    '|---|---|---|---|---|',
    ...rows,
    `| **pooled** | ${r.pooledRaw.n} | **${pct(r.pooledRaw.accuracy)}** | ${pct(r.pooledRaw.macroF1)} | **${pct(r.pooledSmoothed.accuracy)}** |`,
  ].join('\n');
}
