/**
 * The extensions this build ships, as data (seam 4 of the instruments-as-graphs ADR):
 * `extensions.json` names them and `vite.extensions.ts` injects them at build time as a
 * virtual module; after the repository split the same file names registry packages. Every registry the app used to
 * hand-list is a fold over this array: `createAppRegistry`, `ALL_BRANCHES`,
 * `SettingsSchema`, the dials form, `store-controls`' ports, `branchIdsFor` (all bound in
 * `src/app/graph.ts` and the other fold points, never in the pure `src/instruments`).
 *
 * The list is TYPED per build too: `npm run extensions` generates the virtual module's
 * declaration from the same file (a tuple of the listed manifests' own types), and
 * {@link ExtensionSettingsShape} is computed from it. That is how the `Settings` type knows
 * `airDrum` without core importing the air extension.
 *
 * Pure: the React halves are listed in `src/app/extensions`.
 */
import { extensionsSettingsShape, type DialSlice, type Extension, type ExtensionNodes, type ExtensionsSettingsShape, type ExtensionsTransients } from '@thoremin/sdk/instruments/extension';
import listed from 'virtual:thoremin/extensions';

type Listed = typeof listed;

function checked<Es extends readonly Extension[]>(es: Es): Es {
  es.forEach((e, i) => {
    // The virtual module's type is a declaration, not a check: a listed module with no default
    // export arrives here as `undefined`, and only the production build would say so.
    if (typeof e?.id !== 'string' || !Array.isArray(e.branches) || !Array.isArray(e.dials)) {
      throw new Error(`extensions.json: entry ${i} does not default-export an Extension (id, branches, dials)`);
    }
    // Eager: the nodes are in the manifest. Lazy: the stub names them (`provides`) and the
    // build gave it `load` from the `lazy` entry; the two always come together.
    const lazy = typeof e.load === 'function';
    if (lazy !== Array.isArray(e.provides)) {
      throw new Error(
        lazy
          ? `extensions.json: "${e.id}" has a "lazy" entry but its manifest names no \`provides\` (the node types its deferred half defines)`
          : `extensions.json: "${e.id}" names \`provides\` (a lazy extension's stub) but has no "lazy" entry to load them from`,
      );
    }
    // A lazy extension may provide no node at all: a TOOL-only extension (#330, the face
    // categorizer session), whose deferred halves are its React tool and an empty node list.
    if (lazy ? e.nodes !== undefined : !Array.isArray(e.nodes)) {
      throw new Error(`extensions.json: "${e.id}" must have either \`nodes\` (eager) or \`provides\` and no \`nodes\` (lazy)`);
    }
  });
  return es;
}

/** The extensions `extensions.json` names, in its order (injected at build time). */
export const EXTENSIONS: Listed = checked(listed);

// Widened for the folds: over an EMPTY tuple (a build without extensions) `flatMap` would
// type its element as `never`.
const all: readonly Extension[] = EXTENSIONS;

/** Every extension's dial slices, in extension order (what the settings schema spreads). */
export const EXTENSION_DIAL_SLICES: readonly DialSlice[] = all.flatMap((e) => e.dials);

/** Every extension's branch, in extension order. */
export const EXTENSION_BRANCHES = all.flatMap((e) => e.branches);

/** The hot-store fields the listed extensions declare as transient (`{ airGuitarModel:
 *  TrainedModel | null, ... }`), typed from the generated list declaration like the settings. */
export type ExtensionTransients = ExtensionsTransients<Listed>;
/** Every extension's transient field names, in extension order. */
export const EXTENSION_TRANSIENT_FIELDS: readonly string[] = all.flatMap((e) => (e.transient ?? []).map((t) => t.field));

/** Every extension's training routes, and its branch → route table, in extension order. */
export const EXTENSION_TRAINING_ROUTES = all.flatMap((e) => e.training?.routes ?? []);
export const EXTENSION_TRAINING_BY_BRANCH = all.flatMap((e) => e.training?.byBranch ?? []);

/** Every extension's shipped instrument, in extension order (seeded after core's own). */
export const EXTENSION_INSTRUMENTS = all.flatMap((e) => e.instruments ?? []);

/** The settings-schema shape the listed extensions contribute (`{ airDrum: <schema>, ... }`),
 *  typed from the generated list declaration. `SettingsSchema` extends the core shape with it. */
export type ExtensionSettingsShape = ExtensionsSettingsShape<Listed>;
export const EXTENSION_SETTINGS_SHAPE: ExtensionSettingsShape = extensionsSettingsShape(EXTENSIONS);

/**
 * A LAZY extension's node definitions, loaded once per page and shared by every registry
 * (`docs/design/lazy-extensions.md`): the first call runs the build's `import()`, later calls
 * reuse it, and a failed load is forgotten so the next call retries. {@link loadedExtensionNodes}
 * is the synchronous view, so a registry built after the load (a new engine) registers the
 * nodes at once instead of declaring them again.
 */
const nodesLoaded = new Map<string, ExtensionNodes['nodes']>();
const nodesLoading = new Map<string, Promise<ExtensionNodes['nodes']>>();

export function loadExtensionNodes(e: Extension): Promise<ExtensionNodes['nodes']> {
  const done = nodesLoaded.get(e.id);
  if (done) return Promise.resolve(done);
  if (!e.load) return Promise.resolve(e.nodes ?? []);
  let p = nodesLoading.get(e.id);
  if (!p) {
    p = e.load().then(
      (m) => {
        nodesLoaded.set(e.id, m.nodes);
        nodesLoading.delete(e.id);
        return m.nodes;
      },
      (err: unknown) => {
        nodesLoading.delete(e.id);
        throw err;
      },
    );
    nodesLoading.set(e.id, p);
  }
  return p;
}

/** The node definitions of `e` if they are in hand: an eager extension's always, a lazy one's
 *  once {@link loadExtensionNodes} has resolved; `undefined` before that. */
export function loadedExtensionNodes(e: Extension): ExtensionNodes['nodes'] | undefined {
  return e.load ? nodesLoaded.get(e.id) : (e.nodes ?? []);
}

/** The listed extension that provides node type `type` lazily, if any. */
export function lazyExtensionProviding(type: string): Extension | undefined {
  return all.find((e) => e.provides?.includes(type));
}
