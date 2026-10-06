/**
 * An enrolled shape vocabulary (#249) — the player's OWN names for the shapes they make,
 * and the classifier trained from them.
 *
 * Why enrolment and not a shared model: `docs/research/air-instruments.md` §6.3-6.4. A
 * guitar chord is not a hand shape: players finger the same chord differently (the
 * three- and four-finger G), so a model trained on other players' hands scored 24%
 * across players, while two seconds of a player's own hand per chord gave 90 to 98%.
 * So each air instrument that reads a shape (the guitar's chords now, the flute's
 * fingerings next) asks the player to hold each shape they want, names it, and learns
 * from that.
 *
 * The data model follows the zodal rule, affordances first. The SAMPLES are the SSOT (a
 * record per instrument: labelled entries of feature vectors, and the feature ids they
 * were taken with); the model is DERIVED from them by {@link trainVocabulary}, never
 * stored, so a change to the training rule applies to every saved vocabulary on the next
 * load, and there is no model format to migrate.
 *
 * Training is the trainer's core (`packages/sdk/src/enroll/classify.ts`: one category per enrolled
 * entry, CLOSED-SET: every frame is its nearest entry, as the research measured), with distances measured
 * in the player's OWN hold jitter: each feature is weighted by the inverse of its pooled
 * within-shape spread, the trainer's noise-unit idea (`packages/sdk/src/enroll/noise.ts`) with the
 * enrolment itself as the demonstration of noise. A feature that wobbles while a shape
 * is held counts for little; one that is steady within a shape and differs between
 * shapes decides.
 */
import { z } from 'zod';
import { trainModel, weightedDistance, type FeatureVector, type TrainedModel } from '@thoremin/sdk/enroll';

/** One enrolled shape: the player's name for it and the vectors captured while held. */
export const VocabularyEntrySchema = z.object({
  label: z.string().trim().min(1),
  samples: z.array(z.record(z.string(), z.number())),
});
export type VocabularyEntry = z.infer<typeof VocabularyEntrySchema>;

/** A vocabulary: its entries, and the feature ids the samples carry (in order). */
export const VocabularySchema = z.object({
  features: z.array(z.string()),
  entries: z.array(VocabularyEntrySchema),
});
export type Vocabulary = z.infer<typeof VocabularySchema>;

export const emptyVocabulary = (features: readonly string[]): Vocabulary => ({ features: [...features], entries: [] });

/** The fewest samples an entry needs before it takes part in the model. */
export const MIN_SAMPLES_PER_ENTRY = 5;
/** The most samples kept per entry (evenly thinned beyond it): a two-second hold at 30 fps
 *  is about 60, and localStorage is shared, so a vocabulary stays small. */
export const MAX_SAMPLES_PER_ENTRY = 40;
/** Decimal places a stored feature keeps: far below any hand's jitter, and a stored chord
 *  is a fraction of the size at full double precision. */
const STORED_DECIMALS = 4;
/** A floor on a feature's spread, as a fraction of its range across all samples, so one
 *  perfectly still feature cannot dominate every distance. */
const SPREAD_FLOOR_FRACTION = 0.05;
/** The absolute floor when a feature has no range at all. */
const SPREAD_FLOOR_ABS = 1e-3;

const finite = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Per-feature weights: 1 / the pooled within-entry standard deviation (floored). Distances
 * under these weights are in multiples of the player's own hold jitter.
 */
export function jitterWeights(entries: readonly VocabularyEntry[], features: readonly string[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const f of features) {
    let ss = 0;
    let dof = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of entries) {
      const xs = e.samples.map((s) => s[f]).filter(finite);
      if (xs.length === 0) continue;
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      for (const x of xs) {
        ss += (x - mean) ** 2;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      dof += xs.length - 1;
    }
    const sd = dof > 0 ? Math.sqrt(ss / dof) : 0;
    const range = Number.isFinite(hi - lo) ? hi - lo : 0;
    weights[f] = 1 / Math.max(sd, SPREAD_FLOOR_FRACTION * range, SPREAD_FLOOR_ABS);
  }
  return weights;
}

/**
 * The classifier for a vocabulary: one category per entry with enough samples, labelled
 * with the entry's name. Null when fewer than one entry is usable (nothing to play).
 * Features that are non-finite in every sample are dropped.
 */
export interface TrainVocabularyOptions {
  /**
   * Open-set instead of closed-set: a vector farther from every entry than this many
   * times the enrolment's own reach (the trainer's 90th-percentile rule) is no entry at
   * all. For a GATE (the flute's blowing/resting mouth), where "neither" must read as
   * "not blowing"; generous, because a state re-made later wanders further than one
   * back-to-back take (the guitar's lesson). Absent: closed-set.
   */
  rejectScale?: number;
}

export function trainVocabulary(vocab: Vocabulary, options: TrainVocabularyOptions = {}): TrainedModel | null {
  const usable = vocab.entries.filter((e) => e.samples.length >= MIN_SAMPLES_PER_ENTRY);
  if (usable.length === 0) return null;
  const features = vocab.features.filter((f) => usable.some((e) => e.samples.some((s) => finite(s[f]))));
  if (features.length === 0) return null;
  const vectors: FeatureVector[] = [];
  const clusters: number[][] = [];
  for (const e of usable) {
    const idx: number[] = [];
    for (const s of e.samples) {
      idx.push(vectors.length);
      vectors.push(s);
    }
    clusters.push(idx);
  }
  // CLOSED-SET, as the research measured it (`scripts/air/lib_chord_shape_model.ts`: the
  // 90-98% is with no reject). trainModel's default reject radius (the 90th percentile of
  // the enrolment's own distances) is set from one back-to-back take, which underrates
  // how much a shape varies when it is re-made later: on real footage it rejected 29-56%
  // of later frames, and since the tracker HOLDS through a reject, its only effect was
  // to keep the old chord when the player changed shape (a quarter to a third of chord
  // changes missed). Every frame is therefore the NEAREST enrolled chord.
  const open = options.rejectScale !== undefined;
  const model = trainModel(vectors, clusters, features, jitterWeights(usable, features), open ? {} : { defaultRejectRadius: Infinity });
  if (open) model.rejectRadius *= options.rejectScale!;
  // trainModel numbers categories by cluster; carry each entry's name onto its category.
  model.categories.forEach((c, i) => (c.label = usable[i].label));
  return model;
}

/** A sample with its non-finite features dropped: a feature the tracker could not measure
 *  in that frame is absent, which the distance already treats as "no evidence" (and JSON
 *  would turn a NaN into a null that no longer parses as a number). */
function finiteOnly(v: FeatureVector): Record<string, number> {
  const out: Record<string, number> = {};
  const scale = 10 ** STORED_DECIMALS;
  for (const [k, x] of Object.entries(v)) if (finite(x)) out[k] = Math.round(x * scale) / scale;
  return out;
}

/** At most `max` samples, evenly spaced through the take (the whole hold is kept in
 *  proportion, not just its start). */
function thin<T>(xs: readonly T[], max: number): T[] {
  if (xs.length <= max) return [...xs];
  return Array.from({ length: max }, (_, i) => xs[Math.floor((i * xs.length) / max)]);
}

/** Replace (or add) the entry named `label`, keeping entry order; names match exactly. */
export function withEntry(vocab: Vocabulary, label: string, samples: readonly FeatureVector[]): Vocabulary {
  const entry = { label: label.trim(), samples: thin(samples, MAX_SAMPLES_PER_ENTRY).map(finiteOnly) };
  const i = vocab.entries.findIndex((e) => e.label === entry.label);
  const entries = i < 0 ? [...vocab.entries, entry] : vocab.entries.map((e, j) => (j === i ? entry : e));
  return { ...vocab, entries };
}

/**
 * How distinct each enrolled entry is: the distance from its centroid to the NEAREST other
 * entry's centroid, in units of its own spread (its radius). Below about 2 the two shapes
 * are close enough to flip between each other in play, which the enrolment UI says.
 */
export function separation(model: TrainedModel): { label: string; nearest: string; ratio: number }[] {
  return model.categories.map((c) => {
    let best = Infinity;
    let nearest = '';
    for (const o of model.categories) {
      if (o === c) continue;
      const d = weightedDistance(c.centroid, o.centroid, model.features, model.weights);
      if (d < best) {
        best = d;
        nearest = o.label;
      }
    }
    return { label: c.label, nearest, ratio: best / Math.max(c.radius, 1e-9) };
  });
}

/** Remove the entry named `label`. */
export function withoutEntry(vocab: Vocabulary, label: string): Vocabulary {
  return { ...vocab, entries: vocab.entries.filter((e) => e.label !== label) };
}
