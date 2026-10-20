/**
 * Loading a lazy extension when a graph names its nodes (`docs/design/lazy-extensions.md`): its
 * nodes into the registry, its React half alongside, and the load reported per extension in
 * {@link useExtensionLoad} (`./extensionLoadStatus`).
 */
import { lazyLoadFailures, type NodeRegistry } from '@thoremin/dag';
import { lazyExtensionProviding } from '@/host/contributions';
import { loadExtensionUi } from '@/app/host/contributions';
import { useExtensionLoad } from './extensionLoadStatus';

export { useExtensionLoad };

/** The lazy extensions that provide `types`, by id, each once. */
function providers(types: readonly string[]): string[] {
  return [...new Set(types.map((t) => lazyExtensionProviding(t)?.id).filter((id): id is string => !!id))];
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Load the lazily declared `types` into `registry` (their extensions' nodes), and start their
 * React halves (status hooks, panels) alongside: a readout that cannot load never blocks the
 * sound, so the React half's own failure is left to its panel to show. Rejects when any
 * extension's nodes fail to load, with the registry's error (which names the failed types).
 *
 * The status is per extension (#393): when one of several fails, the others that loaded with it
 * read `ready`, and each failed one carries its own loader's message.
 */
export async function ensureLazyTypes(registry: NodeRegistry, types: readonly string[]): Promise<void> {
  const ids = providers(types);
  const { report } = useExtensionLoad.getState();
  for (const id of ids) report(id, { phase: 'loading', message: `Loading ${id}…` });
  for (const id of ids) void loadExtensionUi(id).catch(() => undefined);
  try {
    await registry.ensure(types);
  } catch (err) {
    // A failure the registry cannot attribute to groups counts against every extension asked for.
    const failures = lazyLoadFailures(err) ?? [{ types, error: err }];
    const failedMessage = new Map<string, string>();
    for (const f of failures) for (const id of providers(f.types)) if (!failedMessage.has(id)) failedMessage.set(id, messageOf(f.error));
    for (const id of ids) {
      const message = failedMessage.get(id);
      report(id, message === undefined ? { phase: 'ready', message: 'Loaded' } : { phase: 'error', message });
    }
    throw err;
  }
  for (const id of ids) report(id, { phase: 'ready', message: 'Loaded' });
}
