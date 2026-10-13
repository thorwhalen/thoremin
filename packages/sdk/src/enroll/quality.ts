/**
 * How good a carve is, per category and per hold, and what to do about it (#385 E6, design C.4.7
 * and C.4.8): the numbers behind Sorting's quality chips, its suspect marks and its hints, and
 * behind Trying's margin meter.
 *
 * Players who carve their own categories rarely think about how distinct they are unless told
 * (MAGIC's consistency and distinctness views; the teaching-guidance studies), so the tool says
 * it, per category, in three measures that are cheap at a carve's size (tens to a few hundred
 * holds, a dozen categories):
 *
 * - **Separation**: the distance from a category's centre to the nearest other centre, in units
 *   of its own spread (ext-air's `separation`). Below {@link QUALITY_DEFAULTS.closeRatio} (2) two
 *   faces are close enough to flip between each other in play. The taught Neutral class (E5) is a
 *   neighbour like any other: a face close to Neutral falls silent in play.
 * - **Leave-one-hold-out**: each hold against its category's centre WITHOUT it (a hold always
 *   pulls its own centre toward itself) and every other centre. A hold nearer another category is
 *   **suspect** ("looks more like smile"); the share of a category's holds that are not is its
 *   leave-one-out accuracy, and where the misses go is the pair it leaks to. This is the
 *   simplified (centroid) silhouette, `(b - a) / max(a, b)`, linear in the holds where the
 *   pairwise one is quadratic; clearly negative ({@link QUALITY_DEFAULTS.suspectBelow}) is suspect.
 * - **Holds**: one hold is no spread and no evidence: "needs another hold".
 *
 * A hint names what separates a close pair, in the modality's words (`CarveModality.describe`,
 * so hands and body say theirs): the features ranked by their centre difference in noise units,
 * folded by movement (one opening mouth is six face features), signed, with the instruction that
 * makes the category further from its neighbour. Never a face to imitate (the trainer's rule).
 *
 * Pure and modality-free: models and vectors in, numbers and words out. Every distance is the
 * model's weighted one, so every number is in noise units.
 */
import { NEUTRAL_BIN } from './categorizer';
import { weightedDistance } from './cluster';
import { scaledDistance } from './classify';
import type { FeatureWords } from './modality';
import type { Category, FeatureVector, TrainedModel } from './types';

/** The neighbour a category or hold can be close to besides another category: the taught Neutral. */
export const NEUTRAL_TARGET = NEUTRAL_BIN;

export const QUALITY_DEFAULTS = {
  /** Separation below this is CLOSE (ext-air's `CLOSE_RATIO`): the two flip in play. */
  closeRatio: 2,
  /** Separation below this is only OK. */
  okRatio: 3,
  /** A category leaking more than this share of its holds is CLOSE whatever its separation. */
  closeLeak: 1 / 3,
  /** The fewest holds tested before the leak alone can make a category CLOSE (with two, one
   *  hold nearer a neighbour is a 50 % "leak" that says little). */
  minLeakHolds: 3,
  /** Fewer holds than this: "needs another hold". */
  minHolds: 2,
  /** A hold is suspect only when CLEARLY nearer elsewhere: its silhouette below this. A hold on
   *  the boundary (silhouette near 0) would otherwise flip with the jitter of a replay. */
  suspectBelow: -0.1,
  /** The most movements a hint names. */
  hintMovements: 2,
  /** A further movement is named only if at least this share of the first: a hint that adds
   *  the noise to the difference teaches the wrong thing. */
  hintShare: 0.5,
  /** A margin (`(d2 - d1) / (d2 + d1)`) below this is "on the edge". */
  edgeMargin: 0.15,
} as const;

export type QualityOptions = Partial<typeof QUALITY_DEFAULTS>;

/** A chip's grade, best last. `thin`: too few holds to say. */
export type QualityGrade = 'thin' | 'close' | 'ok' | 'distinct';

export interface CategoryQuality {
  id: string;
  size: number;
  /** The nearest other category's id, {@link NEUTRAL_TARGET}, or null when it has no neighbour. */
  nearest: string | null;
  /** Centre to the nearest neighbour's centre (noise units). */
  distance: number;
  /** Its own spread: the mean distance of its holds from its centre (noise units). */
  spread: number;
  /** `distance / spread`: Infinity for a category with no spread or no neighbour. */
  ratio: number;
  /** The share of its holds nearer their own (leave-one-out) centre than any other: null below
   *  two holds. */
  looAccuracy: number | null;
  /** Where most of its misplaced holds go (a category id or {@link NEUTRAL_TARGET}), or null. */
  leaksTo: string | null;
  grade: QualityGrade;
  /** One to three: the chip's dots. */
  dots: 1 | 2 | 3;
  /** The neighbour a hint should be about (the leak if any, else the nearest), when CLOSE. */
  closeTo: string | null;
}

/** A hold nearer another category (or Neutral) than its own: "looks more like X". */
export interface SuspectHold {
  /** Index into the vectors the model was trained from. */
  index: number;
  /** Where it is: a category id, or {@link NEUTRAL_TARGET} for a Neutral hold. */
  from: string;
  /** Where it looks like it belongs. */
  nearer: string;
  /** Its (centroid) silhouette: negative. */
  silhouette: number;
}

export interface CarveQuality {
  categories: CategoryQuality[];
  /** Ordered most suspect first. */
  suspects: SuspectHold[];
}

interface Target {
  id: string;
  centroid: FeatureVector;
}

/** Per-feature sums and counts of a set of holds: a centre with any one hold left out is O(F). */
function sums(vectors: readonly FeatureVector[], members: readonly number[], features: readonly string[]): { sum: Float64Array; n: Float64Array } {
  const sum = new Float64Array(features.length);
  const n = new Float64Array(features.length);
  for (const j of members) {
    const v = vectors[j];
    features.forEach((f, k) => {
      const x = v?.[f];
      if (Number.isFinite(x)) {
        sum[k] += x;
        n[k] += 1;
      }
    });
  }
  return { sum, n };
}

/** The centre of a set of holds with hold `x` left out (a feature nobody else measured reads 0,
 *  as `trainModel`'s mean does). */
function without(acc: { sum: Float64Array; n: Float64Array }, x: FeatureVector, features: readonly string[]): FeatureVector {
  const out: FeatureVector = {};
  features.forEach((f, k) => {
    const v = x[f];
    const has = Number.isFinite(v);
    const n = acc.n[k] - (has ? 1 : 0);
    out[f] = n > 0 ? (acc.sum[k] - (has ? v : 0)) / n : 0;
  });
  return out;
}

/** The nearest of `targets` to `x`, skipping `skip`; Infinity when there is none. */
function nearestOf(model: TrainedModel, x: FeatureVector, targets: readonly Target[], skip: string): { id: string | null; d: number } {
  let id: string | null = null;
  let d = Infinity;
  for (const t of targets) {
    if (t.id === skip) continue;
    const e = weightedDistance(x, t.centroid, model.features, model.weights);
    if (e < d) {
      d = e;
      id = t.id;
    }
  }
  return { id, d };
}

/** The centre of `of` nearest `x`, or null when there is none. */
function nearestCentre(model: TrainedModel, x: FeatureVector, of: readonly Pick<Category, 'centroid'>[]): FeatureVector | null {
  let best: FeatureVector | null = null;
  let d = Infinity;
  for (const c of of) {
    const e = weightedDistance(x, c.centroid, model.features, model.weights);
    if (e < d) {
      d = e;
      best = c.centroid;
    }
  }
  return best;
}

/** The Neutral prototypes as one neighbour: its centre is whichever prototype is nearest. */
function neutralTargets(model: TrainedModel): Target[] {
  return (model.neutral ?? []).map((p) => ({ id: NEUTRAL_TARGET, centroid: p.centroid }));
}

/**
 * The quality of a carve: a chip per category and the suspect holds. `vectors` is the pool the
 * model's `members` index (a categorizer's samples, in order).
 */
export function carveQuality(model: TrainedModel, vectors: readonly FeatureVector[], options: QualityOptions = {}): CarveQuality {
  const o = { ...QUALITY_DEFAULTS, ...options };
  const { features } = model;
  const cats: Target[] = model.categories.map((c) => ({ id: c.id, centroid: c.centroid }));
  const neutral = neutralTargets(model);
  const targets = [...cats, ...neutral];
  const suspects: SuspectHold[] = [];

  // Every hold against its own centre without it, and every other neighbour.
  const holdsOf = (owner: string, groups: readonly Pick<Category, 'members'>[], skip: string): { misses: Map<string, number>; tested: number } => {
    const misses = new Map<string, number>();
    let tested = 0;
    for (const g of groups) {
      if (g.members.length < 2) continue;
      const acc = sums(vectors, g.members, features);
      for (const j of g.members) {
        const x = vectors[j];
        if (!x) continue;
        tested += 1;
        const a = weightedDistance(x, without(acc, x, features), features, model.weights);
        const b = nearestOf(model, x, targets, skip);
        if (b.id === null) continue;
        const s = (b.d - a) / Math.max(a, b.d, 1e-12);
        if (s < o.suspectBelow) {
          suspects.push({ index: j, from: owner, nearer: b.id, silhouette: s });
          misses.set(b.id, (misses.get(b.id) ?? 0) + 1);
        }
      }
    }
    return { misses, tested };
  };

  const categories = model.categories.map((c): CategoryQuality => {
    const near = nearestOf(model, c.centroid, targets, c.id);
    const spread = c.radius;
    const ratio = near.id === null || !(spread > 0) ? Infinity : near.d / spread;
    const { misses, tested } = holdsOf(c.id, [c], c.id);
    const missed = [...misses.values()].reduce((a, b) => a + b, 0);
    const looAccuracy = tested === 0 ? null : (tested - missed) / tested;
    const leaksTo = [...misses.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
    const leak = tested < o.minLeakHolds ? 0 : missed / tested;
    const grade: QualityGrade =
      c.size < o.minHolds ? 'thin' : ratio < o.closeRatio || leak > o.closeLeak ? 'close' : ratio < o.okRatio || missed > 0 ? 'ok' : 'distinct';
    const dots = grade === 'distinct' ? 3 : grade === 'ok' ? 2 : 1;
    const closeTo = grade === 'close' ? (leak > o.closeLeak && leaksTo ? leaksTo : near.id) : null;
    return { id: c.id, size: c.size, nearest: near.id, distance: near.d, spread, ratio, looAccuracy, leaksTo, grade, dots, closeTo };
  });
  // The Neutral holds too: one nearer a category than every Neutral prototype will not stay silent.
  if (model.neutral && model.neutral.length > 0) holdsOf(NEUTRAL_TARGET, model.neutral, NEUTRAL_TARGET);
  suspects.sort((a, b) => a.silhouette - b.silhouette || a.index - b.index);
  return { categories, suspects };
}

/** One movement that separates two centres. */
export interface MovementDifference {
  /** The movement's key (a feature id when the modality has no words for it). */
  movement: string;
  name: string;
  /** The difference, first centre minus second, in noise units, signed by the MOVEMENT (an
   *  inverted feature's sign flipped): positive = the first has more of it. */
  delta: number;
  /** What makes the first further from the second: its `more` when delta > 0, else its `less`. */
  instruction: string;
  /** The feature that carried it (the largest of the movement's). */
  feature: string;
}

/**
 * What separates centre `a` from centre `b`, in movements, largest first: per feature the weighted
 * difference (noise units), folded by the modality's movement (the largest feature of each).
 */
export function distinguishingMovements(
  model: Pick<TrainedModel, 'features' | 'weights'>,
  a: FeatureVector,
  b: FeatureVector,
  describe: (featureId: string) => FeatureWords | undefined,
): MovementDifference[] {
  const best = new Map<string, MovementDifference>();
  for (const f of model.features) {
    const w = Object.hasOwn(model.weights, f) ? model.weights[f] : 1;
    const x = a[f];
    const y = b[f];
    if (w === 0 || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const words = describe(f);
    // A signed feature's movement is its size: on one side of 0, the larger size has more of it;
    // on opposite sides, `a` going further its own way moves it away from `b`.
    const raw = words?.signed ? (Math.sign(x) === Math.sign(y) ? Math.abs(x) - Math.abs(y) : Math.abs(x - y)) * w : (x - y) * w;
    const delta = words?.invert ? -raw : raw;
    const movement = words ? (words.movement ?? words.name) : f;
    const cur = best.get(movement);
    if (cur && Math.abs(cur.delta) >= Math.abs(delta)) continue;
    const name = words?.name ?? f;
    const instruction = words ? (delta > 0 ? words.more : words.less) : `${delta > 0 ? 'more' : 'less'} ${f}`;
    best.set(movement, { movement, name, delta, instruction, feature: f });
  }
  return [...best.values()].sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta) || (p.movement < q.movement ? -1 : 1));
}

/** A hint for a CLOSE category: what separates it from its neighbour, in words. */
export interface QualityHint {
  category: string;
  /** The neighbour: a category id or {@link NEUTRAL_TARGET}. */
  other: string;
  movements: MovementDifference[];
  /** The hint in plain words. */
  text: string;
}

const signed = (x: number): string => `${x > 0 ? '+' : x < 0 ? '-' : ''}${Math.abs(x).toFixed(1)}`;

/**
 * The hint for category `id` against `other` (a category id or {@link NEUTRAL_TARGET}, whose
 * centre is the Neutral prototype nearest the category's): the top movements and the instruction
 * that moves the category away. `label` names a category for the text; null when either is gone.
 */
export function qualityHint(
  model: TrainedModel,
  id: string,
  other: string,
  {
    describe,
    label,
    neutralName = 'your Neutral faces',
    movements = QUALITY_DEFAULTS.hintMovements,
    share = QUALITY_DEFAULTS.hintShare,
  }: {
    describe: (featureId: string) => FeatureWords | undefined;
    label: (categoryId: string) => string;
    /** How the text names the Neutral neighbour (the modality's words). */
    neutralName?: string;
    movements?: number;
    share?: number;
  },
): QualityHint | null {
  const self = model.categories.find((c) => c.id === id);
  if (!self) return null;
  const centre = other === NEUTRAL_TARGET ? nearestCentre(model, self.centroid, model.neutral ?? []) : (model.categories.find((c) => c.id === other)?.centroid ?? null);
  if (!centre) return null;
  const ranked = distinguishingMovements(model, self.centroid, centre, describe);
  const top = ranked.slice(0, Math.max(1, movements)).filter((m, i) => i === 0 || Math.abs(m.delta) >= share * Math.abs(ranked[0].delta));
  if (top.length === 0) return null;
  const me = `"${label(id)}"`;
  const them = other === NEUTRAL_TARGET ? neutralName : `"${label(other)}"`;
  const differ = top.map((m) => `${m.name} (${signed(m.delta)})`).join(' and ');
  const merge = other === NEUTRAL_TARGET ? '' : ', or merge them';
  const text = `${me} is close to ${them}. They differ mostly in ${differ}. To tell them apart, ${top[0].instruction} for ${me}${merge}.`;
  return { category: id, other, movements: top, text };
}

/** How deep inside its reading a live vector is (Trying's margin meter, design C.3.3). */
export interface LiveMargin {
  /** The nearest category id or {@link NEUTRAL_TARGET}; null with no categories. */
  nearest: string | null;
  /** The runner-up; null with fewer than two neighbours. */
  second: string | null;
  d1: number;
  d2: number;
  /** `(d2 - d1) / (d2 + d1)`: 0 on the boundary, 1 on the centre. */
  margin: number;
  /** `d1 / rejectRadius` (only for a category, and only when strangers read as Neutral): past 1
   *  the face is none of these. Null otherwise. */
  reach: number | null;
  /** How deep inside, 0..1: the margin, or less when the reject radius is nearer than the
   *  runner-up (`1 - reach`). */
  depth: number;
  /** `inside` (safely), `edge`, or `outside` every category (beyond the reject radius). */
  state: 'inside' | 'edge' | 'outside';
  /** On the edge, of what: the runner-up (`second`) or the reject radius (`radius`); else null. */
  edgeOf: 'second' | 'radius' | null;
}

/** The live margin of one (tuned) vector against a model, with Neutral as one neighbour. */
export function liveMargin(
  model: TrainedModel,
  vector: FeatureVector,
  { edgeMargin = QUALITY_DEFAULTS.edgeMargin, noRejectRadius = Number.MAX_VALUE }: { edgeMargin?: number; noRejectRadius?: number } = {},
): LiveMargin {
  // Per neighbour, its nearest centre (Neutral's prototypes are one neighbour).
  const near = new Map<string, number>();
  const see = (id: string, centroid: FeatureVector, scale?: number) => {
    const d = scaledDistance({ scale }, weightedDistance(vector, centroid, model.features, model.weights));
    if (d < (near.get(id) ?? Infinity)) near.set(id, d);
  };
  for (const c of model.categories) see(c.id, c.centroid, c.scale);
  for (const p of model.neutral ?? []) see(NEUTRAL_TARGET, p.centroid);
  const ranked = [...near.entries()].sort((a, b) => a[1] - b[1]);
  const [first, runner] = ranked;
  if (!first) return { nearest: null, second: null, d1: Infinity, d2: Infinity, margin: 0, reach: null, depth: 0, state: 'outside', edgeOf: null };
  const d1 = first[1];
  const d2 = runner?.[1] ?? Infinity;
  const margin = Number.isFinite(d2) ? (d2 - d1) / Math.max(d2 + d1, 1e-12) : 1;
  const radius = model.rejectRadius;
  const reach = first[0] !== NEUTRAL_TARGET && radius < noRejectRadius && radius > 0 ? d1 / radius : null;
  // The classifier rejects strictly past the radius (`classify`): 1 - reach is how far is left.
  const room = reach === null ? Infinity : 1 - reach;
  const depth = Math.max(0, Math.min(margin, room));
  const state = reach !== null && reach > 1 ? 'outside' : depth < edgeMargin ? 'edge' : 'inside';
  const edgeOf = state !== 'edge' ? null : room < margin ? 'radius' : 'second';
  return { nearest: first[0], second: runner?.[0] ?? null, d1, d2, margin, reach, depth, state, edgeOf };
}
