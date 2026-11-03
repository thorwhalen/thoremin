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
 * It lives here and not beside `makeLoadStatusReporter` in `@thoremin/lazy`, because that
 * package is pure and Node-safe with no vendor library, and the store is a React hook (zustand).
 * A store with more than the status (the face's label and scores, throttled, with a toast) is
 * its own store: it reads another port shape and reports on its own cadence.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { LoadStatus } from '@thoremin/lazy';
import { makeLoadStatusReporter } from '@thoremin/lazy/status';
import type { OutputReader, StatusHook } from './types';

/** The store's state: the node's latest status, or `absent` before the first report. */
export interface LoadStatusState<S extends LoadStatus | null = LoadStatus | null> {
  status: S;
  report(status: LoadStatus): void;
  reset(): void;
}

/** What {@link createLoadStatusStore} returns. */
export interface LoadStatusStore<S extends LoadStatus | null = LoadStatus | null> {
  /** The node whose `status` port the reporter reads. */
  nodeId: string;
  /** What the store holds before the first report and after a reset. */
  absent: S;
  /** The zustand store (a React hook; `getState()` outside React). */
  useStatus: UseBoundStore<StoreApi<LoadStatusState<S>>>;
  /** The per-frame sink: the node's `status`, reported to `store` (this store by default) when
   *  its phase, reason, message or progress changed. */
  makeReporter(engine: OutputReader, store?: Pick<LoadStatusState<S>, 'report'>): () => void;
  /** The status hook the engine host runs: the reporter, and back to absent when the node
   *  leaves the graph or the engine goes. Spread it to add to `reset` or `onRemoved`. */
  statusHook: StatusHook;
}

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
export function createLoadStatusStore(nodeId: string, options?: LoadStatusStoreOptions): LoadStatusStore<LoadStatus | null>;
export function createLoadStatusStore(nodeId: string, { absent = null }: LoadStatusStoreOptions = {}): LoadStatusStore<LoadStatus | null> {
  const useStatus = create<LoadStatusState>((set) => ({
    status: absent,
    report: (status) => set({ status }),
    reset: () => set({ status: absent }),
  }));
  const reset = () => useStatus.getState().reset();
  const makeReporter = (engine: OutputReader, store: Pick<LoadStatusState, 'report'> = useStatus.getState()) =>
    makeLoadStatusReporter(engine, store, nodeId);
  return {
    nodeId,
    absent,
    useStatus,
    makeReporter,
    statusHook: { nodeId, make: (engine) => makeReporter(engine), onRemoved: reset, reset },
  };
}
