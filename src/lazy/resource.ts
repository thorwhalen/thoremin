/**
 * `lazyResource` — the one state machine behind every "load the heavy thing only
 * when asked, and say where you are" node (#188).
 *
 * Extracted, not invented. `webcam-face`, `midi-out` and the recording formats each
 * hand-roll the same five rules, and the bugs #147's adversarial review found were
 * bugs in that hand-rolling (a superseded open attaching a device; a disabled node
 * holding a port). The rules, each pinned by a test in `test/lazy_resource.test.ts`:
 *
 *   1. **Request once.** `request()` on every tick starts at most one load.
 *   2. **A late arrival is discarded.** A load that resolves after `release()` or
 *      `dispose()` is unloaded on arrival, never attached.
 *   3. **A failure is not re-hammered.** After `unavailable` / `error`, `request()`
 *      is a no-op until `release()` — one bad key must not open a socket per frame.
 *   4. **Re-enable retries.** `release()` clears the failure, so disable → enable is
 *      the player's "try again".
 *   5. **Never throw.** A rejecting loader becomes an `error` status; `process()`
 *      runs every frame and one throw would take the instrument down.
 *
 * The API is synchronous on purpose: a node's `process()` calls `want(enabled)` and
 * `current()` each tick and never awaits. The *loader* is the seam — a host-injected
 * factory in tests and custom hosts, a dynamic `import()` of a browser-only sibling
 * module by default (`midi_engine.ts`, `lyria_engine.ts`). Pure and Node-safe: no
 * DAG, no DOM, no vendor import.
 */
import type { LoadStatus } from './status';

/** What a loader resolves: the thing, or an actionable reason it cannot be had. */
export type LoadResult<T> =
  | { resource: T; message?: string }
  | { resource: null; reason: string; message?: string };

/** What a loader receives. `signal` aborts when the request is released mid-load, so
 *  a loader that can stop a download early should; `progress` drives the readout. */
export interface LoadContext {
  signal: AbortSignal;
  progress: (fraction: number) => void;
}

export type Loader<T> = (ctx: LoadContext) => Promise<LoadResult<T>>;

export interface LazyResourceOptions<T> {
  /** The seam: the injected factory, or the default `() => import(...)`. */
  load: Loader<T>;
  /** Close / dispose the held thing (also called on a late arrival). */
  unload?: (resource: T) => void;
  /** A noun for the default messages ("MIDI output", "generative engine"). */
  label?: string;
  /** Where a failure is reported once (the node's `ctx.log`, or `console.warn`). */
  log?: (msg: string) => void;
}

export interface LazyResource<T> {
  /** Start loading if nothing is loaded, loading, or failed since the last release. */
  request(): void;
  /** Drop the held thing (or the in-flight load) and clear any failure. */
  release(): void;
  /** `request()` when `enabled`, else `release()` — the per-tick line. */
  want(enabled: boolean): void;
  /** The loaded thing, synchronously, or null. */
  current(): T | null;
  /** The status-port value. `ready` when `current()` is non-null. */
  status(): LoadStatus;
  /** Release and refuse every later arrival. Terminal. */
  dispose(): void;
}

const _messages = (label: string) => ({
  off: `${label} off`,
  loading: `Loading ${label}...`,
  ready: `${label} ready`,
  unavailable: `${label} is not available here`,
  error: `Could not load ${label}`,
});

export function lazyResource<T>(opts: LazyResourceOptions<T>): LazyResource<T> {
  const label = opts.label ?? 'resource';
  const msg = _messages(label);
  const unload = opts.unload ?? (() => {});

  let held: T | null = null;
  let loading = false;
  let attempted = false; // a load settled (any outcome) since the last release
  let disposed = false;
  let gen = 0; // bumped by release(): a load from an older generation is a late arrival
  let controller: AbortController | null = null;
  let status: LoadStatus = { phase: 'off', message: msg.off };
  let progress = 0;

  type Outcome = { kind: 'result'; res: LoadResult<T> } | { kind: 'error'; error: unknown };

  const settle = (myGen: number, outcome: Outcome): void => {
    loading = false;
    if (myGen !== gen || disposed) {
      // Rule 2: released or disposed while loading — never attach, never mark attempted
      // (so the NEXT request after the release starts fresh instead of staying wedged).
      if (outcome.kind === 'result' && outcome.res.resource !== null) unload(outcome.res.resource);
      return;
    }
    attempted = true;
    if (outcome.kind === 'error') {
      const detail = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      status = { phase: 'error', reason: 'error', message: detail ? `${msg.error}: ${detail}` : msg.error };
      opts.log?.(`[lazy] ${label}: ${detail}`);
      return;
    }
    const res = outcome.res;
    if (res.resource === null) {
      const { reason, message } = res as { resource: null; reason: string; message?: string };
      status = { phase: 'unavailable', reason, message: message ?? msg.unavailable };
      return;
    }
    held = res.resource;
    status = { phase: 'ready', message: res.message ?? msg.ready };
  };

  return {
    request() {
      if (disposed || held || loading || attempted) return;
      loading = true;
      progress = 0;
      const myGen = gen;
      controller = new AbortController();
      status = { phase: 'loading', message: msg.loading, progress };
      const ctx: LoadContext = {
        signal: controller.signal,
        progress: (f) => {
          if (myGen !== gen) return;
          progress = Math.min(1, Math.max(0, f));
          if (status.phase === 'loading') status = { ...status, progress };
        },
      };
      let p: Promise<LoadResult<T>>;
      try {
        p = Promise.resolve(opts.load(ctx));
      } catch (err) {
        // Rule 5: a loader that throws synchronously is a rejected load, not our throw.
        p = Promise.reject(err);
      }
      p.then(
        (res) => settle(myGen, { kind: 'result', res }),
        (error) => settle(myGen, { kind: 'error', error }),
      );
    },
    release() {
      gen++;
      controller?.abort();
      controller = null;
      loading = false;
      attempted = false; // Rule 4
      if (held !== null) {
        const h = held;
        held = null;
        unload(h);
      }
      status = { phase: 'off', message: msg.off };
    },
    want(enabled) {
      if (enabled) this.request();
      else if (held !== null || loading || attempted) this.release();
    },
    current: () => held,
    status: () => status,
    dispose() {
      this.release();
      disposed = true;
    },
  };
}
