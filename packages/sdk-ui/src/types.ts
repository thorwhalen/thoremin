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
 *  - `tools` (optional): shell tools, listed in the Tools launcher beside the app's own
 *    (#330: the face categorizer session is the first). The host draws the panel's frame and
 *    mounts the content only while the tool is open.
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
  /**
   * When the chosen instrument's row shows this panel's `Readout` (#367), given the live
   * settings. Absent: while the instrument id is one of the library's air or sign instruments
   * and on (`AIR_INSTRUMENTS`). A panel that is not such an instrument (the faces extension's
   * categorizers) says here when its readout is worth a line under the row. Pure and cheap:
   * it is part of a lazy extension's eager stub, and runs on every settings change.
   */
  readoutOn?: (settings: Readonly<Record<string, unknown>>) => boolean;
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

/** A shell tool an extension contributes, as data (React-free, so a pure stub can name it). */
export type { ExtensionToolDecl } from './tools';
import type { ExtensionToolDecl } from './tools';

/** What the host hands a tool's panel. */
export interface ExtensionToolPanelProps {
  /** Close the tool (the same as the frame's X). */
  close: () => void;
}

export interface ExtensionTool extends ExtensionToolDecl {
  /** The panel's content. The host draws the frame (title, strapline, close) and mounts this
   *  only while the tool is open, so unmounting is the tool's "closed". */
  Panel: ComponentType<ExtensionToolPanelProps>;
}

export interface ExtensionUi {
  id: string;
  panels: readonly ExtensionPanel[];
  statusHooks: readonly StatusHook[];
  onMount: readonly (() => void | (() => void))[];
  tools?: readonly ExtensionTool[];
}

/** An editor section a LAZY extension will contribute: where it goes and its label, with no
 *  component (those load with the extension's deferred UI half). */
export type ExtensionPanelDecl = Pick<ExtensionPanel, 'instrumentId' | 'section' | 'readoutOn'>;

/**
 * The EAGER stub of a lazy extension's React half (`docs/design/lazy-extensions.md`): its
 * sections, declared as data, so the shell can list them before anything loads. The full
 * {@link ExtensionUi} (components, status hooks, mount effects) is the deferred half, which
 * the host's build loads with a dynamic `import()`; its mount effects run when it loads.
 */
export interface ExtensionUiStub {
  id: string;
  panels: readonly ExtensionPanelDecl[];
  /** The shell tools it will contribute, as data; their panels load with the deferred half
   *  the first time the player opens one. */
  tools?: readonly ExtensionToolDecl[];
}
