/**
 * The heavy stages of a big categorizer, off the main thread (#499, #587).
 *
 * Two of them are slow enough to freeze the page at a few thousand holds: the re-cut's forest
 * (quadratic, 0.9 s at 3000 over 52 features) and merging a new take into the categorizer
 * (`mergeSession`, 0.3 s at 3000). Both run in one worker (`forest_worker.ts`):
 *
 * - **The forest** warms the cache. The page's re-cut stays synchronous (it asks the forest cache,
 *   building on the page only when the cache is cold); after an edit `prefetch` sends the forest's
 *   inputs to the worker and primes the cache with the answer under the key the re-cut will look
 *   for. A newer request supersedes an older one, and `whenReady` lets a caller (the slider) wait
 *   for the build in flight instead of racing it.
 * - **The merge** is a plain async call with the same result as `mergeSession`.
 *
 * Where there is no worker (a test, a browser without one) or it fails, the forest is built on the
 * page by the re-cut and the merge runs on the page: slower, never wrong. The worker is a seam:
 * `createForestPrefetcher({ build })`, `createMergeRunner({ run })`.
 */
import type { Forest } from '@thoremin/sdk/enroll/cluster';
import { pendingForest, primeForest, type ForestInputs } from '@thoremin/sdk/enroll/sorting';
import type { PersonalCategorizer, SampleInput } from '@thoremin/sdk/enroll/categorizer';
import { mergeSession, type MergeOptions, type MergeResult } from '@thoremin/sdk/enroll/from_model';
import type { RecutOptions } from '@thoremin/sdk/enroll/sorting';

export type WorkRequest =
  | { id: number; kind: 'forest'; inputs: ForestInputs }
  | { id: number; kind: 'merge'; base: PersonalCategorizer; points: SampleInput[]; options: MergeOptions };
export type WorkResponse = { id: number; forest: Forest } | { id: number; merge: MergeResult } | { id: number; error: string };
/** The forest's request, as `forest_worker.ts` first knew it. */
export type ForestRequest = Extract<WorkRequest, { kind: 'forest' }>;
export type ForestResponse = WorkResponse;

/** Builds a forest somewhere else; rejects when it cannot. */
export type ForestBuilder = (inputs: ForestInputs) => Promise<Forest>;
/** Merges a take somewhere else; rejects when it cannot. */
export type MergeRunner = (base: PersonalCategorizer, points: SampleInput[], options: MergeOptions) => Promise<MergeResult>;

/** One lazily created worker answering requests by id; null where workers do not exist. */
function workerClient(createWorker: () => Worker): (request: DistributiveOmit<WorkRequest, 'id'>) => Promise<WorkResponse> {
  let worker: Worker | null = null;
  let next = 0;
  const waiting = new Map<number, { ok: (r: WorkResponse) => void; fail: (e: Error) => void }>();
  const failAll = (e: Error) => {
    for (const w of waiting.values()) w.fail(e);
    waiting.clear();
    worker = null;
  };
  return (request) =>
    new Promise<WorkResponse>((ok, fail) => {
      try {
        if (!worker) {
          worker = createWorker();
          worker.onmessage = (e: MessageEvent<WorkResponse>) => {
            const w = waiting.get(e.data.id);
            waiting.delete(e.data.id);
            if (!w) return;
            if ('error' in e.data) w.fail(new Error(e.data.error));
            else w.ok(e.data);
          };
          worker.onerror = () => failAll(new Error('the categorizer worker failed'));
        }
        const id = ++next;
        waiting.set(id, { ok, fail });
        worker.postMessage({ ...request, id } as WorkRequest);
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });
}
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

const defaultWorker = (): Worker => new Worker(new URL('./forest_worker.ts', import.meta.url), { type: 'module' });

/** The page's one shared worker, made on first use; null where workers do not exist. */
let shared: ReturnType<typeof workerClient> | null | undefined;
function sharedClient(createWorker: () => Worker): ReturnType<typeof workerClient> | null {
  if (typeof Worker === 'undefined') return null;
  if (createWorker !== defaultWorker) return workerClient(createWorker);
  return (shared ??= workerClient(createWorker));
}

/** A forest builder on the worker; null where workers do not exist. */
export function workerForestBuilder(createWorker: () => Worker = defaultWorker): ForestBuilder | null {
  const call = sharedClient(createWorker);
  if (!call) return null;
  return async (inputs) => {
    const r = await call({ kind: 'forest', inputs });
    if (!('forest' in r)) throw new Error('the worker answered a forest request with something else');
    return r.forest;
  };
}

/** A merge runner on the worker; null where workers do not exist. */
export function workerMergeRunner(createWorker: () => Worker = defaultWorker): MergeRunner | null {
  const call = sharedClient(createWorker);
  if (!call) return null;
  return async (base, points, options) => {
    const r = await call({ kind: 'merge', base, points, options });
    if (!('merge' in r)) throw new Error('the worker answered a merge request with something else');
    return r.merge;
  };
}

export interface ForestPrefetcher {
  /** Warm the cache for a re-cut of `c`; resolves true when the forest was cached by this call. */
  prefetch(c: PersonalCategorizer, options?: RecutOptions): Promise<boolean>;
  /** Resolves when a re-cut of `c` will find its forest in the cache: now if it is there (or
   *  there is no worker, so waiting would never end), else when the build in flight for it ends. */
  whenReady(c: PersonalCategorizer, options?: RecutOptions): Promise<void>;
}

export function createForestPrefetcher({ build = workerForestBuilder() }: { build?: ForestBuilder | null } = {}): ForestPrefetcher {
  let latest = 0;
  /** The build in flight, by its cache key. */
  let inflight: { key: string; done: Promise<unknown> } | null = null;
  return {
    async prefetch(c, options = {}) {
      if (!build) return false;
      const inputs = pendingForest(c, options);
      if (!inputs) return false;
      const mine = ++latest;
      const run = (async () => {
        try {
          const forest = await build(inputs);
          if (mine !== latest) return false;
          primeForest(inputs.key, forest);
          return true;
        } catch (e) {
          console.warn('[thoremin] the forest could not be built off the page; a re-cut builds it there:', e);
          return false;
        }
      })();
      inflight = { key: inputs.key, done: run };
      return run;
    },
    async whenReady(c, options = {}) {
      if (!build) return;
      const inputs = pendingForest(c, options);
      if (!inputs) return;
      // Its build, if one is under way; else nothing is coming and the re-cut builds it itself.
      if (inflight && inflight.key === inputs.key) await inflight.done;
    },
  };
}

export interface MergeOffPage {
  /** `mergeSession(base, points, options)`, in the worker when the carve is big enough to
   *  matter (`offPageFrom` samples) and a worker can be had, else on the page. */
  merge: MergeRunner;
}

/** Holds a carve is small enough to merge on the page (a few ms), so no round trip is paid. */
export const MERGE_OFF_PAGE_FROM = 300;

export function createMergeRunner({ run = workerMergeRunner(), offPageFrom = MERGE_OFF_PAGE_FROM }: { run?: MergeRunner | null; offPageFrom?: number } = {}): MergeOffPage {
  return {
    async merge(base, points, options) {
      if (run && base.samples.length >= offPageFrom) {
        try {
          return await run(base, points, options);
        } catch (e) {
          // A validation error is the caller's to report; the worker failing to run is not.
          if (!/worker/.test(String((e as Error)?.message))) throw e;
          console.warn('[thoremin] the merge could not run off the page; running it here:', e);
        }
      }
      return mergeSession(base, points, options);
    },
  };
}
