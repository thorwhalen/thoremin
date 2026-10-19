/**
 * orchestraStatus — the store the engine loop writes the `orchestra` node's status into
 * (#187 PR 5), so the orchestra controls can say what the synth is doing: off, loading
 * the soundfont (with progress), ready, playing, or unavailable with a reason (no audio
 * graph yet: tap to play). Ephemeral runtime state, like the generative layer's status; the reporter
 * is the same change-gated reader of a node's `status` port, pointed at this store.
 */
import { create } from 'zustand';
import type { LoadStatus } from '@thoremin/lazy';
import { ORCHESTRA_NODE_ID } from '../branches';
import { makeLoadStatusReporter } from '@thoremin/lazy/status';
import type { OutputReader } from '@thoremin/sdk-ui/types';

/** The status before the engine has reported anything (or after teardown). */
export const ABSENT_ORCHESTRA_STATUS: LoadStatus = { phase: 'off', message: 'Orchestra off' };

/** The node id the reporter reads: the `orchestra` node in the conductor branch, defined
 *  with the branch and re-exported here for the engine loop. */
export { ORCHESTRA_NODE_ID };

export interface OrchestraStatusState {
  status: LoadStatus;
  report(status: LoadStatus): void;
  reset(): void;
}

export const useOrchestraStatus = create<OrchestraStatusState>((set) => ({
  status: ABSENT_ORCHESTRA_STATUS,
  report: (status) => set({ status }),
  reset: () => set({ status: ABSENT_ORCHESTRA_STATUS }),
}));

/** The per-frame sink: report `orchestra.status` when it changed. */
export function makeOrchestraReporter(engine: OutputReader, store: Pick<OrchestraStatusState, 'report'> = useOrchestraStatus.getState()): () => void {
  return makeLoadStatusReporter(engine, store, ORCHESTRA_NODE_ID);
}
