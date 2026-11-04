/**
 * The change-gated status reporter (#969; moved out of `@thoremin/lazy` in #983): the pure half of
 * every per-node readout. A readout mirrors a node's status into a store for the UI, and must not
 * re-render at frame rate for a status it already shows: `makeStatusGate` says when a status is
 * worth reporting (its key changed, or a frame-rate counter's key changed and its throttle let it
 * through), and `makeStatusReporter` is the per-frame sink that reads the node and reports what the
 * gate lets through.
 *
 * Why here: the gate is generic over any status type, so it does not belong in the lazy-loading
 * package, whose subject is loading a heavy resource and the `LoadStatus` vocabulary it reports
 * in; and it is pure (no React, no store library), so it belongs in the pure SDK rather than in
 * `@thoremin/sdk-ui`, whose status-store factory builds on it. A load-status readout is this gate
 * keyed by the lazy package's `loadStatusKey`.
 */

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

/** How a reporter reads its status off the engine: one node's `status` port when omitted. A readout
 *  assembled from several ports of its node (the conductor's time, dynamics, transport and dance)
 *  reads them here and returns undefined while the node has not computed (#983). */
export type StatusRead<T> = (engine: OutputReader, nodeId: string) => T | undefined;

/** A reporter's options: the gate's, and where the status is read. */
export interface StatusReporterOptions<T> extends StatusGateOptions<T> {
  read?: StatusRead<T>;
}

/** The default {@link StatusRead}: the node's `status` port. */
const readStatusPort = <T>(engine: OutputReader, nodeId: string): T | undefined => engine.getOutput(nodeId, 'status') as T | undefined;

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
 * the load-status reporter of #600 S14): it reads the port (or what `read` assembles), skips an absent output, and reports only what
 * the gate lets through, so a readout never re-renders at frame rate for a status it already shows.
 * Pure over the reader and the store. A throttled reporter's sink takes the tick's time (by type).
 */
export function makeStatusReporter<T>(
  engine: OutputReader,
  store: { report(status: T): void },
  nodeId: string,
  gate: StatusReporterOptions<T> & { throttle: StatusThrottle<T> },
): StatusSink<true>;
export function makeStatusReporter<T>(
  engine: OutputReader,
  store: { report(status: T): void },
  nodeId: string,
  gate: StatusReporterOptions<T> & { throttle?: undefined },
): StatusSink<false>;
/** A gate known only at run time (a store's options): the sink takes the time when it has one. */
export function makeStatusReporter<T>(engine: OutputReader, store: { report(status: T): void }, nodeId: string, gate: StatusReporterOptions<T>): StatusSink<boolean>;
export function makeStatusReporter<T>(engine: OutputReader, store: { report(status: T): void }, nodeId: string, gate: StatusReporterOptions<T>): StatusSink<boolean> {
  const { read = readStatusPort<T>, ...options } = gate;
  const changed = makeStatusGate(options);
  return (nowMs = 0) => {
    const status = read(engine, nodeId);
    if (!status) return;
    if (changed(status, nowMs)) store.report(status);
  };
}
