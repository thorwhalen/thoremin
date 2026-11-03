/**
 * generativeStatus — the store the engine loop writes the live `lyria` status into, so the
 * Generative settings section can render an honest readout (#188): off / loading / ready /
 * active, or `unavailable` with the reason (`no-key`) a panel turns into a key prompt. Ephemeral
 * per-frame runtime state, exactly like `midiStatus` and `faceStatus` — the DAG produces it;
 * React only displays it.
 *
 * It is the shared load-status store (`createLoadStatusStore`, #957) over the `gen` node, absent
 * as an `off` status; this slice's status hook (`../ui.tsx`) is its default hook, with the
 * transport paused on an engine reset.
 */
import type { LoadStatus } from '@thoremin/lazy';
import { createLoadStatusStore, type LoadStatusState } from '@thoremin/sdk-ui/loadStatusStore';

/** The status before the engine has reported anything (or after teardown). */
export const ABSENT_GENERATIVE_STATUS: LoadStatus = { phase: 'off', message: 'Generative layer off' };

/** The node id the reporter reads — the `lyria` node in `graph.ts`. */
export const GENERATIVE_NODE_ID = 'gen';

export type GenerativeStatusState = LoadStatusState<LoadStatus>;

/** The store, its reporter and its default status hook. */
export const GENERATIVE_STATUS = createLoadStatusStore(GENERATIVE_NODE_ID, { absent: ABSENT_GENERATIVE_STATUS });

export const useGenerativeStatus = GENERATIVE_STATUS.useStatus;

/** The per-frame sink: read `gen.status`, report it to {@link useGenerativeStatus} when its
 *  phase / reason / message / progress changed. Pure over the reader, so it is testable with a
 *  stub engine. */
export const makeGenerativeReporter = GENERATIVE_STATUS.makeReporter;
