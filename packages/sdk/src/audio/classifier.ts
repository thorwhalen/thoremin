/**
 * A few-shot classifier for struck sounds: the player taps each surface a handful of times,
 * and every later tap is named by its nearest taught example
 * (`docs/research/live-audio-to-audio.md` §4-5).
 *
 * Why nearest-example and not the trainer's categorizer (`../enroll/classify.ts`). That one
 * classifies a continuous stream of poses with hysteresis, holding the last good category
 * while unsure; a tap is a single discrete event with no neighbour in time to hold to, and it
 * must be decided inside the audio thread in microseconds. With five to twenty examples per
 * class, the literature's strongest simple baseline is nearest-neighbour (or nearest
 * prototype) in a well-scaled space; what makes or breaks it is the SCALING. So:
 *
 * - each feature is divided by its POOLED WITHIN-CLASS spread (how much the same surface
 *   varies from tap to tap), floored at a fraction of its overall spread so a feature that
 *   happens to be constant inside every class does not become infinitely loud. A distance of
 *   1 then means "as different as two taps of the same surface usually are";
 * - the decision is the nearest EXAMPLE per class (not the class mean: a surface struck in two
 *   places has two clusters, and a mean between them matches neither);
 * - confidence is the margin between the nearest class and the next other class;
 * - a sound farther than `rejectDistance` from every example is nothing taught (null), set
 *   from the taught examples' own leave-one-out distances, not a constant.
 *
 * The trained model is plain data (arrays and numbers) so it crosses `postMessage` into the
 * worklet and persists as JSON; {@link createSoundClassifier} makes the allocation-free
 * runtime from it.
 */
import { quantile } from '@thoremin/stats';

export interface SoundExample {
  label: string;
  features: ArrayLike<number>;
}

/** A trained model, as data. */
export interface SoundModel {
  version: 1;
  /** One per example, in the order of `points`. */
  labels: string[];
  /** The examples, already standardised (`(x - center) / scale`). */
  points: number[][];
  center: number[];
  scale: number[];
  weights: number[];
  /** Beyond this (standardised, weighted RMS) distance a sound is nothing taught. */
  rejectDistance: number;
}

export interface TrainSoundOptions {
  /** Per-feature weights (default 1 each). */
  weights?: ArrayLike<number>;
  /** Within-class spread floor, as a fraction of the overall spread. */
  scaleFloor?: number;
  /** The reject distance is `rejectScale` x this quantile of the leave-one-out same-class distances. */
  rejectQuantile?: number;
  rejectScale?: number;
  /** The reject distance when no class has two examples (nothing to measure it from). */
  defaultRejectDistance?: number;
}

export const TRAIN_SOUND_DEFAULTS = { scaleFloor: 0.15, rejectQuantile: 0.9, rejectScale: 3, defaultRejectDistance: 6 } as const;

export interface SoundDecision {
  label: string | null;
  /** The nearest class even when rejected (for a readout), or null with no examples. */
  nearest: string | null;
  distance: number;
  confidence: number;
}

function weightedDistance(a: ArrayLike<number>, b: ArrayLike<number>, w: ArrayLike<number>, wSum: number): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += w[i] * d * d;
  }
  return Math.sqrt(s / wSum);
}

export function trainSoundModel(examples: readonly SoundExample[], options: TrainSoundOptions = {}): SoundModel {
  const o = { ...TRAIN_SOUND_DEFAULTS, ...options };
  if (examples.length === 0) throw new Error('trainSoundModel: no examples');
  const dim = examples[0].features.length;
  for (const e of examples) if (e.features.length !== dim) throw new Error(`trainSoundModel: feature length ${e.features.length} != ${dim}`);
  const weights = Array.from({ length: dim }, (_, i) => Number(o.weights?.[i] ?? 1));
  const center = new Array<number>(dim).fill(0);
  for (const e of examples) for (let i = 0; i < dim; i++) center[i] += e.features[i] / examples.length;
  // Overall and pooled within-class variance.
  const overall = new Array<number>(dim).fill(0);
  for (const e of examples) for (let i = 0; i < dim; i++) overall[i] += (e.features[i] - center[i]) ** 2 / examples.length;
  const byLabel = new Map<string, SoundExample[]>();
  for (const e of examples) byLabel.set(e.label, [...(byLabel.get(e.label) ?? []), e]);
  const within = new Array<number>(dim).fill(0);
  let dof = 0;
  for (const group of byLabel.values()) {
    if (group.length < 2) continue;
    const mean = new Array<number>(dim).fill(0);
    for (const e of group) for (let i = 0; i < dim; i++) mean[i] += e.features[i] / group.length;
    for (const e of group) for (let i = 0; i < dim; i++) within[i] += (e.features[i] - mean[i]) ** 2;
    dof += group.length - 1;
  }
  const scale = within.map((w, i) => {
    const overallSd = Math.sqrt(overall[i]);
    const withinSd = dof > 0 ? Math.sqrt(w / dof) : overallSd;
    return Math.max(withinSd, o.scaleFloor * overallSd, 1e-6);
  });
  const points = examples.map((e) => Array.from({ length: dim }, (_, i) => (e.features[i] - center[i]) / scale[i]));
  const labels = examples.map((e) => e.label);
  const wSum = weights.reduce((a, b) => a + b, 0);
  // Leave-one-out: each example's distance to its nearest OTHER example of the same class.
  const loo: number[] = [];
  for (let a = 0; a < points.length; a++) {
    let best = Infinity;
    for (let b = 0; b < points.length; b++) if (b !== a && labels[b] === labels[a]) best = Math.min(best, weightedDistance(points[a], points[b], weights, wSum));
    if (Number.isFinite(best)) loo.push(best);
  }
  const rejectDistance = loo.length > 0 ? Math.max(1, o.rejectScale * quantile(loo, o.rejectQuantile)) : o.defaultRejectDistance;
  return { version: 1, labels, points, center, scale, weights, rejectDistance };
}

export interface SoundClassifier {
  readonly model: SoundModel;
  /** Decide `features` (raw, unstandardised). Allocates nothing but the returned object's fields. */
  classify(features: ArrayLike<number>): SoundDecision;
}

export function createSoundClassifier(model: SoundModel): SoundClassifier {
  const dim = model.center.length;
  const z = new Float64Array(dim);
  const wSum = model.weights.reduce((a, b) => a + b, 0) || 1;
  const distinct = [...new Set(model.labels)];
  const index = new Map(distinct.map((l, i) => [l, i]));
  const labelIdx = model.labels.map((l) => index.get(l) ?? 0);
  const nearestPer = new Float64Array(distinct.length);
  return {
    model,
    classify(features) {
      if (model.points.length === 0) return { label: null, nearest: null, distance: Infinity, confidence: 0 };
      for (let i = 0; i < dim; i++) z[i] = (features[i] - model.center[i]) / model.scale[i];
      nearestPer.fill(Infinity);
      for (let p = 0; p < model.points.length; p++) {
        const d = weightedDistance(z, model.points[p], model.weights, wSum);
        if (d < nearestPer[labelIdx[p]]) nearestPer[labelIdx[p]] = d;
      }
      let best = 0;
      for (let c = 1; c < distinct.length; c++) if (nearestPer[c] < nearestPer[best]) best = c;
      let second = Infinity;
      for (let c = 0; c < distinct.length; c++) if (c !== best) second = Math.min(second, nearestPer[c]);
      const d1 = nearestPer[best];
      const confidence = Number.isFinite(second) ? (second - d1) / (second + d1 + 1e-12) : 1;
      const nearest = distinct[best];
      return { label: d1 <= model.rejectDistance ? nearest : null, nearest, distance: d1, confidence };
    },
  };
}
