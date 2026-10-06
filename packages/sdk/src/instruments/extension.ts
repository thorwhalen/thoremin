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
 * the physical move (5b) followed, and since the follow-ups to PR 6 the air extension is the `@thoremin/ext-air` package; the original note: the move follows once the trainer stream is done
 * with `src/air`. The manifest is what makes the move a `git mv`.
 */
import type { z } from 'zod';
import type { NodeDef } from '@thoremin/dag';
import type { GraphBranch } from './branch';

/**
 * A whole-object dial the extension owns: one top-level key of the settings schema.
 * Generic in its key and schema so the `Settings` TYPE can be computed from the manifests
 * ({@link ExtensionsSettingsShape}); build one with {@link dialSlice} to keep the literal key.
 */
export interface DialSlice<K extends string = string, S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** The settings key (`airDrum`), also the `store-controls` port name. */
  key: K;
  /** The Zod object schema of the dial, with its `.default(...)`: its defaults are the
   *  dial's defaults, and a settings blob saved before the extension existed stays valid. */
  schema: S;
  /** The `store-controls` port kind (`air-drum-config`). */
  kind: string;
  /** The dials metadata the settings form and the palette show. */
  meta: { facets: string[]; title: string; description: string };
}

/** A {@link DialSlice} with its key kept literal (`'airDrum'`, not `string`). */
export function dialSlice<const K extends string, S extends z.ZodTypeAny>(slice: DialSlice<K, S>): DialSlice<K, S> {
  return slice;
}

/** The settings an extension's `derive` reads: the whole settings object, typed opaquely here
 *  because its core keys are core's business. An extension reads its OWN dials from it (it
 *  knows their types: they are its dial slices). */
export type ExtensionDerivationSettings = Readonly<Record<string, unknown>>;

/** A transient hot-store field the extension reads through a `store-controls` port
 *  (a learned model, a status): always emitted, `null` when absent, so a clear reaches
 *  the node. */
export interface TransientPort<F extends string = string, T = unknown> {
  /** The hot-store field name, also the port name. */
  field: F;
  kind: string;
  /** Phantom: the field's value type (never set at runtime), so the hot store's TYPE can carry
   *  the field without core naming it. Build with {@link transientPort}. */
  readonly __value?: T;
}

/** A {@link TransientPort} with its field name literal and its value type kept:
 *  `transientPort<TrainedModel>()('airGuitarModel', 'shape-model')`. */
export function transientPort<T>() {
  return <const F extends string>(field: F, kind: string): TransientPort<F, T> => ({ field, kind });
}

/**
 * A shipped instrument an extension contributes: a name and a PATCH over the default settings,
 * deep-merged by core's seeder (objects merge key by key, anything else replaces), then
 * validated by the settings schema. A patch, not a full snapshot, because the defaults are
 * core's: the extension states only what its instrument changes.
 */
export interface ExtensionInstrument {
  name: string;
  patch: Readonly<Record<string, unknown>>;
}

/** Where "train this instrument" goes (`src/app/training/routes.ts` resolves a spec to one). */
export interface TrainingRoute {
  id: string;
  /** What the link says. */
  label: string;
  /** One line under it. */
  hint: string;
  /** A section route: the settings section's `data-section` label and the trainer's DOM id. */
  section?: { label: string; anchor: string };
  /** A tool route: the shell tool to open. */
  tool?: string;
}

/** The training an extension's instruments offer: its routes, and which of its branches leads
 *  to which route, in the order a lead instrument is looked for. */
export interface ExtensionTraining {
  routes: readonly TrainingRoute[];
  byBranch: readonly (readonly [branch: string, route: string])[];
}

export interface Extension<D extends readonly DialSlice[] = readonly DialSlice[], Tr extends readonly TransientPort[] = readonly TransientPort[]> {
  /** Stable id (`air`). */
  id: string;
  /** Node definitions registered into the app registry. */
  nodes: readonly NodeDef<unknown>[];
  /** Branches the composer may name; their ids join the branch table. */
  branches: readonly GraphBranch[];
  /** The settings keys this extension owns, one per whole-object dial. */
  dials: D;
  transient?: Tr;
  /** The instruments it ships, appended to core's seeds in this order. */
  instruments?: readonly ExtensionInstrument[];
  /** Its training routes, tried before core's Trainer tool. */
  training?: ExtensionTraining;
  /**
   * Which of this extension's branches the settings imply (the derivation column of the ADR,
   * §3.4, for this extension). Called by `branchIdsFor` when no explicit set is given.
   */
  derive: (settings: ExtensionDerivationSettings) => readonly string[];
}

/** An {@link Extension} with its dial slices' types kept, so the settings type can read them. */
export function defineExtension<const D extends readonly DialSlice[], const Tr extends readonly TransientPort[] = readonly []>(ext: Extension<D, Tr>): Extension<D, Tr> {
  return ext;
}

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;
type SliceShape<S> = S extends DialSlice<infer K, infer Z> ? { [P in K]: Z } : never;
/** `true` for a slice whose key widened to `string` (declared without {@link dialSlice}). */
type LooseSlice<S> = S extends DialSlice<infer K, z.ZodTypeAny> ? (string extends K ? true : never) : never;

/** What a loosely typed manifest folds to: not a shape, so `CoreSettingsSchema.extend(...)` fails
 *  to typecheck, loudly, instead of the whole `Settings` type silently widening to `unknown`. */
export interface LooseExtensionDials {
  error: 'an extension dial key widened to string: build the slices with dialSlice() and the manifest with defineExtension()';
}

/**
 * The settings-schema SHAPE a list of extensions contributes (`{ airDrum: <its schema>, ... }`),
 * computed from the manifests' TYPES: what `SettingsSchema` extends the core shape with, and
 * so what the `Settings` type knows. An empty list contributes `{}`.
 */
export type ExtensionsSettingsShape<Es extends readonly Extension[]> = [Es[number]['dials'][number]] extends [never]
  ? Record<never, never>
  : [LooseSlice<Es[number]['dials'][number]>] extends [never]
    ? UnionToIntersection<SliceShape<Es[number]['dials'][number]>>
    : LooseExtensionDials;

type TransientShape<P> = P extends TransientPort<infer F, infer T> ? (string extends F ? never : { [K in F]: T | null }) : never;
type TransientsOf<E> = E extends Extension<readonly DialSlice[], infer Tr> ? Tr[number] : never;

/**
 * The hot-store fields a list of extensions declares as transient (`{ airGuitarModel:
 * TrainedModel | null, ... }`), computed from the manifests' TYPES like the settings shape. Each
 * is `null` when absent. An empty list (or a port declared without {@link transientPort})
 * contributes nothing.
 */
export type ExtensionsTransients<Es extends readonly Extension[]> = [TransientShape<TransientsOf<Es[number]>>] extends [never]
  ? Record<never, never>
  : UnionToIntersection<TransientShape<TransientsOf<Es[number]>>>;

/** The runtime value of {@link ExtensionsSettingsShape}: one entry per dial slice, keyed by its key. */
export function extensionsSettingsShape<Es extends readonly Extension[]>(extensions: Es): ExtensionsSettingsShape<Es> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const slice of extensions.flatMap((e) => e.dials)) {
    if (slice.key in shape) throw new Error(`extensions: the dial key "${slice.key}" is declared twice`);
    shape[slice.key] = slice.schema;
  }
  return shape as ExtensionsSettingsShape<Es>;
}

/** The ids of the extension's branches, for validation and the `features` facet. */
export function extensionBranchIds(ext: Extension): string[] {
  return ext.branches.map((b) => b.id);
}
