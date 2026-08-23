/**
 * The trainer session (#160, reworked for #163) — the take, and the model built from it.
 *
 * This is the one stateful object a host holds. It owns the per-cue capture (a
 * still-point sampler for vocabulary cues, raw accumulation for the baseline and
 * nuisance cues), the session-wide noise estimator every distance is measured in, and
 * turns the accumulated take into a {@link TrainedModel} on demand.
 *
 * **`retrain(k)` is deliberately cheap and repeatable.** It re-cuts the already-built
 * hierarchy — it does not recluster. That is what makes "specify the number of
 * categories before *or afterwards*" real: the player drags a slider from 3 to 6 to 4
 * and each move is a tree cut over the same recording, not a retrain. `build()` (the
 * expensive part) happens once when the take finishes.
 *
 * ## Keyed by cue, not by step
 *
 * v1 had four hardcoded steps. Now a session holds samples per CUE id, and the cue's
 * `produces` says what they are for: `baseline` frames set the reject radius,
 * `nuisance` frames set the down-weighting, and the still-points of EVERY `vocabulary`
 * cue — "look left" and "your faces" alike — form one pool the hierarchy is built over.
 * Each still-point remembers its cue, so a category can report which cues fed it (a
 * free label suggestion: a category that is 90% "look left" points is probably that).
 *
 * ## Units (#163)
 *
 * The live vector is raw catalog output in mixed units. Every distance here is taken
 * in NOISE UNITS — a feature's displacement divided by its own jitter, estimated over
 * the whole take by one shared {@link NoiseEstimator} — by folding `1/sigma` into the
 * model's weights. Centroids stay raw, so classifying a live raw vector needs no
 * transform and the model stays self-contained. See `noise.ts`.
 *
 * Nothing here touches React, the DAG, MediaPipe or audio. The host pushes feature
 * vectors in and reads a model out.
 */
import { ALL_FEATURES, FEATURE_BY_ID } from '@/features/catalog';
import { buildHierarchy, cutAt, suggestK, type Hierarchy } from './cluster';
import { trainModel } from './classify';
import { cueFeatures, routineFeatures, samplingFor, type Cue } from './cue';
import {
  combineWeights,
  nuisanceProfile,
  rankFeatures,
  selectByInvariance,
  weightsFromNuisance,
  weightsFromSelection,
} from './invariance';
import { applyWeights, createNoiseEstimator, scaleWeights, type NoiseEstimator, type NoiseOptions } from './noise';
import { createStillPointSampler, type SamplerOptions, type StillPointSampler } from './sampler';
import type { FeatureVector, FeatureWeights, StillPoint, TrainedModel } from './types';

export interface SessionOptions {
  /** Cap on how many features the model uses. See `rankFeatures` for why a cap exists. */
  maxFeatures?: number;
  /** Honour declared `invariantTo` (#131) in addition to the demonstrated nuisance. */
  useDeclaredInvariance?: boolean;
  /** Passed through to every still-point sampler (dwell, held threshold, …). */
  sampler?: Omit<SamplerOptions, 'cue' | 'features' | 'noise'>;
  /** The noise estimator's options. */
  noise?: NoiseOptions;
  /**
   * Nuisance weighting scale, in noise units: the demonstrated spread at which a
   * feature is considered fully nuisance-driven. A feature that swings this many
   * sigma while nothing should have changed is badly confounded.
   */
  nuisanceScale?: number;
  /**
   * Resolves a feature id to its group — how a cue's `collects.groups` becomes a list
   * of ids. Defaults to the catalog; inject a toy registry in tests.
   */
  groupOf?: (id: string) => string | undefined;
  /** The feature ids a cue's groups are resolved against. Defaults to the catalog. */
  allFeatureIds?: readonly string[];
}

export interface Session {
  /** Start capturing for `cue`. Re-running a cue discards only that cue's samples. */
  beginCue(cue: Cue): void;
  /** Feed a live feature vector. Every frame feeds the noise estimate; the active
   *  cue (if any) samples it. */
  push(vector: FeatureVector, tMs: number): void;
  /** Finish the active cue. */
  endCue(): void;
  /** The active cue, or null. */
  activeCue(): Cue | null;
  /** Still-points captured for a cue. */
  pointsFor(cueId: string): StillPoint[];
  /** Every still-point, across all vocabulary cues. */
  points(): StillPoint[];
  /** Frames captured for a continuous cue (those carrying >= 1 attention feature). */
  framesFor(cueId: string): number;
  /** A cue's resolved attention features. */
  featuresFor(cue: Cue): string[];
  /** Mean of the baseline cue's frames, if one has been captured. */
  baseline(): FeatureVector | undefined;
  /** Whether the player has MOVED since the active cue began (the sampler crossed its
   *  held threshold at least once). False for continuous cues and when idle. */
  moved(): boolean;
  /** Whether the vector is currently held (the active sampler is in a dwell). */
  settling(): boolean;
  /** True once `build()` has run over the CURRENT pool (re-running a cue invalidates it). */
  built(): boolean;
  /** The session's noise unit for a feature (NaN if unseen). */
  sigma(id: string): number;
  /** The shared estimator (for a meter / a test). */
  noise(): NoiseEstimator;
  /** Whether there is anything to build a model from. */
  ready(): boolean;
  /** Build the hierarchy from the vocabulary pool. Call once when the take finishes. */
  build(): void;
  /** The k the merge-gap heuristic suggests. A SUGGESTION — see `suggestK`. */
  suggestedK(): number;
  /** Re-cut the built hierarchy into `k` categories and return the model. Cheap. */
  retrain(k: number): TrainedModel;
  /**
   * The model for an ARBITRARY partition of the pool (arrays of indices into
   * {@link Session.points}) — what a player's own labelling in the projection view
   * produces. `retrain(k)` is this over `cutAt(hierarchy, k)`; both use the same
   * features, weights and baseline, so a hand-drawn category and an automatic one are
   * the same kind of thing. Centroids are computed in FULL feature space from the raw
   * vectors — never from a 2-D layout.
   */
  modelFor(clusters: readonly (readonly number[])[]): TrainedModel;
  /** The features the model is using, best-first. */
  features(): string[];
  /** The weights distances are measured under (noise scale x nuisance). */
  weights(): FeatureWeights;
  reset(): void;
}

const DEFAULTS = { maxFeatures: 24, useDeclaredInvariance: false, nuisanceScale: 4 };

// The only place this module touches the catalog: resolving a cue's groups to ids.
const defaultGroupOf = (id: string): string | undefined => FEATURE_BY_ID[id]?.group;
const defaultFeatureIds = (): readonly string[] => ALL_FEATURES.map((f) => f.id);

/** Mean of `vectors` over the union of their finite keys. */
function meanOf(vectors: readonly FeatureVector[]): FeatureVector | undefined {
  if (vectors.length === 0) return undefined;
  const sum: Record<string, number> = {};
  const n: Record<string, number> = {};
  for (const v of vectors) {
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (!Number.isFinite(x)) continue;
      sum[k] = (sum[k] ?? 0) + x;
      n[k] = (n[k] ?? 0) + 1;
    }
  }
  const out: FeatureVector = {};
  for (const k of Object.keys(sum)) out[k] = sum[k] / n[k];
  return out;
}

export function createSession(options: SessionOptions = {}): Session {
  const o = { ...DEFAULTS, ...options };
  const noise = createNoiseEstimator(o.noise);
  const groupOf = o.groupOf ?? defaultGroupOf;
  const allIds = o.allFeatureIds ?? defaultFeatureIds();

  /** Still-points per vocabulary cue. */
  const points = new Map<string, StillPoint[]>();
  /** Raw frames per continuous cue. */
  const frames = new Map<string, FeatureVector[]>();
  /** Every cue that has run, by id (for `produces` / `axes` at build time). */
  const cuesSeen = new Map<string, Cue>();

  let active: Cue | null = null;
  let activeFeatures: string[] = [];
  let sampler: StillPointSampler | null = null;
  /** The last frame the active cue sampled. */
  let lastInCue: { v: FeatureVector; t: number } | null = null;
  /**
   * Between cues, an IDLE sampler keeps judging motion at the usual 100 ms scale (fed by
   * the frames the runner pushes during the beat), seeded with the last frame of the
   * cue that ended. Whether it saw a move decides whether the next cue starts ARMED:
   * "moved since your last answer" must be judged the way every other move is, not by
   * comparing one frame against a seed a second and a half old (ordinary slow wander
   * exceeds a 100 ms threshold over that span).
   */
  let idle: StillPointSampler | null = null;
  let lastIdle: { v: FeatureVector; t: number } | null = null;

  let hierarchy: Hierarchy = { heights: [], size: 0 };
  let chosenFeatures: string[] = [];
  let chosenWeights: FeatureWeights = {};

  const featuresFor = (cue: Cue): string[] => cueFeatures(cue, allIds, groupOf);
  const vocabulary = (): StillPoint[] => {
    const out: StillPoint[] = [];
    for (const cue of cuesSeen.values()) {
      if (cue.produces !== 'vocabulary') continue;
      out.push(...(points.get(cue.id) ?? []));
    }
    return out;
  };
  const framesWhere = (produces: Cue['produces']): FeatureVector[] => {
    const out: FeatureVector[] = [];
    for (const cue of cuesSeen.values()) {
      if (cue.produces !== produces) continue;
      out.push(...(frames.get(cue.id) ?? []));
    }
    return out;
  };

  return {
    beginCue(cue) {
      active = cue;
      cuesSeen.set(cue.id, cue);
      activeFeatures = featuresFor(cue);
      points.delete(cue.id);
      frames.delete(cue.id);
      // The pool is about to change: a hierarchy built over the old one would index
      // the wrong points. Build again when the take is finished.
      hierarchy = { heights: [], size: 0 };
      chosenFeatures = [];
      chosenWeights = {};
      // What the beat told us, read before it is forgotten.
      const movedDuringBeat = idle?.hasMoved() ?? false;
      const seed = lastIdle ?? lastInCue;
      idle = null;
      lastIdle = null;
      if (samplingFor(cue) === 'still-points') {
        // Disarmed unless the player already moved during the beat: the pose held while
        // this instruction is given is the PREVIOUS one (rest, or the last cue's answer),
        // and the first point must follow a movement. The seed is the LATEST frame seen.
        sampler = createStillPointSampler({
          armed: movedDuringBeat,
          ...o.sampler,
          cue: cue.id,
          features: activeFeatures,
          noise,
          ...(seed ? { seed } : {}),
        });
        points.set(cue.id, []);
      } else {
        sampler = null;
        frames.set(cue.id, []);
      }
    },

    push(vector, tMs) {
      noise.push(vector, tMs);
      if (!active) {
        idle?.push(vector, tMs);
        lastIdle = { v: vector, t: tMs };
        return;
      }
      // A frame with none of the cue's features is not a sample of this cue (no face in
      // shot, say) — it must not count toward "enough".
      if (!activeFeatures.some((id) => Number.isFinite(vector[id]))) return;
      lastInCue = { v: vector, t: tMs };
      if (sampler) {
        const p = sampler.push(vector, tMs);
        if (p) points.get(active.id)!.push(p);
      } else {
        frames.get(active.id)!.push(vector);
      }
    },

    endCue() {
      // Keep judging motion through the beat (over every feature present), from where
      // the player was when this cue ended.
      idle = createStillPointSampler({ ...o.sampler, noise, ...(lastInCue ? { seed: lastInCue } : {}) });
      lastIdle = null;
      active = null;
      sampler = null;
      activeFeatures = [];
    },

    activeCue: () => active,
    pointsFor: (id) => (points.get(id) ?? []).slice(),
    points: vocabulary,
    framesFor: (id) => frames.get(id)?.length ?? 0,
    featuresFor,
    baseline: () => meanOf(framesWhere('baseline')),
    moved: () => sampler?.hasMoved() ?? false,
    settling: () => sampler?.isSettling() ?? false,
    built: () => hierarchy.size > 0 && hierarchy.size === vocabulary().length,
    sigma: (id) => noise.sigma(id),
    noise: () => noise,
    ready: () => vocabulary().length >= 2,

    build() {
      // The take is the routine's feature set — the union of its cues' attention sets,
      // `omit` applied. The live vector carries more than that (every feature of a
      // demanded group, and whatever else the Lab had on), and none of it may be
      // weighted, ranked or clustered: a chair shift is not an expression.
      const recorded = new Set(routineFeatures([...cuesSeen.values()], allIds, groupOf));
      const project = (v: FeatureVector): FeatureVector => {
        const out: FeatureVector = {};
        for (const k of Object.keys(v)) if (recorded.has(k)) out[k] = v[k];
        return out;
      };
      const vocab = vocabulary().map((p) => project(p.vector));
      if (vocab.length === 0) {
        hierarchy = { heights: [], size: 0 };
        chosenFeatures = [];
        chosenWeights = {};
        return;
      }

      // 1. Units: 1/sigma per feature, so every distance below is in noise units.
      //    (Restricted to the recorded set: an unrecorded key must not even carry a
      //    weight, so `weights()` reports exactly what the model can use.)
      const scale = Object.fromEntries(
        Object.entries(scaleWeights(noise.snapshot())).filter(([k]) => recorded.has(k)),
      );

      // 2. Demonstrated invariance: what moved (in noise units) while nothing should
      //    have. One profile per nuisance cue, multiplied together.
      let weights = scale;
      for (const cue of cuesSeen.values()) {
        if (cue.produces !== 'nuisance') continue;
        const scaled = (frames.get(cue.id) ?? []).map((v) => applyWeights(project(v), scale));
        const profile = nuisanceProfile(scaled, cue.collects.axes);
        weights = combineWeights(weights, weightsFromNuisance(profile, { scale: o.nuisanceScale }));
      }

      // 3. Declared invariance (#131), optional and OFF by default: it silences every
      //    feature that has not been assessed, which is most of the catalog, so turning
      //    it on without saying so would quietly shrink the model.
      // (Reads the real catalog's `invariantTo` regardless of the injected registry — the
      //  declarations live nowhere else. Off by default; with a toy registry every id is
      //  simply "unassessed" and kept.)
      if (o.useDeclaredInvariance) {
        const axes = [...new Set([...cuesSeen.values()].flatMap((c) => c.collects.axes))];
        const all = Object.keys(vocab[0] ?? {});
        const sel = selectByInvariance(axes, all);
        weights = combineWeights(weights, weightsFromSelection([...sel.keep, ...sel.unassessed], all));
      }

      // 4. Rank by signal-to-noise after weighting and keep the top slice.
      chosenFeatures = rankFeatures(vocab, weights, o.maxFeatures);
      chosenWeights = weights;
      hierarchy = buildHierarchy(vocab, chosenFeatures, weights);
    },

    suggestedK: () => suggestK(hierarchy),

    retrain(k) {
      return this.modelFor(cutAt(hierarchy, k));
    },

    modelFor(clusters) {
      if (!this.built()) throw new Error('session: build() over the current take before retrain() / modelFor()');
      const pool = vocabulary();
      const vocab = pool.map((p) => p.vector);
      const model = trainModel(vocab, clusters, chosenFeatures, chosenWeights, {
        restVectors: framesWhere('baseline'),
      });
      // Which cues fed each category — a label suggestion the host may offer.
      for (const cat of model.categories) {
        const cues: Record<string, number> = {};
        for (const j of cat.members) {
          const id = pool[j]?.cue;
          if (id !== undefined) cues[id] = (cues[id] ?? 0) + 1;
        }
        cat.cues = cues;
      }
      return model;
    },

    features: () => chosenFeatures.slice(),
    weights: () => ({ ...chosenWeights }),

    reset() {
      points.clear();
      frames.clear();
      cuesSeen.clear();
      noise.reset();
      active = null;
      activeFeatures = [];
      sampler = null;
      lastInCue = null;
      idle = null;
      lastIdle = null;
      hierarchy = { heights: [], size: 0 };
      chosenFeatures = [];
      chosenWeights = {};
    },
  };
}
