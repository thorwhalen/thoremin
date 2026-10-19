/**
 * The React half of an extension manifest (the `sdk/ui` side of the instruments-as-graphs
 * ADR, §4.2): what the shell needs from an extension beyond its nodes and branches. The
 * pure half is `packages/sdk/src/instruments/extension.ts`.
 *
 *  - `panels`: one editor section per instrument the extension ships (its controls and its
 *    live readout), keyed by the instrument id of its catalog row (`Extension.catalog`). `DialsControlsPanel`
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
   * and on (the instrument catalog, `INSTRUMENT_CATALOG`). A panel that is not such an instrument (the faces extension's
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
export type { ExtensionToolDecl, ToolEntryPointDecl } from './tools';
import type { ExtensionToolDecl, ToolEntryPointDecl } from './tools';

/** What the host hands a tool's panel. */
export interface ExtensionToolPanelProps {
  /** Close the tool (the same as the frame's X). */
  close: () => void;
}

export interface ExtensionTool extends ExtensionToolDecl {
  /** The panel's content. The host draws the frame (title, strapline, close) and mounts this
   *  only while the tool is open, so unmounting is the tool's "closed". */
  Panel: ComponentType<ExtensionToolPanelProps>;
  /** A tool that keeps working with its panel closed (#600 S15: the song plays on) says so here:
   *  the bar shows it running and carries its stop control. An EAGER extension's only (a lazy
   *  tool runs nothing before its half loads). */
  detached?: ToolDetached;
  /** Its icon in the bar, the launcher and the panel's frame (#600 S15; a lucide icon, say). An
   *  EAGER extension's only; absent, the tool is shown by its label (and the frame's generic icon). */
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

/** How the bar shows a detached tool (see {@link ExtensionTool.detached}). */
export interface ToolDetached {
  /** A React hook: whether the tool is working now (the bar's running mark). Called on every
   *  render of the bar, in a stable order, so it may use hooks. */
  useRunning: () => boolean;
  /** Stop it, through the write path its state has (a command, for a transport that is one). */
  stop: () => void;
  /** What stopping does, for the stop button's tooltip (`pause the song`). */
  hint: string;
}

/** What a host panel hands the sections contributed to it (see {@link ExtensionToolSection}):
 *  its own state, by name (`conductor.conducts`), including values a section only displays. */
export type ToolSectionContext = Readonly<Record<string, unknown>>;

/**
 * A section an extension contributes to ANOTHER tool's panel (#600 S15), as an entry point is a
 * link into one (#465): the Conductor panel shows "Conduct a recording" from whichever extension
 * plays recordings, instead of importing the song player. The host renders it while `when`
 * holds over its context, and raises its panel events to it SYNCHRONOUSLY inside the click that
 * caused them, so a section may unlock media playback there (WebKit's autoplay policy wants a
 * gesture). An EAGER extension's only.
 */
export interface ExtensionToolSection {
  /** Stable id, unique across every extension's sections. */
  id: string;
  /** The host tool whose panel shows it (`conductor`). */
  from: string;
  /** Shown only while every key equals the host panel's context value of that name; absent, always. */
  when?: Readonly<Record<string, string | number | boolean>>;
  Section: ComponentType<{ context: ToolSectionContext }>;
  /** The host panel's events it hears (the Conductor raises `start` and `stop`), each called with
   *  the context at the moment of the click, whether or not `when` holds. */
  on?: Readonly<Record<string, (context: ToolSectionContext) => void>>;
}

/**
 * A key an extension binds to one of its commands (#600 S11), folded into the shell's keymap.
 * `when` decides per press, synchronously: `pass` leaves the key to the browser (nothing is live
 * that the command acts on), `swallow` takes it without dispatching (a repeat, a moment the command
 * would refuse), `dispatch` runs the command. Absent: always dispatch.
 */
export interface KeybindingDecl {
  /** A tinykeys binding string (`Space`, `$mod+k`). */
  key: string;
  /** The command the key dispatches; or, for state that is deliberately NOT a command (a
   *  transport, like the master mute: nothing but a human press may start a paid stream), `run`. */
  command?: string;
  run?: () => void;
  params?: Readonly<Record<string, unknown>>;
  when?: (e?: Pick<KeyboardEvent, 'repeat'>) => 'pass' | 'swallow' | 'dispatch';
  /** What the key does, for the editor's Keyboard list (#600 S14: `p — play / pause ...`). */
  help?: string;
}

/** A command implementation an extension provides (an acture `CommandRecord`), typed
 *  structurally so the SDK names no command library. */
export interface ExtensionCommand {
  readonly id: string;
  readonly execute: (params: never, ctx: never) => unknown;
  /** It writes the dials (through `applyDial`), so undo takes it back and the assistant treats it
   *  as a write (#600 S14). Absent: a query, or a write undo cannot reach. */
  readonly writesDials?: boolean;
}

/**
 * Something that keeps sounding while the player has muted (#600 S13): the shell's muted banner
 * names it ("MIDI still on"), so a player who pressed M knows what still reaches the outside. A
 * pure read of the hot store's state, called on every store change: the note, or null while the
 * output is silent too.
 */
export interface StillSounding {
  id: string;
  whileMuted: (state: Readonly<Record<string, unknown>>) => string | null;
}

export interface ExtensionUi {
  id: string;
  panels: readonly ExtensionPanel[];
  statusHooks: readonly StatusHook[];
  onMount: readonly (() => void | (() => void))[];
  tools?: readonly ExtensionTool[];
  /** Ways into a tool from another tool's panel (#465), as data. */
  entryPoints?: readonly ToolEntryPointDecl[];
  /** The implementations of the commands its manifest declares (#600 S11). */
  commands?: readonly ExtensionCommand[];
  /** Keys it binds to its commands (#600 S11). */
  keybindings?: readonly KeybindingDecl[];
  /** Its outputs that keep sounding while the player has muted (#600 S13). An EAGER extension's
   *  only: a lazy extension's stub carries none (an output that keeps sounding is one the player
   *  is playing through, which is eager by nature). */
  stillSounding?: readonly StillSounding[];
  /** Sections it contributes to another tool's panel (#600 S15). */
  toolSections?: readonly ExtensionToolSection[];
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
  /** Ways into a tool from another tool's panel (#465), as data. */
  entryPoints?: readonly ToolEntryPointDecl[];
  /** Keys it binds to its commands (#600 S11): eager, so a key works before the extension loads
   *  (its command's stand-in loads it). */
  keybindings?: readonly KeybindingDecl[];
  /** Commands implemented NOW, before the deferred half loads (#600 S11): for a command so thin
   *  that loading the extension to run it would be waste (the carve's capture, a call onto an SDK
   *  seam that answers "no carve is live" until the half has loaded). A declared command with no
   *  implementation here is a stand-in that loads the half when it runs. */
  commands?: readonly ExtensionCommand[];
}
