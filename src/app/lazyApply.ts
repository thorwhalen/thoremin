/**
 * Applying a live graph that may name a LAZY extension's nodes (`docs/design/lazy-extensions.md`).
 *
 * The engine never awaits: it plans against a registry that must already hold every node type
 * the spec names. So the host composes, asks the registry which types are still only declared
 * (`pending`), loads them (`ensure`), and only then commits. Three rules, each pinned by a test
 * (`test/lazy_extensions.test.ts`):
 *
 *  1. Nothing pending: commit at once, synchronously, exactly as before lazy extensions existed.
 *  2. Only the LATEST request commits. A player may switch instruments twice while a chunk is
 *     fetching; the older request's continuation is dropped, and the graph composed AFTER the
 *     load (the settings may have moved on) is the one committed. Meanwhile the running graph
 *     keeps playing, the rule `applyGraph` already follows while a model prepares.
 *  3. A failed load never stops the instrument: the graph is committed without the branches
 *     that name the missing types, and the failure is reported. The next request asks again
 *     (the registry forgets a failed load), which helps a host without a module map; a browser
 *     never refetches a failed `import()` in the same page, so the app offers a reload.
 *
 * Pure: no React, no engine. `useEngine` binds it to the live engine and registry.
 */

export interface LazyApplyDeps<G> {
  /** The live graph as the settings imply it now, minus the branches naming `without`'s types. */
  compose: (without: ReadonlySet<string>) => G;
  /** The node types a composed graph names. */
  typesOf: (graph: G) => readonly string[];
  /** The types among `types` the registry has declared but not loaded. */
  pending: (types: readonly string[]) => string[];
  /** Load those types (rejects when the load fails). */
  ensure: (types: readonly string[]) => Promise<void>;
  /** Hand the graph to the engine. */
  commit: (graph: G) => void;
  /** A load failed: the graph is committed without `types`. */
  onLoadError?: (types: readonly string[], err: unknown) => void;
  /** Composing after a load threw (a composition error): nothing is committed. */
  onError?: (err: unknown) => void;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * A graph whose every node type is loaded: `compose`d as is when nothing is pending (returned
 * synchronously), else after `ensure` (recomposed, since the settings may have changed during
 * the fetch), or without the types that failed to load. Never rejects.
 */
export function composeLoaded<G>(deps: Omit<LazyApplyDeps<G>, 'commit'>, isCurrent: () => boolean = () => true, depth = 0): G | Promise<G | null> {
  const first = deps.compose(NONE);
  const missing = deps.pending(deps.typesOf(first));
  if (missing.length === 0) return first;
  // Each round loads what the CURRENT settings name; a few rounds cover settings that moved to
  // another lazy extension mid-fetch. More means a loader that resolves without registering.
  const load = depth < 3 ? deps.ensure(missing) : Promise.reject(new Error(`still not loaded after ${depth} loads: ${missing.join(', ')}`));
  return load.then(
    () => (isCurrent() ? composeLoaded(deps, isCurrent, depth + 1) : null),
    (err: unknown) => {
      if (!isCurrent()) return null;
      deps.onLoadError?.(missing, err);
      return deps.compose(new Set(missing));
    },
  );
}

/**
 * An `apply()` to call whenever the live graph should change (an instrument pick, a dial, a
 * slot). Returns a promise only when it had to load something, resolved once the request has
 * committed or been superseded.
 */
export function makeLazyApplier<G>(deps: LazyApplyDeps<G>): () => void | Promise<void> {
  let latest = 0;
  return () => {
    const seq = ++latest;
    const graph = composeLoaded(deps, () => seq === latest);
    if (!(graph instanceof Promise)) {
      deps.commit(graph);
      return;
    }
    return graph.then(
      (g) => {
        if (g !== null && seq === latest) deps.commit(g);
      },
      // The synchronous path throws to its caller; this one must not become an unhandled rejection.
      (err: unknown) => (deps.onError ?? ((e: unknown) => console.error('[thoremin] could not compose the instrument graph', e)))(err),
    );
  };
}
