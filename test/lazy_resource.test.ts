/**
 * The five rules of `lazyResource` (#188), each pinned so the next heavy node does
 * not re-make the bugs the hand-rolled copies made: request once, discard a late
 * arrival, do not re-hammer a failure, retry on re-enable, never throw. Plus the
 * status vocabulary and `withActive`.
 */
import { describe, it, expect } from 'vitest';
import { lazyResource, withActive, type LoadResult, type LoadContext } from '@/lazy';

/** A loader whose resolution the test controls. */
function deferredLoader<T>() {
  let resolve!: (r: LoadResult<T>) => void;
  let reject!: (e: unknown) => void;
  const calls: LoadContext[] = [];
  const load = (ctx: LoadContext) => {
    calls.push(ctx);
    return new Promise<LoadResult<T>>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  };
  return { load, calls, resolve: (r: LoadResult<T>) => resolve(r), reject: (e: unknown) => reject(e) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('lazyResource', () => {
  it('rule 1: request() on every tick starts exactly one load, and reports loading then ready', async () => {
    const d = deferredLoader<{ id: number }>();
    const r = lazyResource({ load: d.load, label: 'thing' });
    expect(r.status()).toEqual({ phase: 'off', message: 'thing off' });
    for (let i = 0; i < 30; i++) r.request();
    expect(d.calls).toHaveLength(1);
    expect(r.status().phase).toBe('loading');
    expect(r.current()).toBeNull();
    d.resolve({ resource: { id: 1 } });
    await flush();
    expect(r.current()).toEqual({ id: 1 });
    expect(r.status()).toEqual({ phase: 'ready', message: 'thing ready' });
    r.request(); // already held: no second load
    expect(d.calls).toHaveLength(1);
  });

  it('rule 2: a load that resolves after release() is unloaded on arrival, never attached', async () => {
    const d = deferredLoader<string>();
    const unloaded: string[] = [];
    const r = lazyResource({ load: d.load, unload: (s) => unloaded.push(s) });
    r.request();
    expect(d.calls[0].signal.aborted).toBe(false);
    r.release();
    expect(d.calls[0].signal.aborted).toBe(true);
    d.resolve({ resource: 'late' });
    await flush();
    expect(r.current()).toBeNull();
    expect(unloaded).toEqual(['late']);
    expect(r.status().phase).toBe('off');
    // ...and the next request starts a FRESH load rather than staying wedged.
    r.request();
    expect(d.calls).toHaveLength(2);
  });

  it('rule 2 (dispose): a load resolving after dispose() is unloaded, and dispose is terminal', async () => {
    const d = deferredLoader<string>();
    const unloaded: string[] = [];
    const r = lazyResource({ load: d.load, unload: (s) => unloaded.push(s) });
    r.request();
    r.dispose();
    d.resolve({ resource: 'late' });
    await flush();
    expect(unloaded).toEqual(['late']);
    r.request();
    expect(d.calls).toHaveLength(1);
    expect(r.current()).toBeNull();
  });

  it('rule 3: an unavailable result is reported with its reason and not re-requested every tick', async () => {
    const d = deferredLoader<string>();
    const r = lazyResource({ load: d.load, label: 'engine' });
    r.request();
    d.resolve({ resource: null, reason: 'no-key', message: 'Add an API key to enable the engine' });
    await flush();
    expect(r.status()).toEqual({ phase: 'unavailable', reason: 'no-key', message: 'Add an API key to enable the engine' });
    for (let i = 0; i < 10; i++) r.request();
    expect(d.calls).toHaveLength(1);
  });

  it('rule 4: release() after a failure clears it, so disable -> enable retries', async () => {
    const d = deferredLoader<string>();
    const r = lazyResource({ load: d.load });
    r.request();
    d.resolve({ resource: null, reason: 'denied' });
    await flush();
    r.release();
    r.request();
    expect(d.calls).toHaveLength(2);
    d.resolve({ resource: 'ok' });
    await flush();
    expect(r.current()).toBe('ok');
  });

  it('rule 5: a rejecting loader becomes an error status (logged once) and nothing throws', async () => {
    const d = deferredLoader<string>();
    const logs: string[] = [];
    const r = lazyResource({ load: d.load, label: 'model', log: (m) => logs.push(m) });
    r.request();
    d.reject(new Error('network down'));
    await flush();
    expect(r.status()).toEqual({ phase: 'error', reason: 'error', message: 'Could not load model: network down' });
    expect(logs).toEqual(['[lazy] model: network down']);
    r.request(); // not re-hammered
    expect(d.calls).toHaveLength(1);
  });

  it('rule 5: a loader that throws synchronously is an error, not a throw from request()', async () => {
    const r = lazyResource<string>({
      load: () => {
        throw new Error('boom');
      },
    });
    expect(() => r.request()).not.toThrow();
    await flush();
    expect(r.status().phase).toBe('error');
  });

  it('reports loader progress while loading, clamped to 0..1, and ignores progress from a released load', async () => {
    const d = deferredLoader<string>();
    const r = lazyResource({ load: d.load });
    r.request();
    d.calls[0].progress(0.25);
    expect(r.status()).toMatchObject({ phase: 'loading', progress: 0.25 });
    d.calls[0].progress(7);
    expect(r.status().progress).toBe(1);
    r.release();
    d.calls[0].progress(0.5);
    expect(r.status().phase).toBe('off');
  });

  it('want(enabled) is the per-tick line: enabling requests, disabling releases, toggling retries', async () => {
    const d = deferredLoader<string>();
    const unloaded: string[] = [];
    const r = lazyResource({ load: d.load, unload: (s) => unloaded.push(s) });
    r.want(false);
    r.want(false);
    expect(d.calls).toHaveLength(0);
    r.want(true);
    r.want(true);
    expect(d.calls).toHaveLength(1);
    d.resolve({ resource: 'a' });
    await flush();
    expect(r.current()).toBe('a');
    r.want(false);
    expect(unloaded).toEqual(['a']);
    expect(r.current()).toBeNull();
    r.want(true);
    expect(d.calls).toHaveLength(2);
  });

  it('unload is called for a held resource on release, and only once', async () => {
    const d = deferredLoader<string>();
    const unloaded: string[] = [];
    const r = lazyResource({ load: d.load, unload: (s) => unloaded.push(s) });
    r.request();
    d.resolve({ resource: 'held' });
    await flush();
    r.release();
    r.release();
    r.dispose();
    expect(unloaded).toEqual(['held']);
  });
});

describe('withActive', () => {
  it('promotes ready to active, with an optional message, and leaves every other phase alone', () => {
    const ready = { phase: 'ready' as const, message: 'engine ready' };
    expect(withActive(ready, true, 'Playing')).toEqual({ phase: 'active', message: 'Playing' });
    expect(withActive(ready, true)).toEqual({ phase: 'active', message: 'engine ready' });
    expect(withActive(ready, false)).toBe(ready);
    const loading = { phase: 'loading' as const, message: 'Loading' };
    expect(withActive(loading, true)).toBe(loading);
  });
});
