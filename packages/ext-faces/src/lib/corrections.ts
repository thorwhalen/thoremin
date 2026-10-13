/**
 * Correcting a saved face categorizer (#330 P3), purely: the edits a player makes after testing
 * it live. Each edit changes the categorizer's SAMPLES or which category claims them (the source
 * of truth, P1's file); the live model is then derived again by `modelFromCategorizer`, the
 * same `trainModel` the session carves with. So a correction is a retrain, cheap enough to run
 * on every click, and an exported file carries the corrections as evidence, not as a patched
 * centroid.
 *
 * - {@link addSample}: "this face is X". The live face (the raw vector, never the tuned one: the
 *   tuning is about the room, the sample is about the face) joins category X.
 * - {@link moveSample}: a sample in the wrong category moves to another, or out of every
 *   category (`null`). A category keeps at least one face: moving its last one away is refused
 *   (an empty category would have no centroid).
 *
 * Retraining from new faces in bulk is P1's `mergeSession` (a new take merged in); the store
 * calls it directly.
 */
import { PersonalCategorizerSchema, toSample, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/** The cue a sample added from the live readout carries. */
export const CORRECTION_CUE = 'faces-correction';

export type CorrectionResult = { ok: true; categorizer: PersonalCategorizer } | { ok: false; error: string };

const named = (c: PersonalCategorizer, id: string) => c.categories.find((x) => x.id === id);

/** Add a live face to category `id` as a new sample. */
export function addSample(categorizer: PersonalCategorizer, id: string, vector: FeatureVector, { t = 0, cue = CORRECTION_CUE }: { t?: number; cue?: string } = {}): CorrectionResult {
  if (!named(categorizer, id)) return { ok: false, error: `no category "${id}"` };
  const sample = toSample({ vector, t, cue });
  if (!categorizer.features.some((f) => Number.isFinite(sample.vector[f]))) return { ok: false, error: 'no face in view' };
  const index = categorizer.samples.length;
  return {
    ok: true,
    categorizer: PersonalCategorizerSchema.parse({
      ...categorizer,
      samples: [...categorizer.samples, sample],
      categories: categorizer.categories.map((c) => (c.id === id ? { ...c, members: [...c.members, index] } : c)),
    }),
  };
}

/** Move sample `index` to category `to` (or out of every category with `null`). */
export function moveSample(categorizer: PersonalCategorizer, index: number, to: string | null): CorrectionResult {
  if (!Number.isInteger(index) || index < 0 || index >= categorizer.samples.length) return { ok: false, error: `no sample ${index}` };
  if (to !== null && !named(categorizer, to)) return { ok: false, error: `no category "${to}"` };
  const from = categorizer.categories.find((c) => c.members.includes(index));
  if (from?.id === to || (!from && to === null)) return { ok: true, categorizer };
  if (from && from.members.length === 1) return { ok: false, error: `"${from.label || from.id}" would be left with no face; a category keeps at least one` };
  return {
    ok: true,
    categorizer: PersonalCategorizerSchema.parse({
      ...categorizer,
      categories: categorizer.categories.map((c) =>
        c.id === to ? { ...c, members: [...c.members, index].sort((a, b) => a - b) } : c.id === from?.id ? { ...c, members: c.members.filter((j) => j !== index) } : c,
      ),
    }),
  };
}

/** The category that claims sample `index`, or null. */
export const categoryOf = (categorizer: PersonalCategorizer, index: number): string | null => categorizer.categories.find((c) => c.members.includes(index))?.id ?? null;
