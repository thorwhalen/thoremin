/**
 * The Feature Lab as a feature-demand claimer (#600 S16a): while its meters are shown, the Lab
 * claims the groups it shows on the app's feature-demand registry (#163), as the Trainer does for a
 * running cue. So the derivation (a claimed group implies its source branch), the hand count and the
 * feature-vector gates read ONE thing, the demand, and never the Lab's config: what lets the Lab
 * become an extension's (S16b) without core naming its pref.
 */
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import type { FeatureDemand } from '@thoremin/sdk/features/demand';
import type { FeatureLabConfig } from '@/features/labConfig';
import { useControls } from './store';

/** The Lab's owner name on the demand registry. */
export const LAB_DEMAND_OWNER = 'lab';

/** What the Lab claims: its groups while its meters are shown, nothing otherwise. */
export function labDemandGroups(cfg: Pick<FeatureLabConfig, 'show' | 'groups'> | undefined): readonly string[] {
  return cfg?.show ? cfg.groups : [];
}

/** Keep the Lab's claim in step with its config, now and on every change; returns the uninstall
 *  (which releases the claim). */
export function installLabDemand(
  read: () => Pick<FeatureLabConfig, 'show' | 'groups'> | undefined = () => useControls.getState().featureLab,
  subscribe: (listener: () => void) => () => void = useControls.subscribe,
  demand: Pick<FeatureDemand, 'claim' | 'release'> = appFeatureDemand,
): () => void {
  let last: string | null = null;
  const sync = (): void => {
    const groups = labDemandGroups(read());
    const key = groups.join('|');
    if (key === last) return;
    last = key;
    if (groups.length) demand.claim(LAB_DEMAND_OWNER, groups);
    else demand.release(LAB_DEMAND_OWNER);
  };
  sync();
  const unsubscribe = subscribe(sync);
  return () => {
    unsubscribe();
    demand.release(LAB_DEMAND_OWNER);
  };
}
