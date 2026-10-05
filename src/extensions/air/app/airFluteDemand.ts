/**
 * The air flute claims the mouth (#249), the `bodyRouteDemand` pattern.
 *
 * The flute's breath is the player's enrolled blowing mouth, read from the face catalog's
 * mouth, jaw and lip features. The face model runs, and `face-feature-vector` computes a
 * group, only when something claims it; in production the Lab is closed. So while the
 * flute is on in the `mouth` breath mode, its mouth groups are claimed (which also loads
 * the face model); when it is off, or breathing is `always`, the claim is released and
 * the model can idle again.
 */
import type { FeatureDemand } from '@thoremin/sdk/features/demand';
import { MOUTH_GROUPS, type AirFluteDialParams } from '@/extensions/air/nodes/air_flute';
import { appFeatureDemand } from '@/app/featureDemand';
import { useControls } from '@/app/store';

export const AIR_FLUTE_DEMAND_OWNER = 'air-flute';

/** The groups the flute needs, or [] when it needs none. */
export function airFluteGroups(flute: Partial<AirFluteDialParams> | undefined): string[] {
  return flute?.enabled === true && (flute.breath ?? 'mouth') === 'mouth' ? [...MOUTH_GROUPS] : [];
}

type FluteState = { airFlute?: Partial<AirFluteDialParams> };

/** Keep the demand in step with the `airFlute` dial. Returns the unsubscribe. */
export function startAirFluteDemand(
  store: { getState(): FluteState; subscribe(listener: (s: FluteState) => void): () => void } = useControls,
  demand: FeatureDemand = appFeatureDemand,
): () => void {
  let last = '';
  const apply = (s: FluteState) => {
    const groups = airFluteGroups(s.airFlute);
    const key = groups.join('|');
    if (key === last) return;
    last = key;
    if (groups.length) demand.claim(AIR_FLUTE_DEMAND_OWNER, groups);
    else demand.release(AIR_FLUTE_DEMAND_OWNER);
  };
  apply(store.getState());
  const unsubscribe = store.subscribe(apply);
  return () => {
    unsubscribe();
    demand.release(AIR_FLUTE_DEMAND_OWNER);
  };
}
