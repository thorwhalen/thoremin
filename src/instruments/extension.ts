/**
 * The extension manifest: everything an instrument class (or one instrument) contributes to
 * the app, as ONE object the app folds over (`docs/design/instruments-as-graphs-and-extensions.md`
 * §4.2; PR 5a). Before this, a new air instrument touched six hand-listed registries in 21
 * files; with it, the registries are folds over `EXTENSIONS`.
 *
 * Two halves, mirroring the two SDK entry points the ADR names:
 *
 *  - {@link Extension} is PURE (no React, no DOM): nodes, branches, the dials slice, the
 *    transient hot-store fields it wants as `store-controls` ports, and the derivation of
 *    its branches from the settings. The engine, the composer, the settings schema and the
 *    UI bridge read this half.
 *  - {@link ExtensionUi} is the React half: the editor sections per instrument, the status
 *    hooks that mirror a node's outputs into a React store each tick (and reset when the
 *    node leaves the graph), and mount-time effects (a demand claim, a vocabulary load).
 *    `DialsControlsPanel`, `useEngine` and `App` read this half.
 *
 * In PR 5a the air instruments are registered through a manifest at their CURRENT paths;
 * the physical move into `src/extensions/air/` (5b) follows once the trainer stream is done
 * with `src/air`. The manifest is what makes the move a `git mv`.
 */
import type { z } from 'zod';
import type { NodeDef } from '@/dag';
import type { GraphBranch } from './branch';
import type { DerivationSettings } from './derive';

/** A whole-object dial the extension owns: one top-level key of the settings schema. */
export interface DialSlice {
  /** The settings key (`airDrum`), also the `store-controls` port name. */
  key: string;
  /** The Zod object schema of the dial; its defaults are the dial's defaults. */
  schema: z.ZodTypeAny;
  /** The `store-controls` port kind (`air-drum-config`). */
  kind: string;
  /** The dials metadata the settings form and the palette show. */
  meta: { facets: string[]; title: string; description: string };
}

/** A transient hot-store field the extension reads through a `store-controls` port
 *  (a learned model, a status): always emitted, `null` when absent, so a clear reaches
 *  the node. */
export interface TransientPort {
  /** The hot-store field name, also the port name. */
  field: string;
  kind: string;
}

export interface Extension {
  /** Stable id (`air`). */
  id: string;
  /** Node definitions registered into the app registry. */
  nodes: readonly NodeDef<unknown>[];
  /** Branches the composer may name; their ids join the branch table. */
  branches: readonly GraphBranch[];
  /** The settings keys this extension owns, one per whole-object dial. */
  dials: readonly DialSlice[];
  transient?: readonly TransientPort[];
  /**
   * Which of this extension's branches the settings imply (the derivation column of the ADR,
   * §3.4, for this extension). Called by `branchIdsFor` when no explicit set is given.
   */
  derive: (settings: DerivationSettings) => readonly string[];
}

/** The ids of the extension's branches, for validation and the `features` facet. */
export function extensionBranchIds(ext: Extension): string[] {
  return ext.branches.map((b) => b.id);
}
