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
 *   category (`null`: neutral, or set aside when strangers read as the nearest category). A
 *   category keeps at least one face: moving its last one away is refused (merge it instead).
 *
 * Both are the player's placements, so both are PINS (#385 E4): a re-cut keeps them where they
 * were put. The rest of the sorting edits (several holds at once, merge, split, delete) are the
 * SDK's `enroll/sorting`.
 *
 * Retraining from new faces in bulk is P1's `mergeSession` (a new take merged in); the store
 * calls it directly.
 */
import {
  ASIDE_BIN,
  MAX_CATEGORIZER_SAMPLES,
  NEUTRAL_BIN,
  PersonalCategorizerSchema,
  toSample,
  type PersonalCategorizer,
} from '@thoremin/sdk/enroll/categorizer';
import { moveHolds } from '@thoremin/sdk/enroll/sorting';
import type { CarveModality } from '@thoremin/sdk/enroll/modality';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { faceModality } from '@thoremin/sdk/features/modalities/face';

/** The cue a sample added from the live readout carries: `faces-correction` for the face. */
export const correctionCue = (modality: Pick<CarveModality, 'words'>): string => `${modality.words.slug}-correction`;
export const CORRECTION_CUE = correctionCue(faceModality);

export type CorrectionResult = { ok: true; categorizer: PersonalCategorizer } | { ok: false; error: string };

const named = (c: PersonalCategorizer, id: string) => c.categories.find((x) => x.id === id);

/** Add a live face (or the modality's part) to category `id` as a new sample, under the new
 *  sample's own `sampleId` (#385 E3: unique, so it never takes another hold's still). */
export function addSample(
  categorizer: PersonalCategorizer,
  id: string,
  vector: FeatureVector,
  { sampleId, t = 0, modality = faceModality, cue = correctionCue(modality) }: { sampleId: string; t?: number; cue?: string; modality?: CarveModality },
): CorrectionResult {
  if (!named(categorizer, id)) return { ok: false, error: `no category "${id}"` };
  // The import bound, kept here too: a categorizer grown past it could not be read back
  // from its own exported file.
  if (categorizer.samples.length >= MAX_CATEGORIZER_SAMPLES) {
    return { ok: false, error: `this categorizer is full (${MAX_CATEGORIZER_SAMPLES} ${modality.words.many}); no more can be added` };
  }
  if (categorizer.samples.some((s) => s.id === sampleId)) return { ok: false, error: `sample id "${sampleId}" is taken` };
  const sample = toSample({ id: sampleId, vector, t, cue });
  if (!categorizer.features.some((f) => Number.isFinite(sample.vector[f]))) return { ok: false, error: `no ${modality.words.one} in view` };
  return {
    ok: true,
    categorizer: PersonalCategorizerSchema.parse({
      ...categorizer,
      samples: [...categorizer.samples, sample],
      categories: categorizer.categories.map((c) => (c.id === id ? { ...c, members: [...c.members, sampleId] } : c)),
      // "This face is X" is the player's placement: a pin (#385 E4).
      pins: { ...(categorizer.pins ?? {}), [sampleId]: id },
    }),
  };
}

/**
 * Move sample `index` to category `to`, or out of every category with `null`: into `neutral`
 * when strangers read as neutral (it is "none of these"), else set aside (kept, not trained).
 * A pin, as every move (#385 E4: `moveHolds`), so a re-cut keeps it there.
 */
export function moveSample(categorizer: PersonalCategorizer, index: number, to: string | null): CorrectionResult {
  if (!Number.isInteger(index) || index < 0 || index >= categorizer.samples.length) return { ok: false, error: `no sample ${index}` };
  if (to !== null && !named(categorizer, to)) return { ok: false, error: `no category "${to}"` };
  const id = categorizer.samples[index].id;
  const from = categorizer.categories.find((c) => c.members.includes(id));
  if (from?.id === to || (!from && to === null)) return { ok: true, categorizer };
  return moveHolds(categorizer, [id], to ?? (categorizer.strangers === 'neutral' ? NEUTRAL_BIN : ASIDE_BIN));
}

/** The category that claims sample `index`, or null. */
export const categoryOf = (categorizer: PersonalCategorizer, index: number): string | null => {
  const id = categorizer.samples[index]?.id;
  return id === undefined ? null : (categorizer.categories.find((c) => c.members.includes(id))?.id ?? null);
};
