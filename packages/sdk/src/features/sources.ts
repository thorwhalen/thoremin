/**
 * The feature groups by the model that measures them (face, body, hands), and whether a live
 * feature demand wants one (#600 S16b: from core's Lab config, so a slice and core share them).
 * `DERIVED_GROUP` (the Lab's formulas) has no catalog features: it counts as a hand group (a
 * formula may read a hand feature), never as evidence that the face or the body model is wanted.
 */
import type { DemandedGroups } from './demand';
import { DERIVED_GROUP, FEATURE_GROUPS } from './catalog';

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
