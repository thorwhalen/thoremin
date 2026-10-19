/**
 * The gate the feature-vector nodes share (#600 S16a; in the SDK since S17b, where the body slice's
 * vector node reaches it): whether a vector node computes at all, and which groups, from the live
 * feature demand. Core's `src/features/groups.ts` re-exports it.
 */
import type { DemandedGroups } from './demand';

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
