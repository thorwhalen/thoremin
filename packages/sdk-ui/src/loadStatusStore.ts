/**
 * One store per heavy node's load status (#957): the React mirror of a node's `status` port.
 *
 * The hand source, the generative layer and the orchestra each kept the same three pieces: a
 * zustand store `{ status, report, reset }`, a per-frame reporter over one node id
 * (`makeLoadStatusReporter`, which reports only on a change), and a status hook wiring the two
 * into the engine host. They differed only in the node id and in what "absent" reads as (null,
 * or an `off` status with the node's own words). This factory is that shape once, so the next
 * heavy node gets its readout from one call.
 *
 * Since #969 it is the load-status case of the general readout store (`./statusStore`): the same
 * store, reporter and hook (with the reset-count rebuild that keeps a returning node's status from
 * being swallowed by the change gate), keyed by the load-status vocabulary's own change key.
 *
 * It lives here and not beside `makeLoadStatusReporter` in `@thoremin/lazy`, because that
 * package is pure and Node-safe with no vendor library, and the store is a React hook (zustand).
 * A store with more than the status (the face's label and scores, throttled, with a toast) is
 * its own store: it reads another port shape and reports on its own cadence.
 */
import type { LoadStatus } from '@thoremin/lazy';
import { loadStatusKey } from '@thoremin/lazy/status';
import { createStatusStore, type StatusState, type StatusStore } from './statusStore';

/** The store's state: the node's latest status, or `absent` before the first report. */
export type LoadStatusState<S extends LoadStatus | null = LoadStatus | null> = StatusState<S>;

/** What {@link createLoadStatusStore} returns. */
export type LoadStatusStore<S extends LoadStatus | null = LoadStatus | null> = StatusStore<S>;

export interface LoadStatusStoreOptions {
  /** The status before the engine has reported (and after teardown). Null when omitted. */
  absent?: LoadStatus | null;
}

/**
 * The store, reporter and status hook for one heavy node's load status.
 *
 * @param nodeId - the node whose `status` output is mirrored.
 * @param options.absent - what the store holds before any report; null by default, or a status
 *   (`{ phase: 'off', message: 'Orchestra off' }`) for a readout that always has words to show.
 */
export function createLoadStatusStore(nodeId: string): LoadStatusStore<LoadStatus | null>;
export function createLoadStatusStore(nodeId: string, options: { absent: LoadStatus }): LoadStatusStore<LoadStatus>;
export function createLoadStatusStore(nodeId: string, { absent = null }: LoadStatusStoreOptions = {}): LoadStatusStore<LoadStatus | null> {
  return createStatusStore<LoadStatus | null>(nodeId, { absent, keyOf: loadStatusKey });
}
