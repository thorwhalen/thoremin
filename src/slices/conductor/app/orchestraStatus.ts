/**
 * orchestraStatus — the store the engine loop writes the `orchestra` node's status into
 * (#187 PR 5), so the orchestra controls can say what the synth is doing: off, loading
 * the soundfont (with progress), ready, playing, or unavailable with a reason (no audio
 * graph yet: tap to play). Ephemeral runtime state, like the generative layer's status: the
 * shared load-status store (`createLoadStatusStore`, #957) over the orchestra node, absent as an
 * `off` status.
 */
import type { LoadStatus } from '@thoremin/lazy';
import { createLoadStatusStore, type LoadStatusState } from '@thoremin/sdk-ui/loadStatusStore';
import { ORCHESTRA_NODE_ID } from '../branches';

/** The status before the engine has reported anything (or after teardown). */
export const ABSENT_ORCHESTRA_STATUS: LoadStatus = { phase: 'off', message: 'Orchestra off' };

/** The node id the reporter reads: the `orchestra` node in the conductor branch, defined
 *  with the branch and re-exported here for the engine loop. */
export { ORCHESTRA_NODE_ID };

export type OrchestraStatusState = LoadStatusState<LoadStatus>;

/** The store, its reporter and its status hook. */
export const ORCHESTRA_STATUS = createLoadStatusStore(ORCHESTRA_NODE_ID, { absent: ABSENT_ORCHESTRA_STATUS });

export const useOrchestraStatus = ORCHESTRA_STATUS.useStatus;

/** The per-frame sink: report `orchestra.status` when it changed. */
export const makeOrchestraReporter = ORCHESTRA_STATUS.makeReporter;
