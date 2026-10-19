/**
 * A shell tool an extension contributes, as data (#330): React-free, so an extension's eager stub
 * and its pure modules can declare one without pulling React into a strict, React-less
 * typecheck. The panel that goes with it is `ExtensionTool` in `./types.ts`.
 */

/**
 * A shell tool an extension contributes, as data: the Tools launcher lists it (labelled and
 * described, one click from anywhere) and the player may pin it. The host validates it against
 * its own tool schema; an extension's tool always opens a panel.
 */
export interface ExtensionToolDecl {
  /** Stable id, unique across the app's tools and every extension's. */
  id: string;
  label: string;
  /** One line: the launcher row, the button's tooltip and the panel's strapline. */
  description: string;
  /** The launcher section: a `mode` takes the instrument over, a `tool` is used on it. */
  group: 'mode' | 'tool' | 'help';
  /** Whether it has its own bar button until the player says otherwise. */
  defaultPinned: boolean;
  /** The tool it is listed before, in the bar and the launcher (#600 S18b: the Conductor keeps its
   *  place ahead of the Trainer, where it was core's first tool). Absent, or a tool the shell does
   *  not list: after every tool listed so far. */
  before?: string;
}

/**
 * A way into one tool from another tool's panel, an extension's contribution as data (#465): the
 * Conductor panel lists the entry points `from: 'conductor'` instead of naming an extension's
 * tool and carve modality by literal. The host shows one only while its `tool` is in the shell
 * (an extension left out of a build takes its entry points with it) and its `when` matches the
 * panel's context.
 */
export interface ToolEntryPointDecl {
  /** Stable id, unique across every extension's entry points. */
  id: string;
  /** The host tool whose panel lists it (`conductor`). */
  from: string;
  /** The tool it opens. */
  tool: string;
  label: string;
  /** Shown only while every key equals the host panel's context value of that name (the
   *  Conductor's is `conductor.source`); absent, always. */
  when?: Readonly<Record<string, string | number | boolean>>;
  /** Before opening, ask the tool's carve session for this context (`requestCarve`). */
  carve?: { modality: string; vocabulary: string | null };
}
