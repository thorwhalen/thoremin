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

  it('rule 1+2 (review catch, stale settle first): the old load resolving does not clear the new load or let want(false) skip the release', async () => {
    // Per-call resolvers, so the OLD load can settle while the NEW one is in flight.
    const resolvers: Array<(r: LoadResult<string>) => void> = [];
    const signals: AbortSignal[] = [];
    const unloaded: string[] = [];
    const r = lazyResource<string>({
      load: (ctx) => {
        signals.push(ctx.signal);
        return new Promise((res) => resolvers.push(res));
      },
      unload: (s) => unloaded.push(s),
    });
    r.want(true); // A
    r.want(false);
    r.want(true); // B
    expect(resolvers).toHaveLength(2);
    resolvers[0]({ resource: 'A' }); // A settles late, B still loading
    await flush();
    expect(unloaded).toEqual(['A']);
    expect(r.status().phase).toBe('loading'); // B's phase, untouched by A's settle
    r.want(true); // must NOT start a third load
    expect(resolvers).toHaveLength(2);
    r.want(false); // must release B even though nothing is held yet
    expect(signals[1].aborted).toBe(true);
    resolvers[1]({ resource: 'B' });
    await flush();
    expect(r.current()).toBeNull(); // the enable control is off: nothing attached
    expect(r.status().phase).toBe('off');
    expect(unloaded).toEqual(['A', 'B']);
  });

  it('progress is absent until the loader reports one (no stuck 0% bar for a permission prompt)', () => {
    const d = deferredLoader<string>();
    const r = lazyResource({ load: d.load });
    r.request();
    expect(r.status()).toEqual({ phase: 'loading', message: 'Loading resource...' });
    expect('progress' in r.status()).toBe(false);
    d.calls[0].progress(0.5);
    expect(r.status().progress).toBe(0.5);
  });

  it('rule 5 (teardown): an unload that throws is logged, never thrown from release()/want() or left unhandled', async () => {
    const d = deferredLoader<string>();
    const logs: string[] = [];
    const r = lazyResource({
      load: d.load,
      unload: () => {
        throw new Error('close failed');
      },
      label: 'port',
      log: (m) => logs.push(m),
    });
    r.request();
    d.resolve({ resource: 'p' });
    await flush();
    expect(() => r.want(false)).not.toThrow();
    expect(logs).toEqual(['[lazy] port: unload failed: close failed']);
    // Late arrival path too.
    r.request();
    r.release();
    d.resolve({ resource: 'late' });
    await flush();
    expect(logs).toHaveLength(2);
  });

  it('gate: a synchronous capability check reports unavailable on the same tick, imports nothing, and re-checks after release', () => {
    let supported = false;
    const d = deferredLoader<string>();
    const r = lazyResource({
      load: d.load,
      gate: () => (supported ? null : { reason: 'unsupported', message: 'No Web MIDI here' }),
    });
    r.request();
    expect(r.status()).toEqual({ phase: 'unavailable', reason: 'unsupported', message: 'No Web MIDI here', detail: undefined });
    expect(d.calls).toHaveLength(0);
    r.request();
    expect(d.calls).toHaveLength(0); // rule 3 applies to a gated result too
    r.release();
    supported = true;
    r.request();
    expect(d.calls).toHaveLength(1);
  });

  it('detail travels with the result in both branches (the MIDI port list that comes back WITH no-ports)', async () => {
    const d = deferredLoader<string>();
    const r = lazyResource({ load: d.load });
    r.request();
    d.resolve({ resource: null, reason: 'no-ports', detail: { ports: ['IAC Driver'] } });
    await flush();
    expect(r.status().detail).toEqual({ ports: ['IAC Driver'] });
    r.release();
    r.request();
    d.resolve({ resource: 'sink', detail: { ports: ['IAC Driver', 'Synth'] } });
    await flush();
    expect(r.status()).toMatchObject({ phase: 'ready', detail: { ports: ['IAC Driver', 'Synth'] } });
  });

  it('a transient unavailable (retry) is paced, not latched: the loader is asked again after the delay, with no toggle', async () => {
    let t = 0;
    let haveKey = false;
    let calls = 0;
    const r = lazyResource<string>({
      load: async () => {
        calls++;
        return haveKey ? { resource: 'engine' } : { resource: null, reason: 'no-key', retry: true, message: 'Add a key' };
      },
      retryDelayMs: 1000,
      now: () => t,
    });
    r.want(true);
    await flush();
    expect(r.status()).toMatchObject({ phase: 'unavailable', reason: 'no-key' });
    for (let i = 0; i < 20; i++) r.want(true); // within the pause: no re-ask
    expect(calls).toBe(1);
    t = 1000;
    r.want(true); // the pause elapsed: ask again (still no key)
    await flush();
    expect(calls).toBe(2);
    haveKey = true;
    t = 2000;
    r.want(true);
    await flush();
    expect(r.current()).toBe('engine');
    expect(r.status().phase).toBe('ready');
    // A non-transient unavailable still latches.
    const latched = lazyResource<string>({ load: async () => ({ resource: null, reason: 'unsupported' }), now: () => 0 });
    latched.want(true);
    await flush();
    latched.want(true);
    expect(latched.status().phase).toBe('unavailable');
  });

  it('want(false) during a transient pause releases (so the next enable asks at once)', async () => {
    let t = 0;
    let calls = 0;
    const r = lazyResource<string>({
      load: async () => {
        calls++;
        return { resource: null, reason: 'no-audio', retry: true };
      },
      now: () => t,
    });
    r.want(true);
    await flush();
    r.want(false);
    expect(r.status().phase).toBe('off');
    r.want(true);
    expect(calls).toBe(2);
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
