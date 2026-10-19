/**
 * The carve modalities by id (#385 E8): the one place a stored `modality` (a categorizer file's,
 * a bound set's `read`) is turned back into the object that reads it, so a host that plays a
 * categorizer (the category dispatcher) reads the live vector as the tool that carved it did.
 */
import type { CarveModality } from '../../enroll/modality';
import { bodyModality } from './body';
import { faceModality } from './face';
import { handModality } from './hand';

export const CARVE_MODALITIES: Readonly<Record<string, CarveModality>> = {
  [faceModality.id]: faceModality,
  [handModality.id]: handModality,
  [bodyModality.id]: bodyModality,
};

/** Add the modalities an extension list contributes (#600 S11: the contribution registry's call,
 *  once, when it folds the build's list). The same modality again is a no-op; a different one
 *  under a taken id is an error. */
export function registerCarveModalities(modalities: readonly CarveModality[]): void {
  const table = CARVE_MODALITIES as Record<string, CarveModality>;
  for (const m of modalities) {
    if (table[m.id] === undefined) table[m.id] = m;
    else if (table[m.id] !== m) throw new Error(`carve modality "${m.id}" is registered twice, differently`);
  }
}

/** The modality stored as `id`, or undefined for one this build does not know. */
export function modalityById(id: string | undefined): CarveModality | undefined {
  return id !== undefined && Object.hasOwn(CARVE_MODALITIES, id) ? CARVE_MODALITIES[id] : undefined;
}
