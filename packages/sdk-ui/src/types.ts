/**
 * The React half of an extension manifest (the `sdk/ui` side of the instruments-as-graphs
 * ADR, §4.2): what the shell needs from an extension beyond its nodes and branches. The
 * pure half is `packages/sdk/src/instruments/extension.ts`.
 *
 *  - `panels`: one editor section per instrument the extension ships (its controls and its
 *    live readout), keyed by the instrument id `AIR_INSTRUMENTS` uses. `DialsControlsPanel`
 *    folds over these instead of importing a hand-listed table.
 *  - `statusHooks`: per-tick sinks that mirror a node's outputs into a React store (a
 *    status readout, a live shape for enrolment). `useEngine` builds each with the engine,
 *    runs it as an Applier sink, calls `onRemoved` when the node leaves the graph (so a
 *    readout never shows a node that no longer exists) and `reset` when the engine is torn
 *    down.
 *  - `onMount`: effects the app shell runs once on mount (a demand claim, a vocabulary
 *    load); each may return a cleanup.
 */
import type { ComponentType } from 'react';

/** The one thing a status hook reads: a node output by id and port (the engine, or a test double). */
export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

export interface ExtensionPanel {
  /** The instrument id (`drum`), as in the library's instrument table. */
  instrumentId: string;
  section: string;
  Controls: ComponentType;
  Readout: ComponentType;
}

export interface StatusHook {
  /** The node whose outputs this hook mirrors; `onRemoved` fires when it leaves the graph. */
  nodeId: string;
  /** Build the per-tick sink for a live engine. */
  make: (engine: OutputReader) => () => void;
  /** The node left the graph: show it as absent. */
  onRemoved: () => void;
  /** The engine is gone: back to the initial state. */
  reset: () => void;
}

export interface ExtensionUi {
  id: string;
  panels: readonly ExtensionPanel[];
  statusHooks: readonly StatusHook[];
  onMount: readonly (() => void | (() => void))[];
}
