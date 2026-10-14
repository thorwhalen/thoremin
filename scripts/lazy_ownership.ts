/**
 * Which packages a lazy extension OWNS, as a pure function of the module graph (#342).
 *
 * `check_lazy_bundle` calls a package owned when every importer of every module of it that the
 * build reaches is the extension's (or the package's own). "The extension's" used to mean
 * "in the closure of the extension's modules", and that closure includes the shared SDK
 * modules the extension merely reaches: an extension importing a barrel (`@thoremin/sdk/enroll`)
 * pulled the barrel's re-exports into the closure, and a library whose only importer was one
 * of them (`projection.ts` -> `umap-js`) looked owned by the extension although core's own
 * Trainer imports `projection.ts` statically.
 *
 * So an importer counts as the extension's only when it is in the extension's closure
 * (`viaExt`) AND core does not reach it on its own (`coreReach`: the closure from the app's
 * entry modules that never enters the extension). A library core reaches is shared, whatever
 * else the extension imports. Pure and graph-shaped so it is unit-tested without a build
 * (`test/lazy_ownership.test.ts`).
 */

/** The closure of `roots` along `edges`, never entering (nor passing through) a module `within` rejects. */
export function closureOf(
  roots: Iterable<string>,
  edges: (id: string) => readonly string[],
  within: (id: string) => boolean = () => true,
): Set<string> {
  const seen = new Set<string>();
  const todo = [...roots];
  while (todo.length) {
    const id = todo.pop()!;
    if (seen.has(id) || !within(id)) continue;
    seen.add(id);
    todo.push(...edges(id));
  }
  return seen;
}

export interface OwnershipInput {
  /** The packages (by directory) any module of the extension's closure belongs to. */
  candidates: Iterable<string>;
  /** Every module id the build reached, with its importers (static and dynamic). */
  importersOf: ReadonlyMap<string, readonly string[]>;
  /** The extension's closure (its deferred halves and stubs, transitively). */
  viaExt: ReadonlySet<string>;
  /** What core reaches from the app entry without entering the extension. */
  coreReach: ReadonlySet<string>;
  /** Whether a module id is inside a package directory. */
  inPackage: (dir: string, id: string) => boolean;
  /** The app's own root, never owned. */
  root: string;
}

/** The candidate packages every one of whose reached modules is imported only by the extension or the package itself. */
export function ownedPackages({ candidates, importersOf, viaExt, coreReach, inPackage, root }: OwnershipInput): string[] {
  const extensionOnly = (id: string) => viaExt.has(id) && !coreReach.has(id);
  return [...candidates].filter((dir) => {
    if (dir === root) return false;
    const mods = [...importersOf.keys()].filter((m) => inPackage(dir, m));
    return mods.every((m) => (importersOf.get(m) ?? []).every((i) => extensionOnly(i) || inPackage(dir, i)));
  });
}
