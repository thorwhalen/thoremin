/**
 * A saved face categorizer read live (#330 P3): the tuning a player sets at classification
 * time (no retraining), the model that tuning gives, and one reading per live frame.
 *
 * Three dials, each acting on the LIVE side only, so the samples (the categorizer's source of
 * truth) never change because the room did:
 *
 * - **Sensitivity** scales how far a live face is from the player's resting face before it is
 *   classified: `rest + s (v - rest)`. Above 1 a smaller face reaches its category (a tired
 *   evening, a face that is smaller than it was in the take); below 1 it takes a bigger one.
 *   The rest is the categorizer's own neutral: its Neutral holds when strangers read as Neutral
 *   or Neutral is taught (#385 E5), else the category named `neutral` (an older file whose
 *   every face was a category). A categorizer with neither has no rest to scale from, and the
 *   dial says so ({@link LiveModel.rest} is null).
 * - **Reject radius** (only when a face never taught reads as Neutral) scales the distance
 *   beyond which a face is "none of these". It scales a FLOORED base: the stored radius, raised to the distance that accepts
 *   {@link LIVE_DEFAULTS.acceptQuantile} of the categorizer's own samples (the `trainModel`
 *   floor), because a file can carry a radius so small that the model would reject the faces
 *   it was made from (P1's adversarial review). When strangers read as the nearest face nothing is
 *   rejected and the dial is CLAMPED out: the radius stays `NO_REJECT_RADIUS`, never `MAX_VALUE x scale`
 *   (`Infinity`, which the model schema refuses).
 * - **Distance** subtracts what camera distance does to each feature, learned from the
 *   categorizer's own samples: within each category, the slope of the feature against the
 *   log of the face's scale (`face.head.scale`, else `face.head.distanceProxy`), pooled across
 *   categories (an expression is held constant inside a category, so what co-varies with
 *   distance there is the nuisance). The live face is moved back to the samples' mean distance,
 *   by the dial's strength (0 = off). A take that hardly moved toward or away from the camera
 *   teaches no slope, and the dial says so ({@link DistanceFit.learned}); a feature distance
 *   explains poorly (r² under {@link LIVE_DEFAULTS.minR2}) keeps no slope. See
 *   `docs/research/face-categorizer-lighting-and-distance.md` for what was measured.
 * - **Size**, one per category (#385 E7: Project Gameface's "gesture size", Apple's
 *   per-expression level): how big a face it takes to count as that category. The category's
 *   every distance is multiplied by it (`Category.scale`, read by `classify` and the margin
 *   meter), so above 1 the face must go further, below 1 a smaller one reaches it: the fix for "I
 *   can make frown, but only a small one" without recording again. Kept by category id WITH the
 *   category's name: a size applies only while that id still carries that name (a re-cut can give
 *   the id to another face; a rename makes it another category, as the quiz's results do).
 *
 * Pure: no timers, no React. The test store polls a source and feeds {@link LiveReader.push}.
 *
 * In the SDK since #371 (it was the faces extension's `lib/live.ts`): the host's category
 * dispatcher reads a bound categorizer through the same live model the tool tests it with.
 */
import { z } from 'zod';
import { createCategoryTracker, trainModel, type CategoryTracker } from './classify';
import { memberIndices, modelFromCategorizer, neutralSampleIndices, NO_REJECT_RADIUS, type PersonalCategorizer } from './categorizer';
import { liveMargin, type LiveMargin } from './quality';
import type { FeatureVector, TrainedModel } from './types';
import { createReader, inView, isNeutralLabel, type CarveModality } from './modality';
import { faceModality } from '../features/modalities/face';

/** The face's proxies of camera distance, in order of preference (both bigger when closer). */
export const DISTANCE_PROXIES: readonly string[] = faceModality.nuisance.distance ?? [];

/** Which modality a categorizer is read as (the face by default): its neutral name and its
 *  distance proxies. */
export interface ModalityOption {
  modality?: CarveModality;
}

export const TUNING_BOUNDS = {
  sensitivity: { min: 0.5, max: 2 },
  rejectScale: { min: 0.5, max: 3 },
  distance: { min: 0, max: 1 },
  size: { min: 0.5, max: 2 },
} as const;

/** A categorizer's live tuning; every default leaves the saved model as it was. */
export const TuningSchema = z.object({
  sensitivity: z.number().min(TUNING_BOUNDS.sensitivity.min).max(TUNING_BOUNDS.sensitivity.max).default(1),
  rejectScale: z.number().min(TUNING_BOUNDS.rejectScale.min).max(TUNING_BOUNDS.rejectScale.max).default(1),
  distance: z.number().min(TUNING_BOUNDS.distance.min).max(TUNING_BOUNDS.distance.max).default(0),
  /** Per category id, its size and the category's name when it was set (#385 E7); absent = 1. */
  sizes: z.record(z.string(), z.object({ scale: z.number().min(TUNING_BOUNDS.size.min).max(TUNING_BOUNDS.size.max), label: z.string() })).default({}),
});
export type Tuning = z.infer<typeof TuningSchema>;
export const DEFAULT_TUNING: Tuning = TuningSchema.parse({});

/** A tuning value pulled into its dial's range (a stored or hand-edited value never escapes it). */
export function clampTuning(t: Partial<Tuning>): Tuning {
  const within = (x: unknown, { min, max }: { min: number; max: number }, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback);
  const sizes: Tuning['sizes'] = {};
  for (const [id, x] of Object.entries(t.sizes ?? {})) {
    const v = within(x?.scale, TUNING_BOUNDS.size, 1);
    // A size of 1 is no size: dropped, so a tuning set back to neutral equals the default.
    if (v !== 1 && typeof x?.label === 'string') sizes[id] = { scale: v, label: x.label };
  }
  return {
    sensitivity: within(t.sensitivity, TUNING_BOUNDS.sensitivity, DEFAULT_TUNING.sensitivity),
    rejectScale: within(t.rejectScale, TUNING_BOUNDS.rejectScale, DEFAULT_TUNING.rejectScale),
    distance: within(t.distance, TUNING_BOUNDS.distance, DEFAULT_TUNING.distance),
    sizes,
  };
}

/** Whether two tunings set every dial alike. */
export function sameTuning(a: Tuning, b: Tuning): boolean {
  const ka = Object.keys(a.sizes);
  return (
    a.sensitivity === b.sensitivity &&
    a.rejectScale === b.rejectScale &&
    a.distance === b.distance &&
    ka.length === Object.keys(b.sizes).length &&
    ka.every((id) => a.sizes[id]?.scale === b.sizes[id]?.scale && a.sizes[id]?.label === b.sizes[id]?.label)
  );
}

/** Category `c`'s size under `tuning`: its own while the id still carries the name it was set
 *  under, else 1. */
export function sizeOf(tuning: Pick<Tuning, 'sizes'>, c: { id: string; label: string }): number {
  const s = tuning.sizes[c.id];
  return s && s.label.trim().toLowerCase() === c.label.trim().toLowerCase() ? s.scale : 1;
}

export const LIVE_DEFAULTS = {
  /** The reject radius is never below the distance that accepts this share of the samples. */
  acceptQuantile: 0.9,
  /** Absolute minimum radius (noise units). */
  minRadius: 1e-3,
  /** Membership softness, as a fraction of the mean category radius: distances are in noise
   *  units, so a fixed temperature would be one-hot for one categorizer and flat for another. */
  softness: 0.5,
  /** Samples with a distance proxy needed before a slope is learned. */
  minDistanceSamples: 6,
  /** Pooled within-category spread of log scale (about 5 %) needed before a slope is learned. */
  minLogScaleSpread: 0.05,
  /** A feature's slope is kept only when distance explains at least this share of its
   *  within-category variance: measured, distance moves about a dozen features cleanly and the
   *  rest weakly or not at all, and subtracting a weak fit only adds its error. */
  minR2: 0.5,
  /** The readout's hysteresis: the tracker's defaults, but rejection SHOWS (the player is
   *  checking what reads as neutral, so holding the last category would hide it). */
  enterFrames: 3,
  exitFrames: 8,
} as const;

/** The categorizer's reject radius raised to the floor that accepts its own samples. */
export function flooredRejectRadius(categorizer: PersonalCategorizer, model: TrainedModel = modelFromCategorizer(categorizer)): number {
  if (categorizer.strangers !== 'neutral') return NO_REJECT_RADIUS;
  const floor = trainModel(
    categorizer.samples.map((s) => s.vector),
    memberIndices(categorizer),
    model.features,
    model.weights,
    { defaultRejectRadius: LIVE_DEFAULTS.minRadius, acceptQuantile: LIVE_DEFAULTS.acceptQuantile },
  ).rejectRadius;
  return Math.max(model.rejectRadius, floor, LIVE_DEFAULTS.minRadius);
}

/** The radius the reject dial gives: a scale on the floored base; clamped out when strangers
 *  read as the nearest face. */
export function tunedRejectRadius(base: number, strangers: PersonalCategorizer['strangers'], rejectScale: number): number {
  if (strangers !== 'neutral' || base >= NO_REJECT_RADIUS) return NO_REJECT_RADIUS;
  const scale = clampTuning({ rejectScale }).rejectScale;
  return Math.min(NO_REJECT_RADIUS, Math.max(LIVE_DEFAULTS.minRadius, base * scale));
}

/** The mean over `features` of the finite values of `vectors`. */
function meanOver(vectors: readonly FeatureVector[], features: readonly string[]): FeatureVector {
  const out: FeatureVector = {};
  for (const f of features) {
    let s = 0;
    let n = 0;
    for (const v of vectors) {
      const x = v[f];
      if (Number.isFinite(x)) {
        s += x;
        n += 1;
      }
    }
    if (n > 0) out[f] = s / n;
  }
  return out;
}

/** The categorizer's resting face: its Neutral samples (strangers read as Neutral, or Neutral is
 *  taught and has holds), or its `neutral` category (an older file whose every face was a
 *  category); null when it has neither. */
export function restOf(categorizer: PersonalCategorizer, features: readonly string[], { modality = faceModality }: ModalityOption = {}): FeatureVector | null {
  const vectors = categorizer.samples.map((s) => s.vector);
  let idx: number[];
  if (categorizer.strangers === 'neutral' || (categorizer.neutralTrained && categorizer.neutral.length > 0)) {
    idx = neutralSampleIndices(categorizer);
  } else {
    const at = memberIndices(categorizer);
    idx = at[categorizer.categories.findIndex((c) => isNeutralLabel(modality, c.label))] ?? [];
  }
  if (idx.length === 0) return null;
  return meanOver(idx.map((i) => vectors[i]), features);
}

/** What the categorizer's samples say camera distance does to each feature. */
export interface DistanceFit {
  /** The proxy used (`face.head.scale`, ...), or null when the samples carry none. */
  proxy: string | null;
  /** Whether the samples moved enough in distance to learn from. */
  learned: boolean;
  /** Mean log proxy of the samples: the distance a live face is moved back to. */
  reference: number;
  /** Pooled within-category standard deviation of log proxy (how much the take moved). */
  spread: number;
  /** Per feature: the change per unit of log proxy, for the features distance explains (r² at
   *  least {@link LIVE_DEFAULTS.minR2}); the others are left alone. */
  slopes: Readonly<Record<string, number>>;
}

/** Fit, per feature, the pooled within-category slope against log distance proxy. */
export function fitDistance(categorizer: PersonalCategorizer, features: readonly string[], { modality = faceModality }: ModalityOption = {}): DistanceFit {
  const none = (proxy: string | null): DistanceFit => ({ proxy, learned: false, reference: 0, spread: 0, slopes: {} });
  const samples = categorizer.samples;
  const proxy = (modality.nuisance.distance ?? []).find((p) => samples.filter((s) => (s.vector[p] ?? 0) > 0).length >= LIVE_DEFAULTS.minDistanceSamples) ?? null;
  if (!proxy) return none(null);
  const z = (i: number) => {
    const x = samples[i].vector[proxy];
    return Number.isFinite(x) && x > 0 ? Math.log(x) : NaN;
  };
  // Centre z and every feature within its category, then pool.
  let sxx = 0;
  let n = 0;
  let zSum = 0;
  let zN = 0;
  const sxy: Record<string, number> = {};
  const syy: Record<string, number> = {};
  for (const members of memberIndices(categorizer)) {
    const ms = members.filter((i) => Number.isFinite(z(i)));
    if (ms.length < 2) continue;
    const zMean = ms.reduce((a, i) => a + z(i), 0) / ms.length;
    const fMean = meanOver(ms.map((i) => samples[i].vector), features);
    for (const i of ms) {
      const dz = z(i) - zMean;
      sxx += dz * dz;
      n += 1;
      for (const f of features) {
        const x = samples[i].vector[f];
        if (!Number.isFinite(x) || !Number.isFinite(fMean[f])) continue;
        sxy[f] = (sxy[f] ?? 0) + dz * (x - fMean[f]);
        syy[f] = (syy[f] ?? 0) + (x - fMean[f]) ** 2;
      }
    }
  }
  for (let i = 0; i < samples.length; i++) {
    if (Number.isFinite(z(i))) {
      zSum += z(i);
      zN += 1;
    }
  }
  const spread = n > 1 ? Math.sqrt(sxx / (n - 1)) : 0;
  const reference = zN > 0 ? zSum / zN : 0;
  if (n < LIVE_DEFAULTS.minDistanceSamples || spread < LIVE_DEFAULTS.minLogScaleSpread) return { proxy, learned: false, reference, spread, slopes: {} };
  const slopes: Record<string, number> = {};
  for (const f of features) {
    const xy = sxy[f] ?? 0;
    const yy = syy[f] ?? 0;
    if (yy > 0 && (xy * xy) / (sxx * yy) >= LIVE_DEFAULTS.minR2) slopes[f] = xy / sxx;
  }
  return { proxy, learned: true, reference, spread, slopes };
}

/** A categorizer ready to read live faces under a tuning. */
export interface LiveModel {
  /** The derived model with the tuned reject radius. */
  model: TrainedModel;
  tuning: Tuning;
  /** The floored, untuned reject radius (`NO_REJECT_RADIUS` when strangers read as the nearest
   *  face). */
  baseRadius: number;
  /** The resting face sensitivity scales from, or null (the dial does nothing). */
  rest: FeatureVector | null;
  distance: DistanceFit;
  /** Softmax temperature for the memberships (noise units). */
  temperature: number;
  /** The merged live vector as this categorizer reads it (#385 E8): its modality's projection
   *  with its hand (a hand categorizer's one hand, side-relative); the face's is the identity. */
  project(merged: FeatureVector): FeatureVector;
  /** Whether a projected vector shows the part well enough to read (#382: a body needs most of
   *  the features its categories were taught on; a face or a hand, any one). */
  inView(vector: FeatureVector): boolean;
}

export function liveModel(categorizer: PersonalCategorizer, tuning: Partial<Tuning> = {}, options: ModalityOption = {}): LiveModel {
  const t = clampTuning(tuning);
  const derived = modelFromCategorizer(categorizer);
  const baseRadius = flooredRejectRadius(categorizer, derived);
  const sized = derived.categories.map((c) => {
    const scale = sizeOf(t, c);
    return scale !== 1 ? { ...c, scale } : c;
  });
  const modality = options.modality ?? faceModality;
  // A modality that renormalises (#458, the body) says so on the model; faces and hands keep a
  // model with no such key, so they classify bit for bit as before.
  const reading: TrainedModel = modality.renormalize ? { ...derived, renormalize: true } : derived;
  const model: TrainedModel = { ...reading, categories: sized, rejectRadius: tunedRejectRadius(baseRadius, categorizer.strangers, t.rejectScale) };
  const meanRadius = derived.categories.reduce((a, c) => a + c.radius, 0) / Math.max(1, derived.categories.length);
  return {
    model,
    tuning: t,
    baseRadius,
    rest: restOf(categorizer, derived.features, options),
    distance: fitDistance(categorizer, derived.features, options),
    temperature: Math.max(LIVE_DEFAULTS.minRadius, LIVE_DEFAULTS.softness * meanRadius),
    // A mirrored categorizer reads each frame on the side nearer its categories (#382).
    project: createReader(modality, { hand: categorizer.hand ?? 'either', mirror: categorizer.mirror === true }, reading),
    inView: (vector) => inView(modality, vector, derived.features),
  };
}

/** The live vector the model classifies: distance taken out, then sensitivity applied. */
export function tuneVector(live: LiveModel, vector: FeatureVector): FeatureVector {
  const { model, tuning, rest, distance } = live;
  const out: FeatureVector = { ...vector };
  if (tuning.distance > 0 && distance.learned && distance.proxy) {
    const p = vector[distance.proxy];
    if (Number.isFinite(p) && p > 0) {
      const dz = Math.log(p) - distance.reference;
      for (const f of model.features) {
        const x = out[f];
        const b = distance.slopes[f];
        if (Number.isFinite(x) && b !== undefined) out[f] = x - tuning.distance * b * dz;
      }
    }
  }
  if (tuning.sensitivity !== 1 && rest) {
    for (const f of model.features) {
      const x = out[f];
      const r = rest[f];
      if (Number.isFinite(x) && Number.isFinite(r)) out[f] = r + tuning.sensitivity * (x - r);
    }
  }
  return out;
}

/** One live reading, for the readout. */
export interface LiveReading {
  /** The category the tracker has settled on (hysteresis), or null: none of these / not yet. */
  categoryId: string | null;
  label: string | null;
  /** This frame is beyond the reject radius of every category. */
  rejected: boolean;
  /** This frame is nearest the taught Neutral class (#385 E5): none of these, by example. */
  neutral: boolean;
  /** The taught Neutral class's share of this frame's memberships (0 without one). */
  neutralMembership: number;
  /** This frame's soft memberships, in the categorizer's order. */
  memberships: readonly { id: string; label: string; value: number }[];
  /** This frame's distance to the nearest category (noise units). */
  distance: number;
  /** The tuned reject radius, or null when strangers read as the nearest face. */
  radius: number | null;
  /** How deep inside its nearest category (or Neutral) this frame is, against the runner-up and
   *  the reject radius: the margin meter (#385 E6). Per frame, before the hysteresis. */
  margin: LiveMargin;
}

export interface LiveReader {
  readonly live: LiveModel;
  push(vector: FeatureVector): LiveReading;
  reset(): void;
}

/** A reader over a live model: tune each frame, classify it, settle it with hysteresis. */
export function createLiveReader(live: LiveModel): LiveReader {
  const tracker: CategoryTracker = createCategoryTracker(live.model, {
    temperature: live.temperature,
    enterFrames: LIVE_DEFAULTS.enterFrames,
    exitFrames: LIVE_DEFAULTS.exitFrames,
    holdOnReject: false,
  });
  const labels = new Map(live.model.categories.map((c) => [c.id, c.label]));
  const radius = live.model.rejectRadius >= NO_REJECT_RADIUS ? null : live.model.rejectRadius;
  return {
    live,
    push(vector) {
      const tuned = tuneVector(live, vector);
      const r = tracker.push(tuned);
      // Neutral once the tracker has settled on it (while it is entering, the held category is
      // still the reading, and the readout must not say both).
      const neutral = r.neutral === true && r.categoryId === null;
      const rejected = !neutral && radius !== null && r.distance > radius;
      return {
        categoryId: r.categoryId,
        label: r.categoryId ? (labels.get(r.categoryId) ?? null) : null,
        rejected,
        neutral,
        neutralMembership: r.neutralMembership ?? 0,
        memberships: live.model.categories.map((c) => ({ id: c.id, label: c.label, value: r.memberships[c.id] ?? 0 })),
        distance: r.distance,
        radius,
        margin: liveMargin(live.model, tuned, { noRejectRadius: NO_REJECT_RADIUS }),
      };
    },
    reset: () => tracker.reset(),
  };
}
