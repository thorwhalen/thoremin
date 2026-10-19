/**
 * Build the re-cut forest of a big categorizer off the main thread (#499, #587).
 *
 * The page's re-cut stays synchronous (it asks the forest cache, building on the page only when
 * the cache is cold). This warms the cache: after an edit, `prefetch` sends the forest's inputs
 * to a worker and, when it answers, puts the result in the cache under the key the re-cut will
 * look for. A newer request supersedes an older one (only the latest result is cached), and where
 * there is no worker (a test, a browser without one) it does nothing: the re-cut builds on the
 * page, as before. The builder is a seam: `createForestPrefetcher({ build })`.
 */
import type { Forest } from '@thoremin/sdk/enroll/cluster';
import { pendingForest, primeForest, type ForestInputs } from '@thoremin/sdk/enroll/sorting';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { RecutOptions } from '@thoremin/sdk/enroll/sorting';

export interface ForestRequest {
  id: number;
  inputs: ForestInputs;
}
export type ForestResponse = { id: number; forest: Forest } | { id: number; error: string };

/** Builds a forest somewhere else; rejects when it cannot. */
export type ForestBuilder = (inputs: ForestInputs) => Promise<Forest>;

export interface ForestPrefetcher {
  /** Warm the cache for a re-cut of `c`; resolves true when the forest was cached by this call. */
  prefetch(c: PersonalCategorizer, options?: RecutOptions): Promise<boolean>;
}

/** A builder on one lazily created worker; null where workers do not exist. */
export function workerForestBuilder(createWorker: () => Worker = () => new Worker(new URL('./forest_worker.ts', import.meta.url), { type: 'module' })): ForestBuilder | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker | null = null;
  let next = 0;
  const waiting = new Map<number, { ok: (f: Forest) => void; fail: (e: Error) => void }>();
  const failAll = (e: Error) => {
    for (const w of waiting.values()) w.fail(e);
    waiting.clear();
    worker = null;
  };
  return (inputs) =>
    new Promise<Forest>((ok, fail) => {
      try {
        if (!worker) {
          worker = createWorker();
          worker.onmessage = (e: MessageEvent<ForestResponse>) => {
            const w = waiting.get(e.data.id);
            waiting.delete(e.data.id);
            if (!w) return;
            if ('forest' in e.data) w.ok(e.data.forest);
            else w.fail(new Error(e.data.error));
          };
          worker.onerror = () => failAll(new Error('the forest worker failed'));
        }
        const id = ++next;
        waiting.set(id, { ok, fail });
        worker.postMessage({ id, inputs } satisfies ForestRequest);
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });
}

export function createForestPrefetcher({ build = workerForestBuilder() }: { build?: ForestBuilder | null } = {}): ForestPrefetcher {
  let latest = 0;
  return {
    async prefetch(c, options = {}) {
      if (!build) return false;
      const inputs = pendingForest(c, options);
      if (!inputs) return false;
      const mine = ++latest;
      try {
        const forest = await build(inputs);
        if (mine !== latest) return false;
        primeForest(inputs.key, forest);
        return true;
      } catch (e) {
        console.warn('[thoremin] the forest could not be built off the page; a re-cut builds it there:', e);
        return false;
      }
    },
  };
}
