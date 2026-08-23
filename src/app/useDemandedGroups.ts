/**
 * `useDemandedGroups` — the live feature demand (#163) as a React value.
 *
 * Kept apart from `featureDemand.ts` so that module stays React-free (it is in the
 * strict DAG typecheck, and the repo ships no `@types/react`). The FaceChip uses this
 * to report the face model running for a trainer cue the same way it does for the Lab.
 */
import { useSyncExternalStore } from 'react';
import type { DemandedGroups } from '@/features/demand';
import { appFeatureDemand, featureDemandResource } from './featureDemand';

export function useDemandedGroups(): DemandedGroups {
  return useSyncExternalStore(appFeatureDemand.subscribe, featureDemandResource, featureDemandResource);
}
