/**
 * The React halves of the extensions this build ships, in the same order as `EXTENSIONS`
 * (`src/extensions`). `DialsControlsPanel` folds over their panels, `useEngine` over their
 * status hooks, `App` over their mount effects.
 *
 * A LAZY extension (`docs/design/lazy-extensions.md`) lists only its stub here: its sections as
 * data, plus the `load` the build generated for its deferred half. Its panels are placeholders
 * that load that half when first rendered ({@link lazyPanel}), its status hooks join
 * {@link extensionStatusHooks} once loaded, and its mount effects run when it loads.
 */
import type { ExtensionPanel, ExtensionTool, ExtensionToolDecl, ToolEntryPointDecl, ExtensionUi, ExtensionUiStub, StatusHook, OutputReader } from '@thoremin/sdk-ui/types';
import listed from 'virtual:thoremin/extensions-ui';
import { lazyPanel, lazyToolPanel } from './lazyPanel';

type Listed = ExtensionUi | (ExtensionUiStub & { load: () => Promise<ExtensionUi> });
const isLazy = (u: Listed): u is ExtensionUiStub & { load: () => Promise<ExtensionUi> } => typeof (u as { load?: unknown }).load === 'function';

const LISTED: readonly Listed[] = (listed as readonly Listed[]).map((u, i) => {
  const ok = u && Array.isArray(u.panels) && (isLazy(u) || (Array.isArray((u as ExtensionUi).statusHooks) && Array.isArray((u as ExtensionUi).onMount)));
  if (!ok) {
    throw new Error(`extensions.json: entry ${i} does not default-export an ExtensionUi (panels, statusHooks, onMount) or, with a "lazy" entry, an ExtensionUiStub (id, panels)`);
  }
  return u;
});

/** Every listed extension's id, eager or lazy, in `extensions.json`'s order. */
export const EXTENSION_UI_IDS: readonly string[] = LISTED.map((u) => u.id);

/** What each listed extension declares to the shell, as data and with its id: the contribution
 *  registry (`src/app/host/contributions.ts`) checks the keyed points against it, naming owners. */
export const EXTENSION_UI_DECLS: readonly { id: string; sections: readonly string[]; tools: readonly string[]; entryPoints: readonly string[] }[] = LISTED.map((u) => ({
  id: u.id,
  sections: u.panels.map((p) => `${p.instrumentId} / ${p.section}`),
  tools: (u.tools ?? []).map((t) => t.id),
  entryPoints: (u.entryPoints ?? []).map((e) => e.id),
}));

/** The EAGER extensions' React halves (a lazy one's arrives through {@link loadExtensionUi}). */
export const EXTENSION_UIS: readonly ExtensionUi[] = LISTED.filter((u): u is ExtensionUi => !isLazy(u));

const loadedUis = new Map<string, ExtensionUi>();
const loadingUis = new Map<string, Promise<ExtensionUi>>();

/** How an extension's mount effect that threw is reported (the console; a test may watch it). */
const reportEffectError = (id: string, err: unknown): void => console.error(`[thoremin] a mount effect of the "${id}" extension failed`, err);

/**
 * Load a lazy extension's React half (once per page; a failed LOAD is forgotten, so the next
 * call retries). Its status hooks join {@link extensionStatusHooks} and its mount effects run,
 * once. An eager extension's half resolves at once.
 *
 * Each mount effect runs in its own try (#393): one that throws is reported and the later ones
 * still run, and the half is cached only after every effect has had its turn, so no caller is
 * ever handed a half-mounted UI. A throwing effect does not fail the load: the panels and the
 * readouts work without it.
 */
export function loadExtensionUi(id: string): Promise<ExtensionUi> {
  const eager = EXTENSION_UIS.find((u) => u.id === id);
  if (eager) return Promise.resolve(eager);
  const done = loadedUis.get(id);
  if (done) return Promise.resolve(done);
  const stub = LISTED.find((u) => u.id === id);
  if (!stub || !isLazy(stub)) return Promise.reject(new Error(`no extension "${id}" in this build`));
  let p = loadingUis.get(id);
  if (!p) {
    p = stub.load().then(
      (ui) => {
        // Its mount effects run for the rest of the page's life, like an eager one's (whose
        // cleanup only runs when the whole shell unmounts).
        for (const effect of ui.onMount) {
          try {
            effect();
          } catch (err) {
            reportEffectError(id, err);
          }
        }
        loadingUis.delete(id);
        loadedUis.set(id, ui);
        return ui;
      },
      (err: unknown) => {
        loadingUis.delete(id);
        throw err;
      },
    );
    loadingUis.set(id, p);
  }
  return p;
}

/** Every extension's editor section: an eager one's components, a lazy one's placeholders. */
export const EXTENSION_PANELS: readonly ExtensionPanel[] = LISTED.flatMap((u) =>
  isLazy(u) ? u.panels.map((decl) => lazyPanel(decl, () => loadExtensionUi(u.id), { extensionId: u.id })) : u.panels,
);

/** Every extension's shell tools, as data (eager and lazy alike), in `extensions.json`'s order. */
export const EXTENSION_TOOL_DECLS: readonly ExtensionToolDecl[] = LISTED.flatMap((u) =>
  (u.tools ?? []).map(({ id, label, description, group, defaultPinned }) => ({ id, label, description, group, defaultPinned })),
);

/** Every extension's entry points into a tool from another tool's panel (#465), as data. */
export const EXTENSION_ENTRY_POINTS: readonly ToolEntryPointDecl[] = LISTED.flatMap((u) => u.entryPoints ?? []);

/** Every extension tool's panel content, by tool id: an eager one's component, a lazy one's
 *  placeholder that loads the extension's React half when the tool first opens. */
export const EXTENSION_TOOL_PANELS: readonly { id: string; Panel: ExtensionTool['Panel'] }[] = LISTED.flatMap((u) =>
  isLazy(u)
    ? (u.tools ?? []).map((decl) => ({ id: decl.id, Panel: lazyToolPanel(decl, () => loadExtensionUi(u.id)) }))
    : (u.tools ?? []).map((t) => ({ id: t.id, Panel: t.Panel })),
);

/** The status hooks in hand now: every eager extension's, and each lazy one's once it loaded. */
export function extensionStatusHooks(): readonly StatusHook[] {
  return [...EXTENSION_UIS, ...loadedUis.values()].flatMap((u) => u.statusHooks);
}

/** The sink a hook whose `make` threw is left with: it does nothing. */
const NO_SINK = (): void => undefined;

/**
 * One engine sink that runs every status hook in hand, building each hook's sink the first
 * time it sees it, so a lazy extension that loads while the engine runs gets its readout. Every
 * hook runs even when one throws; the first error is rethrown for the Applier to report.
 *
 * A hook whose `make` throws is tried once per engine (#393): its failure is rethrown on that
 * tick only, and the hook keeps a no-op sink afterwards, instead of being rebuilt and rethrown
 * at the frame rate.
 */
export function makeExtensionSinks(engine: OutputReader): () => void {
  const made = new Map<StatusHook, () => void>();
  return () => {
    let failure: unknown = null;
    for (const hook of extensionStatusHooks()) {
      try {
        let sink = made.get(hook);
        if (!sink) {
          try {
            sink = hook.make(engine);
          } finally {
            made.set(hook, sink ?? NO_SINK);
          }
        }
        sink();
      } catch (err) {
        failure ??= err;
      }
    }
    if (failure !== null) throw failure;
  };
}

export const EXTENSION_MOUNT_EFFECTS = EXTENSION_UIS.flatMap((u) => u.onMount);
