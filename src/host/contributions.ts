/**
 * The contribution registry, pure half (#600 S3; `docs/design/vertical-slices.md` §4.2): the ONE
 * place the extensions a build lists are folded into the app. Every core module that needs what
 * the extensions contribute (the node registry, the settings schema and form, the seeds, the
 * training routes, the branch table and the derivation, the lazy loader) reads it from here;
 * none of them names the extension list (`test/extensions_boundary.test.ts` enforces it, and
 * `test/helpers/fold_points.ts` lists this file and its React twin as the only fold points).
 *
 * Each contribution point has its combination rule, applied once here instead of re-done at every
 * consumer: the keyed ones (node types, branch ids, dial keys, transient fields, instrument names,
 * training routes) refuse a CLASH with an error that names both extensions; the ordered ones keep
 * `extensions.json`'s order. Core's own ids are core's business: a module that also holds core
 * ids (the settings schema, the branch table) checks an extension against them with
 * {@link assertNoCoreClash}.
 *
 * {@link foldContributions} is pure (a list in, the folded views out), so the rules are tested
 * once, on any list; {@link CONTRIBUTIONS} is that fold over this build's list. The React half
 * (panels, tools, entry points, status hooks, mount effects) is `src/app/host/contributions.ts`.
 *
 * Why here and not under `src/app/host`: the node registry (`src/nodes/browser.ts`) and the
 * settings schema (`src/settings`) read it, and those are Node-safe core that never imports the
 * app shell (`test/layering.test.ts`).
 */
import type { DialSlice, Extension, ExtensionInstrument, TrainingRoute } from '@thoremin/sdk/instruments/extension';
import type { GraphBranch } from '@thoremin/sdk/instruments/branch';
import { BRANCHES as CORE_BRANCHES } from '@/instruments/branches';
import { DEFAULT_MERGE_POOL_SIZES, type PoolSizes } from '@/nodes/mapping/synth_merge.schema';
import { DEFAULT_CHORD_POOL_SIZE } from '@/nodes/mapping/chord_select.schema';
import {
  EXTENSIONS,
  EXTENSION_SETTINGS_SHAPE,
  lazyExtensionProviding,
  loadExtensionNodes,
  loadedExtensionNodes,
  type ExtensionSettingsShape,
  type ExtensionTransients,
} from '@/extensions';

export type { ExtensionSettingsShape, ExtensionTransients };
export { lazyExtensionProviding, loadExtensionNodes, loadedExtensionNodes };

/** What the extensions contribute, folded: read-only views, in `extensions.json`'s order. */
export interface Contributions {
  /** The extensions themselves (the derivation and the node registry walk them). */
  extensions: readonly Extension[];
  /** Every dial slice; keys unique across extensions and transient fields. */
  dialSlices: readonly DialSlice[];
  /** Every branch; ids unique across extensions. */
  branches: readonly GraphBranch[];
  /** Every node type an extension defines (eager) or declares (lazy); unique. */
  nodeTypes: readonly string[];
  /** Every transient hot-store field; unique across extensions and dial keys. */
  transientFields: readonly string[];
  /** Every shipped instrument, seeded after core's own; names unique. */
  instruments: readonly ExtensionInstrument[];
  /** Every training route (ids unique) and the branch -> route table, tried before core's Trainer. */
  trainingRoutes: readonly TrainingRoute[];
  trainingByBranch: readonly (readonly [branch: string, route: string])[];
  /** The fan-in pools sized for every branch there is, core's and the extensions' (#600 S4): the
   *  merge's voice pools and the chord selector's, never below today's 8 + 2 and 3. */
  pools: { merge: PoolSizes; chords: number };
}

/**
 * Pool sizes that fit every branch composed at once: one input per declared voice of each role,
 * and per declared chord producer plus one for an explicit edge into the selector (an extension
 * that predates the chord pool wires its own), never below the defaults.
 */
export function poolSizesFor(branches: readonly GraphBranch[]): { merge: PoolSizes; chords: number } {
  const count = (role: 'instrument' | 'score') => branches.reduce((n, b) => n + b.voices.filter((v) => v.role === role).length, 0);
  const chords = branches.reduce((n, b) => n + b.chords.length, 0);
  return {
    merge: { instrument: Math.max(DEFAULT_MERGE_POOL_SIZES.instrument, count('instrument')), score: Math.max(DEFAULT_MERGE_POOL_SIZES.score, count('score')) },
    chords: Math.max(DEFAULT_CHORD_POOL_SIZE, chords + 1),
  };
}

/**
 * A keyed contribution point: each key once across all extensions. Throws on a clash, naming
 * the point, the key and both extensions.
 */
function keyed<T>(point: string, extensions: readonly Extension[], items: (e: Extension) => readonly T[], key: (t: T) => string, owners = new Map<string, string>()): T[] {
  const out: T[] = [];
  for (const e of extensions) {
    for (const item of items(e)) {
      const k = key(item);
      const owner = owners.get(k);
      if (owner !== undefined) {
        throw new Error(owner === e.id ? `extension "${e.id}" declares the ${point} "${k}" twice` : `extensions "${owner}" and "${e.id}" both declare the ${point} "${k}"`);
      }
      owners.set(k, e.id);
      out.push(item);
    }
  }
  return out;
}

/** Fold a list of extensions into the app's contribution views (pure; throws on a clash). */
export function foldContributions(extensions: readonly Extension[]): Contributions {
  // A dial key and a transient field are both a `store-controls` port and a hot-store field,
  // so they share one namespace.
  const storeFields = new Map<string, string>();
  const dialSlices = keyed('dial key or transient field', extensions, (e) => e.dials, (d) => d.key, storeFields);
  const branches = keyed('branch', extensions, (e) => e.branches, (b) => b.id);
  const transientFields = keyed('dial key or transient field', extensions, (e) => e.transient ?? [], (t) => t.field, storeFields).map((t) => t.field);
  return {
    extensions,
    dialSlices,
    transientFields,
    branches,
    nodeTypes: keyed('node type', extensions, (e) => [...(e.nodes ?? []).map((n) => n.type), ...(e.provides ?? [])], (t) => t),
    instruments: keyed('instrument', extensions, (e) => e.instruments ?? [], (i) => i.name),
    trainingRoutes: keyed('training route', extensions, (e) => e.training?.routes ?? [], (r) => r.id),
    trainingByBranch: extensions.flatMap((e) => e.training?.byBranch ?? []),
    pools: poolSizesFor([...CORE_BRANCHES, ...branches]),
  };
}

/** Refuse an extension id that reuses one of core's (`point`: what the ids are, for the message). */
export function assertNoCoreClash(point: string, coreIds: Iterable<string>, extensionIds: readonly string[]): void {
  const core = new Set(coreIds);
  const clash = extensionIds.filter((id) => core.has(id));
  if (clash.length) throw new Error(`an extension declares the ${point} ${clash.map((c) => `"${c}"`).join(', ')}, which core already uses`);
}

/** What one extension declares to the shell, keyed: the React registry's input, React-free so
 *  the rule below is tested without a DOM (`src/app/host/contributions.ts` applies it). */
export interface UiDecls {
  id: string;
  sections: readonly string[];
  tools: readonly string[];
  entryPoints: readonly string[];
}

/** Refuse a key declared twice at one of the shell's keyed points, naming both extensions. */
export function checkUiDecls(decls: readonly UiDecls[]): void {
  const labels = { sections: 'editor section', tools: 'tool', entryPoints: 'entry point' } as const;
  for (const point of ['sections', 'tools', 'entryPoints'] as const) {
    const owners = new Map<string, string>();
    for (const d of decls) {
      for (const k of d[point]) {
        const was = owners.get(k);
        if (was !== undefined) throw new Error(was === d.id ? `extension "${d.id}" declares the ${labels[point]} "${k}" twice` : `extensions "${was}" and "${d.id}" both declare the ${labels[point]} "${k}"`);
        owners.set(k, d.id);
      }
    }
  }
}

/** This build's contributions (`extensions.json`, folded once). */
export const CONTRIBUTIONS: Contributions = foldContributions(EXTENSIONS);

/** The settings-schema shape the listed extensions contribute, typed from the generated list
 *  declaration (`SettingsSchema` extends the core shape with it). */
export const SETTINGS_SHAPE: ExtensionSettingsShape = EXTENSION_SETTINGS_SHAPE;
