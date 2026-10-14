/**
 * Installs the conductor timing host (#427, `commands/conductorLeadHost.ts`): the finished
 * take in `useLeadCalibration`, the kept offsets in the hot store's `conductorPrefs`.
 *
 * Keep MERGES: a joint the take measured gets its new offset, a joint it did not keeps the
 * one it had (a take in which the trunk was too uneven must not wipe a trunk offset an
 * earlier take measured). A take that measured nothing has nothing to keep.
 */
import { provideConductorLeadHost } from '@/app/commands/conductorLeadHost';
import { useControls } from './store';
import { useLeadCalibration } from './conductorLead';

provideConductorLeadHost({
  pending: () => useLeadCalibration.getState().result?.offsets ?? null,
  keep: () => {
    const result = useLeadCalibration.getState().result;
    if (!result || !Object.keys(result.offsets).length) return null;
    const merged = { ...useControls.getState().conductorPrefs.leadOffsets, ...result.offsets };
    useControls.getState().setConductorLeadOffsets(merged);
    // The store refuses a set its schema does not accept: then nothing was kept.
    const now = useControls.getState().conductorPrefs.leadOffsets;
    if (Object.entries(merged).some(([k, v]) => now[k] !== v)) return null;
    useLeadCalibration.getState().reset();
    return now;
  },
  clear: () => useControls.getState().setConductorLeadOffsets({}),
});
