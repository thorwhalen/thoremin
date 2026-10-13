/**
 * Loading a lazy extension when a graph names its nodes (`docs/design/lazy-extensions.md`), and
 * the status of each load, as a `LoadStatus` per extension id (`@thoremin/lazy`'s vocabulary):
 * `loading` while its chunk is fetched, `ready` once its nodes are registered, `error` when
 * the fetch failed (the next graph that names it retries).
 */
import { create } from 'zustand';
import type { NodeRegistry } from '@thoremin/dag';
import type { LoadStatus } from '@thoremin/lazy';
import { lazyExtensionProviding } from '@/extensions';
import { loadExtensionUi } from '@/app/extensions';

interface ExtensionLoadState {
  status: Readonly<Record<string, LoadStatus>>;
  report: (id: string, status: LoadStatus) => void;
}

export const useExtensionLoad = create<ExtensionLoadState>()((set) => ({
  status: {},
  report: (id, status) => set((s) => ({ status: { ...s.status, [id]: status } })),
}));

/** The lazy extensions that provide `types`, by id, each once. */
function providers(types: readonly string[]): string[] {
  return [...new Set(types.map((t) => lazyExtensionProviding(t)?.id).filter((id): id is string => !!id))];
}

/**
 * Load the lazily declared `types` into `registry` (their extensions' nodes), and start their
 * React halves (status hooks, panels) alongside: a readout that cannot load never blocks the
 * sound, so the React half's own failure is left to its panel to show. Rejects when the nodes
 * fail to load.
 */
export async function ensureLazyTypes(registry: NodeRegistry, types: readonly string[]): Promise<void> {
  const ids = providers(types);
  const { report } = useExtensionLoad.getState();
  for (const id of ids) report(id, { phase: 'loading', message: `Loading ${id}…` });
  for (const id of ids) void loadExtensionUi(id).catch(() => undefined);
  try {
    await registry.ensure(types);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const id of ids) report(id, { phase: 'error', message });
    throw err;
  }
  for (const id of ids) report(id, { phase: 'ready', message: 'Loaded' });
}
