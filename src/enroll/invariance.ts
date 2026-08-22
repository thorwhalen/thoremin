/**
 * Feature conditioning (#160 / #131) — deciding what "shouldn't matter" and acting on it.
 *
 * The maintainer's question was *"ways to specify some sensitivity and insensitivities —
 * for example, whether how close the face is shouldn't matter or not."* There are two
 * usable answers and this module implements both, because they fail in different places.
 *
 * ## Level 1 — declared invariance (consumes what #131 already shipped)
 *
 * `src/features/types.ts` already defines the vocabulary (`scale` = camera distance,
 * `position`, `yaw`/`pitch`/`roll`) and every catalog feature can declare `invariantTo`,
 * with deliberate three-state semantics: **absent = not assessed**, `[]` = assessed and
 * invariant to nothing, a listed axis = moving along it should not move this feature.
 *
 * Until now nothing consumed any of it. {@link selectByInvariance} does: ask for
 * invariance to `scale` and it keeps the features that declare it, drops the ones that
 * declare otherwise, and — this is the part that matters — reports the **unassessed**
 * ones separately instead of silently guessing. A feature with no claim is not evidence
 * of safety, and folding it into either bucket would either discard good features or
 * quietly admit confounded ones.
 *
 * ## Level 2 — demonstrated invariance (the elegant one)
 *
 * Let the player *show* the nuisance: "hold any one face and move closer, then further
 * away." Every frame of that clip should ideally be the same point in feature space, so
 * whatever moved is nuisance, and {@link weightsFromNuisance} down-weights it in
 * proportion.
 *
 * This is the contrastive-learning idea (positive pairs under a transformation that
 * should not change the representation) reduced to the smallest thing that works: a
 * per-dimension inverse-spread weight. No network, no training loop, and it generalises
 * to **any** nuisance the player can perform, including ones nobody enumerated. It also
 * matches the interaction model the rest of this feature uses: you teach it by doing it.
 *
 * It is not free of assumptions — it treats the axes as independent, so it cannot undo a
 * nuisance that lives in a *rotation* of feature space rather than along its axes. That
 * is the honest limit, and the reason level 1 stays worth having.
 *
 * ## Why this is not measured as a number for the player
 *
 * There is **no consensus in the literature on how to measure** a representation's
 * invariance to a nuisance factor. So the host should SHOW the effect (a meter that
 * stays flat while the player moves closer) rather than claim a percentage.
 */
import { ALL_FEATURES, FEATURE_BY_ID } from '@/features/catalog';
import type { Invariance } from '@/features/types';
import type { FeatureVector, FeatureWeights, NuisanceProfile } from './types';

/** What a declared-invariance selection concluded, split three ways on purpose. */
export interface InvarianceSelection {
  /** Features that declare invariance to every requested axis. */
  keep: string[];
  /** Features assessed as NOT invariant to at least one requested axis. */
  drop: string[];
  /**
   * Features with no `invariantTo` declaration at all. Neither kept nor dropped — the
   * caller decides, and the UI should say how many there are. "Not assessed" is a
   * different fact from "not invariant" and collapsing them loses the distinction #131
   * deliberately encoded.
   */
  unassessed: string[];
}

/**
 * Split the catalog's features by whether they declare invariance to every axis in
 * `axes`. With no axes requested everything is kept — asking for nothing excludes
 * nothing.
 */
export function selectByInvariance(
  axes: readonly Invariance[],
  featureIds?: readonly string[],
): InvarianceSelection {
  const ids = featureIds ?? ALL_FEATURES.map((f) => f.id);
  const keep: string[] = [];
  const drop: string[] = [];
  const unassessed: string[] = [];
  for (const id of ids) {
    if (axes.length === 0) {
      keep.push(id);
      continue;
    }
    const declared = FEATURE_BY_ID[id]?.invariantTo;
    if (declared === undefined) unassessed.push(id);
    else if (axes.every((a) => declared.includes(a))) keep.push(id);
    else drop.push(id);
  }
  return { keep, drop, unassessed };
}

/**
 * Build a nuisance profile from the frames of a nuisance demonstration: the per-feature
 * standard deviation across a clip in which the player held one pose and varied
 * something that should not count.
 */
export function nuisanceProfile(
  vectors: readonly FeatureVector[],
  axes: readonly Invariance[] = [],
): NuisanceProfile {
  const spread: Record<string, number> = {};
  if (vectors.length === 0) return { spread, axes, samples: 0 };
  const keys = new Set<string>();
  for (const v of vectors) for (const k of Object.keys(v)) keys.add(k);
  for (const k of keys) {
    let n = 0;
    let mean = 0;
    let m2 = 0;
    for (const v of vectors) {
      const x = v[k];
      if (!Number.isFinite(x)) continue;
      n += 1;
      const delta = x - mean;
      mean += delta / n;
      m2 += delta * (x - mean);
    }
    spread[k] = n > 1 ? Math.sqrt(m2 / (n - 1)) : 0;
  }
  return { spread, axes, samples: vectors.length };
}

export interface WeightOptions {
  /**
   * Spread at which a feature is considered fully nuisance-driven (weight → `floor`).
   * Features are normalized to roughly 0..1, so a std of 0.25 across a clip in which
   * nothing should have changed is already a badly confounded channel.
   */
  scale?: number;
  /** Lower bound on any weight — never delete a feature outright, only quiet it. */
  floor?: number;
  /** A profile built from fewer samples than this is ignored (returns all-1 weights). */
  minSamples?: number;
}

const WEIGHT_DEFAULTS = { scale: 0.25, floor: 0.05, minSamples: 15 };

/**
 * Turn a nuisance profile into per-feature weights: `1 / (1 + spread/scale)`, floored.
 *
 * Smooth rather than a hard cutoff, so a feature that is *slightly* confounded is
 * *slightly* quieted instead of falling off a cliff at an arbitrary threshold. Floored
 * rather than zeroed because a confounded feature is still a feature — down-weighting is
 * reversible by the player, deletion is not.
 *
 * A profile built from too few samples returns all-1 weights: three frames of someone
 * leaning in is not evidence, and acting on it would be worse than doing nothing.
 */
export function weightsFromNuisance(
  profile: NuisanceProfile,
  options: WeightOptions = {},
): FeatureWeights {
  const o = { ...WEIGHT_DEFAULTS, ...options };
  const weights: FeatureWeights = {};
  if (profile.samples < o.minSamples) {
    for (const k of Object.keys(profile.spread)) weights[k] = 1;
    return weights;
  }
  for (const [k, s] of Object.entries(profile.spread)) {
    const w = 1 / (1 + Math.max(0, s) / o.scale);
    weights[k] = Math.max(o.floor, w);
  }
  return weights;
}

/** Multiply two weight maps (declared selection × demonstrated spread, say). */
export function combineWeights(...maps: readonly FeatureWeights[]): FeatureWeights {
  const out: FeatureWeights = {};
  for (const m of maps) for (const k of Object.keys(m)) out[k] = (out[k] ?? 1) * m[k];
  return out;
}

/** Weights that zero everything outside `keep` — the declared-selection half as weights. */
export function weightsFromSelection(keep: readonly string[], all: readonly string[]): FeatureWeights {
  const set = new Set(keep);
  const out: FeatureWeights = {};
  for (const id of all) out[id] = set.has(id) ? 1 : 0;
  return out;
}

/**
 * The features a trainer should actually use, ranked most- to least-informative for the
 * *signal* (highest spread across the vocabulary take) after nuisance down-weighting.
 *
 * The point of ranking: a 200-dimension distance in which 190 dimensions are noise is a
 * worse classifier than a 10-dimension one, and the player cannot be asked to pick.
 */
export function rankFeatures(
  vectors: readonly FeatureVector[],
  weights: FeatureWeights,
  limit = 24,
): string[] {
  const signal = nuisanceProfile(vectors).spread;
  return Object.keys(signal)
    .map((id) => ({ id, score: signal[id] * (weights[id] ?? 1) }))
    .filter((x) => Number.isFinite(x.score) && x.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((x) => x.id);
}
