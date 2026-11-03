/**
 * The hand model's status for the shell (#922): the hand source's `status` port (#737), mirrored
 * into a small store each frame it changes, so a player with the overlay hidden still learns that
 * the hands are loading, moving to the main thread, or stopped. The overlay's "Hands: ..." line
 * reads the port directly; this is its React twin, shown in the camera status column
 * (`../timing/TimingChip.tsx`).
 *
 * The store, its reporter and its status hook are the shared load-status store
 * (`createLoadStatusStore`, #957), absent as null; the hook is core's own, folded beside the
 * extensions' at the shell's fold point (`../host/contributions.ts`), so the engine host wires no
 * reporter of its own for it.
 */
import type { LoadStatus } from '@thoremin/lazy';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import { createLoadStatusStore, type LoadStatusState } from '@thoremin/sdk-ui/loadStatusStore';

/** The hand source's latest status; null before the first frame (or with no hand source). */
export type HandsStatusState = LoadStatusState<LoadStatus | null>;

const HANDS_STATUS_STORE = createLoadStatusStore(TRUNK.cam);

export const useHandsStatus = HANDS_STATUS_STORE.useStatus;

/** The per-frame sink: the trunk's hand source's `status`, reported when it changes. */
export const makeHandsReporter = HANDS_STATUS_STORE.makeReporter;

/** The hands' status as a status hook: the generic per-tick sink the engine host runs for every
 *  hook in hand, cleared when the hand source leaves the graph or the engine goes. */
export const handsStatusHook = HANDS_STATUS_STORE.statusHook;

/** What the shell says about the hands: only what a player must know (loading, or not working);
 *  nothing while they are ready or tracked. */
export function handsNote(status: LoadStatus | null): string | null {
  if (!status || status.phase === 'ready' || status.phase === 'active' || status.phase === 'off') return null;
  return `Hands: ${status.message}`;
}
