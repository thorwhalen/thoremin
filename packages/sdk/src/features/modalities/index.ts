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

/** The modality stored as `id`, or undefined for one this build does not know. */
export function modalityById(id: string | undefined): CarveModality | undefined {
  return id !== undefined && Object.hasOwn(CARVE_MODALITIES, id) ? CARVE_MODALITIES[id] : undefined;
}
