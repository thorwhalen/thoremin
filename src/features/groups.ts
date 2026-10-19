/**
 * The feature groups by source (face, body, hands), whether a live feature demand wants one, and
 * the gate the feature-vector nodes share (#600 S16a: split from the Lab's config, which becomes an
 * extension's, so the derivation, the hand count and the nodes read only the demand).
 */
import type { DemandedGroups } from '@thoremin/sdk/features/demand';
import { DERIVED_GROUP, FEATURE_GROUPS } from '@thoremin/sdk/features/catalog';

/**
 * The feature groups sourced from the FACE. `DERIVED_GROUP` is excluded even though
 * the catalog files it under `source: 'face'` — a derived formula may reference only
 * hand features, so it is not on its own evidence that the face model is wanted.
 */
export const FACE_GROUP_IDS: readonly string[] = FEATURE_GROUPS.filter(
  (g) => g.source === 'face' && g.id !== DERIVED_GROUP,
).map((g) => g.id);

/**
 * Does a live feature DEMAND (#163) need the face model loaded? The trainer claims
 * face groups while a cue runs; without this the vector node would be computing from a
 * face frame that is never produced, because the model gate only knew about the Lab
 * and the sound mapping.
 */
export function demandWantsFace(demanded: DemandedGroups): boolean {
  if (!demanded) return false;
  for (const g of demanded) if (FACE_GROUP_IDS.includes(g)) return true;
  return false;
}

/**
 * The feature groups sourced from the BODY (#186), same exclusion as the face set.
 * Empty until the body catalog lands; the gates below are then already correct.
 */
export const BODY_GROUP_IDS: readonly string[] = FEATURE_GROUPS.filter(
  (g) => g.source === 'body' && g.id !== DERIVED_GROUP,
).map((g) => g.id);

/** Does a live feature DEMAND (#163) need the body model loaded? */
export function demandWantsBody(demanded: DemandedGroups): boolean {
  if (!demanded) return false;
  for (const g of demanded) if (BODY_GROUP_IDS.includes(g)) return true;
  return false;
}

/**
 * The feature groups sourced from the HANDS, plus the derived formulas (which may read a
 * hand feature): what the Lab and a demand claim read from the hand model (#325).
 */
export const HAND_GROUP_IDS: readonly string[] = FEATURE_GROUPS.filter((g) => g.source === 'hand' || g.id === DERIVED_GROUP).map((g) => g.id);

/** Does a live feature DEMAND (#163) claim a hand group? */
export function demandWantsHands(demanded: DemandedGroups): boolean {
  if (!demanded) return false;
  for (const g of demanded) if (HAND_GROUP_IDS.includes(g)) return true;
  return false;
}

/** The feature-vector nodes' gate (in the SDK since #600 S17b, for the body slice's vector node). */
export { resolveFeatureGate } from '@thoremin/sdk/features/feature_gate';
