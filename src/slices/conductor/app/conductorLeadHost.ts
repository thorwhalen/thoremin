/**
 * Installs the conductor timing host (#427, `./conductorLeadCommandHost.ts`): the finished
 * take in `useLeadCalibration`, the kept offsets in the hot store's `conductorPrefs`.
 *
 * Keep MERGES: a joint the take measured gets its new offset, a joint it did not keeps the
 * one it had (a take in which the trunk was too uneven must not wipe a trunk offset an
 * earlier take measured). A take that measured nothing has nothing to keep.
 */
import { provideConductorLeadHost } from './conductorLeadCommandHost';
import { controls } from '@thoremin/sdk-ui/host';
import { ConductorPrefsSchema, DEFAULT_CONDUCTOR_PREFS, type ConductorPrefs } from '../schema';
import { useLeadCalibration } from './conductorLead';

/** The device's conductor prefs, as stored (their default before any). */
export const conductorPrefs = (): ConductorPrefs => (controls().get().conductorPrefs as ConductorPrefs | undefined) ?? DEFAULT_CONDUCTOR_PREFS;

/** Write the lead offsets through the pref, refusing what its schema refuses (as the store's setter did). */
export function setLeadOffsets(leadOffsets: ConductorPrefs['leadOffsets']): void {
  const next = ConductorPrefsSchema.safeParse({ ...conductorPrefs(), leadOffsets });
  if (next.success) controls().setPref('conductorPrefs', next.data);
}
provideConductorLeadHost({
  pending: () => useLeadCalibration.getState().result?.offsets ?? null,
  keep: () => {
    const result = useLeadCalibration.getState().result;
    if (!result || !Object.keys(result.offsets).length) return null;
    const merged = { ...conductorPrefs().leadOffsets, ...result.offsets };
    setLeadOffsets(merged);
    // The store refuses a set its schema does not accept: then nothing was kept.
    const now = conductorPrefs().leadOffsets;
    if (Object.entries(merged).some(([k, v]) => now[k] !== v)) return null;
    useLeadCalibration.getState().reset();
    return now;
  },
  clear: () => setLeadOffsets({}),
});
