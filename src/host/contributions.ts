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
import { overlayElementId, overlayImplProblems, overlayPortName, type DialSlice, type Extension, type ExtensionInstrument, type OverlayElementDecl, type OverlayElementImpl, type TrainingRoute } from '@thoremin/sdk/instruments/extension';
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
  loadedOverlayElements,
  type ExtensionSettingsShape,
  type ExtensionTransients,
} from '@/extensions';

export type { ExtensionSettingsShape, ExtensionTransients };
export { lazyExtensionProviding, loadExtensionNodes, loadedExtensionNodes, loadedOverlayElements };

/**
 * An overlay element an extension contributes, as the overlay node needs it (#600 S5): its
 * namespaced id, its declaration, the overlay port of each input (`config` among them when the
 * element declares one), and a getter for its drawing code (undefined until a lazy extension's
 * node half has loaded: the element is then simply not drawn).
 */
export interface ContributedOverlayElement {
  id: string;
  extension: string;
  decl: OverlayElementDecl;
  ports: Readonly<Record<string, string>>;
  /** Each input's port kind (`config`: the dial slice's kind). */
  kinds: Readonly<Record<string, string>>;
  impl: () => OverlayElementImpl | undefined;
}

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
  /** Every extension overlay element (#600 S5), in list order; ids unique. */
  overlayElements: readonly ContributedOverlayElement[];
}

/** Names an id is built from: no `.` (the port separator) and no `/` (the id separator). */
const BUILDING_NAME = /^[^./]+$/;

/**
 * The overlay elements of `extensions`, checked: each id once; the extension id, element names and
 * input names free of `.` and `/` (so no two generated ports can coincide); `config` reserved for
 * the declared config dial, which must be one of the extension's own slices; and an eager
 * extension's drawing code matching its declarations (a lazy one's is checked when it loads).
 */
function overlayElementsOf(extensions: readonly Extension[]): ContributedOverlayElement[] {
  for (const e of extensions) {
    if (!e.overlay?.length) continue;
    const bad = [e.id, ...e.overlay.flatMap((d) => [d.name, ...d.inputs.map((i) => i.name)])].filter((n) => !BUILDING_NAME.test(n));
    if (bad.length) throw new Error(`extension "${e.id}": overlay names may not contain "." or "/": ${bad.map((n) => `"${n}"`).join(', ')}`);
    for (const d of e.overlay) {
      const names = d.inputs.map((i) => i.name);
      if (names.includes('config')) throw new Error(`extension "${e.id}": overlay element "${d.name}" declares an input named "config", which is reserved for its config dial`);
      if (new Set(names).size !== names.length) throw new Error(`extension "${e.id}": overlay element "${d.name}" declares an input twice`);
    }
    if (!e.load) {
      const problems = overlayImplProblems(e.overlay, e.overlayElements ?? []);
      if (problems.length) throw new Error(`extension "${e.id}": ${problems.join('; ')}`);
    }
  }
  const decls = keyed('overlay element', extensions, (e) => (e.overlay ?? []).map((decl) => ({ e, decl })), ({ e, decl }) => overlayElementId(e.id, decl.name));
  return decls.map(({ e, decl }) => {
    const slice = decl.config ? e.dials.find((d) => d.key === decl.config!.dialKey) : undefined;
    if (decl.config && !slice) {
      throw new Error(`extension "${e.id}": overlay element "${decl.name}" reads its config from the dial "${decl.config.dialKey}", which is not one of its own`);
    }
    const inputs = [...decl.inputs.map((i) => i.name), ...(slice ? ['config'] : [])];
    const ports = Object.fromEntries(inputs.map((name) => [name, overlayPortName(e.id, decl.name, name)]));
    const kinds = Object.fromEntries([...decl.inputs.map((i) => [i.name, i.kind]), ...(slice ? [['config', slice.kind]] : [])]);
    let cached: OverlayElementImpl | undefined;
    const impl = (): OverlayElementImpl | undefined => (cached ??= loadedOverlayElements(e)?.find((i) => i.name === decl.name));
    return { id: overlayElementId(e.id, decl.name), extension: e.id, decl, ports, kinds, impl };
  });
}

/**
 * Deliver each composed contributed element's config dial (#600 S5): for every element in the
 * composed element set that declares `config`, the edge `<ui>.<dialKey>` -> `<overlay>.<its config
 * port>`, so no branch writes it and none can forget it. A branch edge into a config port (some
 * other dial, another extension's) is refused: an element reads only its own extension's dial.
 * Pure: returns the edges to add; throws on a refused edge.
 */
export function overlayConfigEdges(
  composed: { elements: readonly string[]; edges: readonly { from: { node: string; port: string }; to: { node: string; port: string } }[] },
  elements: readonly ContributedOverlayElement[],
  nodes: { ui: string; overlay: string },
): { from: { node: string; port: string }; to: { node: string; port: string } }[] {
  const out: { from: { node: string; port: string }; to: { node: string; port: string } }[] = [];
  const configPorts = new Set(elements.filter((c) => c.ports.config).map((c) => c.ports.config));
  for (const e of composed.edges) {
    if (e.to.node === nodes.overlay && configPorts.has(e.to.port)) throw new Error(`a branch feeds the overlay element config port "${e.to.port}"; the host delivers it from the element's own dial`);
  }
  const wanted = new Set(composed.elements);
  for (const c of elements) {
    if (!c.ports.config || !c.decl.config || !wanted.has(c.id)) continue;
    out.push({ from: { node: nodes.ui, port: c.decl.config.dialKey }, to: { node: nodes.overlay, port: c.ports.config } });
  }
  return out;
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
    overlayElements: overlayElementsOf(extensions),
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
