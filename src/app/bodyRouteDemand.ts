/**
 * The body routes claim the feature groups they read (#186 PR E).
 *
 * `body-feature-vector` computes only the groups something claims — the Lab's
 * ticked groups, or a feature DEMAND (#163) — and in production the Lab is closed
 * by default. Without this claim a configured body route would be fed an empty
 * vector every tick and do nothing, with every unit test green: the exact failure
 * `src/features/demand.ts` was created to end for the trainer. So the routes are a
 * demand owner like the trainer is: whenever the `bodyMap` dial has a live route,
 * the groups its features belong to are claimed; when the last route is cleared,
 * the claim is released and the model can idle again.
 *
 * Pure derivation (`bodyRouteGroups`) + one subscription (`startBodyRouteDemand`),
 * started from the app shell.
 */
import type { BodyMap } from '@/nodes/mapping/body_map';
import { BODY_ROUTE_SLOTS } from '@/nodes/mapping/body_map';
import { FEATURE_BY_ID } from '@/features/catalog';
import type { FeatureDemand } from '@/features/demand';
import { appFeatureDemand } from './featureDemand';
import { useControls } from './store';

export const BODY_ROUTE_DEMAND_OWNER = 'body-route';

/** The catalog groups the map's live routes read (sorted, unique), or [] when none. */
export function bodyRouteGroups(map: BodyMap | undefined): string[] {
  if (!map) return [];
  const groups = new Set<string>();
  for (const slot of BODY_ROUTE_SLOTS) {
    const r = map.routes[slot];
    if (!r || r.target === 'none' || !r.feature) continue;
    const group = FEATURE_BY_ID[r.feature]?.group;
    if (group) groups.add(group);
  }
  return [...groups].sort();
}

/**
 * Keep the demand in step with the `bodyMap` dial. Returns the unsubscribe. Injectable
 * store + demand so a test can drive it without the app singletons.
 */
export function startBodyRouteDemand(
  store: { getState(): { bodyMap?: BodyMap }; subscribe(listener: (s: { bodyMap?: BodyMap }) => void): () => void } = useControls,
  demand: FeatureDemand = appFeatureDemand,
): () => void {
  let last = '';
  const apply = (s: { bodyMap?: BodyMap }) => {
    const groups = bodyRouteGroups(s.bodyMap);
    const key = groups.join('|');
    if (key === last) return;
    last = key;
    if (groups.length) demand.claim(BODY_ROUTE_DEMAND_OWNER, groups);
    else demand.release(BODY_ROUTE_DEMAND_OWNER);
  };
  apply(store.getState());
  const unsubscribe = store.subscribe(apply);
  return () => {
    unsubscribe();
    demand.release(BODY_ROUTE_DEMAND_OWNER);
  };
}
