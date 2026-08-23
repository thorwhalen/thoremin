/**
 * The app's feature-demand registry (#163) — the one instance the engine serves.
 *
 * `useEngine` installs {@link featureDemandResource} as `ctx.resources.featureDemand`,
 * and any host-side consumer that needs feature groups computed while the Lab is
 * closed claims them here (the trainer, while a cue runs). See `@/features/demand` for
 * the contract and the bug it closes.
 *
 * A module-level instance rather than a store: it is read synchronously per tick, and
 * written a handful of times per session.
 */
import { createFeatureDemand, type DemandedGroups } from '@/features/demand';

export const appFeatureDemand = createFeatureDemand();

/** The per-tick read the vector nodes perform — installed on the engine's resources. */
export function featureDemandResource(): DemandedGroups {
  return appFeatureDemand.groups();
}
