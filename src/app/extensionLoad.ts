/**
 * Loading a lazy extension when a graph names its nodes (`docs/design/lazy-extensions.md`): its
 * nodes into the registry, its React half alongside, and the load reported per extension in
 * {@link useExtensionLoad} (`./extensionLoadStatus`).
 */
import type { NodeRegistry } from '@thoremin/dag';
import { lazyExtensionProviding } from '@/extensions';
import { loadExtensionUi } from '@/app/extensions';
import { useExtensionLoad } from './extensionLoadStatus';

export { useExtensionLoad };

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
