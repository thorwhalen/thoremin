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
 * Training is the trainer's core (`src/enroll/classify.ts`: one category per enrolled
 * entry, a reject radius that accepts the player's own samples), with distances measured
 * in the player's OWN hold jitter: each feature is weighted by the inverse of its pooled
 * within-shape spread, the trainer's noise-unit idea (`src/enroll/noise.ts`) with the
 * enrolment itself as the demonstration of noise. A feature that wobbles while a shape
 * is held counts for little; one that is steady within a shape and differs between
 * shapes decides.
 */
import { z } from 'zod';
import { trainModel, type FeatureVector, type TrainedModel } from '@/enroll';

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
export function trainVocabulary(vocab: Vocabulary): TrainedModel | null {
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
  const model = trainModel(vectors, clusters, features, jitterWeights(usable, features));
  // trainModel numbers categories by cluster; carry each entry's name onto its category.
  model.categories.forEach((c, i) => (c.label = usable[i].label));
  return model;
}

/** A sample with its non-finite features dropped: a feature the tracker could not measure
 *  in that frame is absent, which the distance already treats as "no evidence" (and JSON
 *  would turn a NaN into a null that no longer parses as a number). */
function finiteOnly(v: FeatureVector): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v)) if (finite(x)) out[k] = x;
  return out;
}

/** Replace (or add) the entry named `label`, keeping entry order; names match exactly. */
export function withEntry(vocab: Vocabulary, label: string, samples: readonly FeatureVector[]): Vocabulary {
  const entry = { label: label.trim(), samples: samples.map(finiteOnly) };
  const i = vocab.entries.findIndex((e) => e.label === entry.label);
  const entries = i < 0 ? [...vocab.entries, entry] : vocab.entries.map((e, j) => (j === i ? entry : e));
  return { ...vocab, entries };
}

/** Remove the entry named `label`. */
export function withoutEntry(vocab: Vocabulary, label: string): Vocabulary {
  return { ...vocab, entries: vocab.entries.filter((e) => e.label !== label) };
}
