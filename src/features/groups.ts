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

/**
 * The feature-vector nodes' gate: are we computing at all, and which groups?
 *
 * Shared by the face, hand and body vector nodes: they each carried their own copy once, and when
 * #136 moved the Lab's config off `overlay` every copy kept reading the old path and the gate failed
 * OPEN: every player evaluated the whole catalog every frame with the Lab switched off. One copy.
 *
 * Headless (no host: `controls` absent, a test or a replay) the node is active with its params'
 * groups (all, without any) and whatever is demanded. With a host, it is active only for what a live feature DEMAND claims (#163,
 * `@thoremin/sdk/features/demand`): the Trainer's running cue, a bound categorizer, the open Lab's
 * shown groups (it claims them, #600 S16a). Nothing claimed, nothing computed: the gate fails
 * CLOSED, so a host with no Lab at all (core alone) never runs the catalog.
 */
export function resolveFeatureGate(
  params: { groups?: string[] },
  controls: unknown,
  demanded: DemandedGroups = null,
): { active: boolean; enabled: (group: string) => boolean } {
  const demand = demanded && demanded.size > 0 ? demanded : null;
  if (controls === undefined || controls === null) {
    const set = params.groups ? new Set(params.groups) : null;
    return { active: true, enabled: (group: string) => (set ? set.has(group) : true) || (demand !== null && demand.has(group)) };
  }
  return { active: demand !== null, enabled: (group: string) => demand !== null && demand.has(group) };
}
