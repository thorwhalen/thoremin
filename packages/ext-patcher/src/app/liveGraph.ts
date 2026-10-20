/**
 * The live composed graph, mirrored into a React store for the patcher (#14).
 *
 * The extension SDK hands a status hook the running engine as an {@link OutputReader}; the engine
 * the host passes is the DAG `Engine`, which also says which graph it runs (`currentGraph`) and
 * how many times it has been re-wired (`graphVersion`). The hook reads those two when they are
 * there, so the patcher needs no seam of its own in the host and no import of the app: the sink
 * compares one integer per tick and copies the spec only when the engine commits a new graph (an
 * instrument switch, a dial that composes a branch, a lazy extension arriving). A reader without
 * them (a test double) leaves the store empty, and the panel says so.
 *
 * The hook is keyed to the trunk's `ui` node, which every composed graph has.
 */
import { create } from 'zustand';
import type { GraphSpec } from '@thoremin/dag';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import type { OutputReader, StatusHook } from '@thoremin/sdk-ui/types';

/** An output reader that also knows the graph it runs (the DAG `Engine` is one). */
export interface GraphReader extends OutputReader {
  currentGraph(): GraphSpec;
  graphVersion(): number;
}

export const isGraphReader = (reader: OutputReader): reader is GraphReader =>
  typeof (reader as Partial<GraphReader>).currentGraph === 'function' && typeof (reader as Partial<GraphReader>).graphVersion === 'function';

export interface LiveGraphState {
  /** The graph the engine runs now; null before an engine has ticked, or after it is gone. */
  spec: GraphSpec | null;
  /** The engine's re-wiring count for `spec`. */
  version: number;
  /** The engine itself, for the inspector's live port values. */
  reader: OutputReader | null;
}

const EMPTY: LiveGraphState = { spec: null, version: -1, reader: null };

export const useLiveGraph = create<LiveGraphState>(() => EMPTY);

/** The per-tick sink for one engine: publishes its graph when it changes. */
export function makeLiveGraphSink(reader: OutputReader, { store = useLiveGraph }: { store?: typeof useLiveGraph } = {}): (nowMs: number) => void {
  if (!isGraphReader(reader)) return () => {};
  let seen: number | null = null;
  return () => {
    const version = reader.graphVersion();
    if (version === seen) return;
    seen = version;
    store.setState({ spec: reader.currentGraph(), version, reader });
  };
}

export const LIVE_GRAPH_HOOK: StatusHook = {
  nodeId: TRUNK.ui,
  make: (engine) => makeLiveGraphSink(engine),
  onRemoved: () => useLiveGraph.setState(EMPTY),
  reset: () => useLiveGraph.setState(EMPTY),
};
