/**
 * The shared status vocabulary every lazily-loaded heavy resource speaks (#188).
 *
 * Three nodes already report a lifecycle phase on a port so the UI can be honest
 * about *why* they are silent: `webcam-face` (`idle | loading | ready | error`),
 * `midi-out` (`off | unsupported | connecting | ready | no-ports | denied | error`)
 * and the recording formats (a null blob plus an error). Each invented its own
 * words. This module is the one vocabulary the next heavy node uses instead, and
 * what one shared readout component renders — see `docs/design/lazy-loading.md`.
 *
 * Node-specific detail lives in `reason`, never in a new phase: a blocked MIDI
 * permission and a missing API key are both `unavailable`, with reasons `denied`
 * and `no-key`, so a UI that has never heard of the node still knows to show the
 * reason instead of a dead toggle.
 */

/** Where a heavy resource is in its life. Ordered roughly as a player meets them. */
export type LoadPhase =
  /** Not requested: nothing loaded, nothing held. The enable control is off. */
  | 'off'
  /** Requested, but this host cannot provide it. `reason` says why, actionably. */
  | 'unavailable'
  /** The implementation (SDK, model, wasm, session) is being fetched or opened. */
  | 'loading'
  /** Loaded and usable; idle. */
  | 'ready'
  /** Loaded and doing its job right now (playing, sending, detecting). */
  | 'active'
  /** The load or the resource failed. A later disable + enable retries. */
  | 'error';

/** What a heavy node reports on its `status` port each tick. */
export interface LoadStatus {
  phase: LoadPhase;
  /** Short, human-readable explanation of the phase, always present. */
  message: string;
  /** Machine-readable cause for `unavailable` / `error` (`no-key`, `denied`, `unsupported`, …),
   *  and optionally a qualifier for `loading` (`permission`: waiting on a browser prompt,
   *  which wants different player instructions than a download). */
  reason?: string;
  /** 0..1 while `loading`, when the loader can report it (a multi-megabyte download). */
  progress?: number;
  /** Node-specific data that travels with the phase — the MIDI port list that comes
   *  back WITH a `no-ports` / `port-not-found` result, for a selector to offer. Typed by
   *  the node, opaque here. */
  detail?: unknown;
}

/** A `ready` status becomes `active` while the node is doing its job; anything else is
 *  returned unchanged. Keeps "is it working" a one-line composition in `process()`. */
export function withActive(status: LoadStatus, active: boolean, activeMessage?: string): LoadStatus {
  if (status.phase !== 'ready' || !active) return status;
  return { ...status, phase: 'active', message: activeMessage ?? status.message };
}

/** What a reader of node outputs offers: the engine, or a stub in a test. */
export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

/**
 * When a status is worth reporting (#969): `keyOf` is what a readout shows, so a status whose key
 * is unchanged is not reported again. `throttle` is for a readout with a counter that moves at
 * frame rate (MIDI's sounding notes): a change in its `keyOf` alone, with the main key unchanged,
 * reports at most once per `ms`, while a change in the main key reports at once.
 */
export interface StatusGateOptions<T> {
  keyOf: (status: T) => string;
  throttle?: StatusThrottle<T>;
}

/** A throttle on a counter that moves at frame rate: its own key, and how often it may report. */
export interface StatusThrottle<T> {
  ms: number;
  keyOf: (status: T) => string;
}

/** A reporter's per-frame sink. A throttled one is timed: it needs the tick's time, in ms, since
 *  pacing on a missing time would hold every paced change forever. */
export type StatusSink<Timed extends boolean> = Timed extends true ? (nowMs: number) => void : (nowMs?: number) => void;

/** The change gate of {@link StatusGateOptions}: true when `status`, seen at `nowMs`, should be
 *  reported. Stateful (it remembers the last report); pure over its arguments otherwise. */
export function makeStatusGate<T>({ keyOf, throttle }: StatusGateOptions<T>): (status: T, nowMs: number) => boolean {
  let lastKey: string | undefined;
  let lastPaced: string | undefined;
  let lastAt = -Infinity;
  return (status, nowMs) => {
    const key = keyOf(status);
    const paced = throttle ? throttle.keyOf(status) : undefined;
    if (key === lastKey && (paced === lastPaced || nowMs - lastAt < (throttle?.ms ?? 0))) return false;
    lastKey = key;
    lastPaced = paced;
    lastAt = nowMs;
    return true;
  };
}

/**
 * The per-frame sink that mirrors one node's `status` port into a store (#969, generalised from
 * {@link makeLoadStatusReporter}): it reads the port, skips an absent output, and reports only what
 * the gate lets through, so a readout never re-renders at frame rate for a status it already shows.
 * Pure over the reader and the store. A throttled reporter's sink takes the tick's time (by type).
 */
export function makeStatusReporter<T>(
  engine: OutputReader,
  store: { report(status: T): void },
  nodeId: string,
  gate: StatusGateOptions<T> & { throttle: StatusThrottle<T> },
): StatusSink<true>;
export function makeStatusReporter<T>(
  engine: OutputReader,
  store: { report(status: T): void },
  nodeId: string,
  gate: StatusGateOptions<T> & { throttle?: undefined },
): StatusSink<false>;
/** A gate known only at run time (a store's options): the sink takes the time when it has one. */
export function makeStatusReporter<T>(engine: OutputReader, store: { report(status: T): void }, nodeId: string, gate: StatusGateOptions<T>): StatusSink<boolean>;
export function makeStatusReporter<T>(engine: OutputReader, store: { report(status: T): void }, nodeId: string, gate: StatusGateOptions<T>): StatusSink<boolean> {
  const changed = makeStatusGate(gate);
  return (nowMs = 0) => {
    const status = engine.getOutput(nodeId, 'status') as T | undefined;
    if (!status) return;
    if (changed(status, nowMs)) store.report(status);
  };
}

/** What a load-status readout shows: the phase, reason, message and progress. */
export const loadStatusKey = (s: LoadStatus): string => `${s.phase}|${s.reason ?? ''}|${s.message}|${s.progress ?? ''}`;

/**
 * The per-frame sink that mirrors a heavy node's `status` output into a store (#600 S14: lifted
 * from the generative layer's reporter, which the orchestra's reused): it reports only when the
 * phase, reason, message or progress changed, so a readout never re-renders at frame rate for an
 * unchanged phase. Pure over the reader.
 */
export function makeLoadStatusReporter(
  engine: OutputReader,
  store: { report(status: LoadStatus): void },
  nodeId: string,
): () => void {
  return makeStatusReporter(engine, store, nodeId, { keyOf: loadStatusKey });
}
