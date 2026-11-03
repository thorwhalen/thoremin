/**
 * One store per node readout (#969, generalised from #957's load-status store): the React mirror
 * of one node's status port, whatever that status's shape.
 *
 * About a dozen readouts (the air and chord instruments, the theremin, the games, the music
 * context, MIDI, the heavy nodes' load status) each kept the same three pieces: a zustand store
 * `{ <field>, report, reset }`, a per-frame reporter over one node id that reports only on a
 * change of what the readout shows, and a status hook wiring the two into the engine host. They
 * differ in the status type, in the key that says what changed, in the state's field name (`status`
 * or `live`) and, for MIDI, in a throttle on a counter that moves at frame rate. This factory is
 * that shape once; the change gate itself is `makeStatusReporter` in `@thoremin/lazy/status`, pure.
 *
 * The host builds a hook's sink once per engine (`src/app/extensions/index.ts`), while a node may
 * leave the graph and come back many times under it. The reporter's change gate remembers the last
 * status it reported, so after a reset to absent it would swallow a returning node's first status
 * when that status is the one it left with. The store therefore counts its resets, and the hook's
 * sink rebuilds its reporter when the count has moved.
 *
 * A readout of several ports of its one node (the conductor's) passes `read`. A readout with
 * something besides one node's status (the face's label and scores, read from three nodes, with a
 * toast; the song's player and pace controller, with its transport's edges) is its own store, and
 * takes the reset count alone ({@link createResetCount}). A readout with one more step (a custom
 * reset, a clock of its own) composes over what this returns: spread `statusHook` and replace the
 * member.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { makeStatusReporter, type StatusReporterOptions, type StatusSink, type StatusThrottle } from '@thoremin/lazy/status';
import type { OutputReader, StatusHook } from './types';

/** The store's state: the node's latest status under `field` (`status` by default), or `absent`
 *  before the first report. */
export type StatusState<T, F extends string = 'status'> = { [K in F]: T } & StatusActions<T>;

/** The store's actions: what a reporter writes to, and the reset the hook runs. */
export interface StatusActions<T> {
  report(status: NonNullable<T>): void;
  reset(): void;
}

/** What {@link createStatusStore} returns. */
export interface StatusStore<T, F extends string = 'status', Timed extends boolean = false> {
  /** The zustand store (a React hook; `getState()` outside React). */
  useStatus: UseBoundStore<StoreApi<StatusState<T, F>>>;
  /** The per-frame sink: the node's status, reported to `store` (this store by default) when the
   *  gate lets it through. A throttled store's sink requires the tick's time, in ms. */
  makeReporter(engine: OutputReader, store?: Pick<StatusActions<T>, 'report'>): StatusSink<Timed>;
  /** The status hook the engine host runs: the reporter, and back to absent when the node leaves
   *  the graph or the engine goes. Its sink starts afresh after every reset, so a node that comes
   *  back with the status it left with is reported again. Spread it to add to a member. */
  statusHook: StatusHook;
}

/** How {@link createStatusStore} reads, gates and holds a status. */
export interface StatusStoreOptions<T> extends StatusReporterOptions<NonNullable<T>> {
  /** The status before the engine has reported, after the node leaves and after teardown. */
  absent: T;
  /** The state's field the status is kept under: `status` when omitted. */
  field?: string;
}

/** The options without a throttle, and with one (whose reporter's sink is timed). */
type Untimed<T> = StatusStoreOptions<T> & { throttle?: undefined };
type Timed<T> = StatusStoreOptions<T> & { throttle: StatusThrottle<NonNullable<T>> };

/**
 * The store, reporter and status hook for one node's readout.
 *
 * @param nodeId - the node whose `status` output is mirrored.
 * @param options.absent - what the store holds before any report.
 * @param options.read - how the status is read off the engine: the node's `status` port when
 *   omitted; a readout of several of its node's ports (the conductor's) assembles it here.
 * @param options.keyOf - what the readout shows, as a string: a status with an unchanged key is not
 *   reported again (quantise here what the view rounds).
 * @param options.throttle - for a counter that moves at frame rate: a change in its own key alone
 *   reports at most once per `ms`. The reporter's sink then requires the tick's time (by type).
 * @param options.field - the state's field name: omitted, `status`; any other name (`live` for the
 *   instruments) must be passed (by overload), so the state's type and where it is kept agree.
 */
export function createStatusStore<T>(nodeId: string, options: Untimed<T> & { field?: 'status' }): StatusStore<T>;
export function createStatusStore<T, F extends string>(nodeId: string, options: Untimed<T> & { field: F }): StatusStore<T, F>;
export function createStatusStore<T>(nodeId: string, options: Timed<T> & { field?: 'status' }): StatusStore<T, 'status', true>;
export function createStatusStore<T, F extends string>(nodeId: string, options: Timed<T> & { field: F }): StatusStore<T, F, true>;
export function createStatusStore<T>(nodeId: string, options: StatusStoreOptions<T>): StatusStore<T, string, boolean> {
  const { absent, field = 'status', ...gate } = options;
  type State = StatusState<T, string>;
  const resets = createResetCount();
  const holding = (status: T) => ({ [field]: status }) as Partial<State>;
  const useStatus = create<State>(
    (set) =>
      ({
        ...holding(absent),
        report: (status: NonNullable<T>) => set(holding(status)),
        reset: () => {
          resets.bump();
          set(holding(absent));
        },
      }) as State,
  );
  const reset = () => useStatus.getState().reset();
  const makeReporter = (engine: OutputReader, store: Pick<StatusActions<T>, 'report'> = useStatus.getState()) =>
    makeStatusReporter<NonNullable<T>>(engine, store, nodeId, gate);
  return {
    useStatus,
    makeReporter,
    statusHook: { nodeId, make: (engine) => resets.rebuilding(() => makeReporter(engine)), onRemoved: reset, reset },
  };
}

/** A store's reset count, and the sinks it rebuilds: see {@link createResetCount}. */
export interface ResetCount {
  /** Count one reset (the store's `reset` calls it). */
  bump(): void;
  /** A sink that runs `make()`'s and builds it afresh when the count has moved since. */
  rebuilding(make: () => (nowMs: number) => void): (nowMs: number) => void;
}

/**
 * The reset-count rebuild every status store's hook needs (#967, #983): the host builds a hook's
 * sink once per engine, so a sink holding a change gate (or any other memory of what it reported)
 * must start afresh after its store is reset to absent, or a node that comes back with the status
 * it left with is swallowed. {@link createStatusStore} uses it; a store of another shape (the
 * song's, with four fields and its own edge detectors) bumps it in its own `reset`.
 */
export function createResetCount(): ResetCount {
  let resets = 0;
  return {
    bump: () => {
      resets += 1;
    },
    rebuilding: (make) => {
      let seen = resets;
      let sink = make();
      return (nowMs) => {
        if (seen !== resets) {
          seen = resets;
          sink = make();
        }
        sink(nowMs);
      };
    },
  };
}
