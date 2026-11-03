/**
 * The hand model's status for the shell (#922): the hand source's `status` port (#737), mirrored
 * into a small store each frame it changes (`makeLoadStatusReporter`, as the generative layer and
 * the orchestra do), so a player with the overlay hidden still learns that the hands are loading,
 * moving to the main thread, or stopped. The overlay's "Hands: ..." line reads the port directly;
 * this is its React twin, shown in the camera status column (`../timing/TimingChip.tsx`).
 *
 * It reaches the engine as a status hook ({@link handsStatusHook}), core's own, folded beside the
 * extensions' at the shell's fold point (`../host/contributions.ts`), so the engine host wires no
 * reporter of its own for it.
 */
import { create } from 'zustand';
import type { LoadStatus } from '@thoremin/lazy';
import { makeLoadStatusReporter } from '@thoremin/lazy/status';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import type { OutputReader, StatusHook } from '@thoremin/sdk-ui/types';

export interface HandsStatusState {
  /** The hand source's latest status; null before the first frame (or with no hand source). */
  status: LoadStatus | null;
  report(status: LoadStatus): void;
  reset(): void;
}

export const useHandsStatus = create<HandsStatusState>((set) => ({
  status: null,
  report: (status) => set({ status }),
  reset: () => set({ status: null }),
}));

/** The per-frame sink: the trunk's hand source's `status`, reported when it changes. */
export function makeHandsReporter(engine: OutputReader, store: Pick<HandsStatusState, 'report'> = useHandsStatus.getState()): () => void {
  return makeLoadStatusReporter(engine, store, TRUNK.cam);
}

/** The hands' status as a status hook: the generic per-tick sink the engine host runs for every
 *  hook in hand, cleared when the hand source leaves the graph or the engine goes. */
export const handsStatusHook: StatusHook = {
  nodeId: TRUNK.cam,
  make: (engine) => makeHandsReporter(engine),
  onRemoved: () => useHandsStatus.getState().reset(),
  reset: () => useHandsStatus.getState().reset(),
};

/** What the shell says about the hands: only what a player must know (loading, or not working);
 *  nothing while they are ready or tracked. */
export function handsNote(status: LoadStatus | null): string | null {
  if (!status || status.phase === 'ready' || status.phase === 'active' || status.phase === 'off') return null;
  return `Hands: ${status.message}`;
}
