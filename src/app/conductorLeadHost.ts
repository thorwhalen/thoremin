/**
 * Installs the conductor timing host (#427, `commands/conductorLeadHost.ts`): the finished
 * take in `useLeadCalibration`, the kept offsets in the hot store's `conductorPrefs`.
 */
import { provideConductorLeadHost } from '@/app/commands/conductorLeadHost';
import { useControls } from './store';
import { useLeadCalibration } from './conductorLead';

provideConductorLeadHost({
  pending: () => useLeadCalibration.getState().result?.offsets ?? null,
  keep: () => {
    const result = useLeadCalibration.getState().result;
    if (!result) return null;
    useControls.getState().setConductorLeadOffsets(result.offsets);
    useLeadCalibration.getState().reset();
    return result.offsets;
  },
  clear: () => useControls.getState().setConductorLeadOffsets({}),
});
