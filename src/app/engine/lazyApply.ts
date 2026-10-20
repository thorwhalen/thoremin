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
 *     that name the types that FAILED (an extension that loaded alongside a failing one keeps
 *     its branches, #393), and the failure is reported. The next request asks again
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
  /** Load those types (rejects when a load fails). A rejection carrying `failedTypes` (the
   *  registry's `LazyLoadError`) says which types failed, the rest having loaded; any other
   *  rejection counts every requested type as failed. */
  ensure: (types: readonly string[]) => Promise<void>;
  /** Hand the graph to the engine. */
  commit: (graph: G) => void;
  /** A load failed: the graph is committed without `types` (the ones that failed). */
  onLoadError?: (types: readonly string[], err: unknown) => void;
  /** Composing after a load threw (a composition error): nothing is committed. */
  onError?: (err: unknown) => void;
}

const NONE: ReadonlySet<string> = new Set();

/** Load rounds before giving up (the default of {@link ComposeLoadedOptions.maxRounds}): a few cover settings that moved to another lazy extension
 *  mid-fetch; more means a loader that resolves without registering. */
const MAX_LOAD_ROUNDS = 3;

/** The types among `missing` that a rejected `ensure` says failed (all of them when it says
 *  nothing more precise). */
function failedAmong(missing: readonly string[], err: unknown): string[] {
  const named = (err as { failedTypes?: unknown } | null)?.failedTypes;
  if (!Array.isArray(named)) return [...missing];
  const failed = missing.filter((t) => named.includes(t));
  return failed.length > 0 ? failed : [...missing];
}

export interface ComposeLoadedOptions {
  /** Load rounds before giving up and leaving out whatever is still pending (default
   *  {@link MAX_LOAD_ROUNDS}). */
  maxRounds?: number;
}

/**
 * A graph whose every node type is loaded: `compose`d as is when nothing is pending (returned
 * synchronously), else after `ensure` (recomposed, since the settings may have changed during
 * the fetch), or without the types that failed to load. Never rejects.
 */
export function composeLoaded<G>(
  deps: Omit<LazyApplyDeps<G>, 'commit'>,
  isCurrent: () => boolean = () => true,
  { maxRounds = MAX_LOAD_ROUNDS }: ComposeLoadedOptions = {},
): G | Promise<G | null> {
  /**
   * One round. `depth` counts the loads so far; `without` holds the types already known to have
   * failed in this request (left out of every later round, so a partial failure recomposes with
   * what did load).
   */
  const round = (depth: number, without: ReadonlySet<string>): G | Promise<G | null> => {
    const graph = deps.compose(without);
    const missing = deps.pending(deps.typesOf(graph));
    if (missing.length === 0) return graph;
    // Each round loads what the CURRENT settings name.
    const exhausted = depth >= maxRounds;
    const load = exhausted ? Promise.reject(new Error(`still not loaded after ${depth} loads: ${missing.join(', ')}`)) : deps.ensure(missing);
    return load.then(
      () => (isCurrent() ? round(depth + 1, without) : null),
      (err: unknown) => {
        if (!isCurrent()) return null;
        const failed = exhausted ? [...missing] : failedAmong(missing, err);
        deps.onLoadError?.(failed, err);
        const next = new Set([...without, ...failed]);
        // Out of rounds: leave out everything still missing. Otherwise recompose without only the
        // failed types, and load whatever else that graph still names.
        return exhausted ? deps.compose(new Set([...next, ...missing])) : round(depth + 1, next);
      },
    );
  };
  return round(0, NONE);
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
