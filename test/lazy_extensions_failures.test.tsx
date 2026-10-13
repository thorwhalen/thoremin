/**
 * Lazy extensions when something fails (#391 item 1, #393 should-fix items 1 and 2;
 * `docs/design/lazy-extensions.md`).
 *
 * The happy path and the single-extension failure are `lazy_extensions.test.ts`. This file
 * pins what happens when ONE of several lazy pieces fails, through the public seams the app
 * uses:
 *  - `makeLazyApplier` driving `ensureLazyTypes` over a real `NodeRegistry`, with two lazy
 *    extensions pending and one loader rejecting (the other must still end `ready` and its
 *    branches committed: #393 item 1), and a failed load followed by a retry that succeeds;
 *  - `loadExtensionUi` with an `onMount` effect that throws (the later effects still run, and
 *    no half-mounted UI is cached: #393 item 2);
 *  - `makeExtensionSinks` with a status hook whose `make` throws (reported once, not rebuilt
 *    every tick: #393 item 2).
 *
 * The build's two extension lists are virtual modules; here they are replaced by fakes
 * (`vi.doMock` after `vi.resetModules`, since the setup file already imported the real ones),
 * so the shipped extensions are never touched.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { defineNode, NodeRegistry, type NodeDef } from '@thoremin/dag';
import { defineExtension, type Extension, type ExtensionNodes } from '@thoremin/sdk/instruments/extension';
import type { ExtensionUi, ExtensionUiStub, StatusHook } from '@thoremin/sdk-ui/types';

const node = (type: string): NodeDef<any> =>
  defineNode({ type, inputs: [], outputs: [{ name: 'out', kind: 'number' }], process: () => ({ out: 1 }) });

/** A loader that resolves (or rejects) when the test says so, counting its calls. */
function gate<T>() {
  let release!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const calls = { n: 0 };
  const load = () => {
    calls.n += 1;
    return new Promise<T>((res, rej) => {
      release = res;
      fail = rej;
    });
  };
  return { load, calls, release: (v: T) => release(v), fail: (e: unknown) => fail(e) };
}

/** A lazy extension stub providing one node type, `<id>-node`. */
const lazyExt = (id: string): Extension => ({
  ...defineExtension({ id, branches: [], dials: [] as const, derive: () => [] }),
  provides: [`${id}-node`],
  load: async (): Promise<ExtensionNodes> => ({ nodes: [node(`${id}-node`)] }),
});

type LazyStub = ExtensionUiStub & { load: () => Promise<ExtensionUi> };
const uiOf = (id: string, over: Partial<ExtensionUi> = {}): ExtensionUi => ({ id, panels: [], statusHooks: [], onMount: [], ...over });
const lazyStub = (id: string, load: () => Promise<ExtensionUi>): LazyStub => ({ id, panels: [], load });

// The status hooks of the one eager fake UI: one whose `make` always throws, one that works.
const brokenMake = vi.fn((): (() => void) => {
  throw new Error('make failed');
});
const goodSink = vi.fn();
const goodMake = vi.fn(() => goodSink);
const STATUS_HOOKS: StatusHook[] = [
  { nodeId: 'broken', make: brokenMake, onRemoved: () => undefined, reset: () => undefined },
  { nodeId: 'good', make: goodMake, onRemoved: () => undefined, reset: () => undefined },
];

// The mount effects of two lazy fakes, each with a throwing effect between two good ones.
const mountA = { before: vi.fn(), after: vi.fn() };
const mountB = { before: vi.fn(), after: vi.fn() };
const throwing = (): void => {
  throw new Error('effect failed');
};

const PURE: readonly Extension[] = [lazyExt('lx'), lazyExt('ly')];
const UIS: readonly (ExtensionUi | LazyStub)[] = [
  uiOf('eager-sinks', { statusHooks: STATUS_HOOKS }),
  lazyStub('lx', async () => uiOf('lx')),
  lazyStub('ly', async () => uiOf('ly')),
  lazyStub('mount-a', async () => uiOf('mount-a', { onMount: [mountA.before, throwing, mountA.after] })),
  lazyStub('mount-b', async () => uiOf('mount-b', { onMount: [mountB.before, throwing, mountB.after] })),
];

let app: {
  ensureLazyTypes: typeof import('@/app/extensionLoad').ensureLazyTypes;
  useExtensionLoad: typeof import('@/app/extensionLoad').useExtensionLoad;
  makeLazyApplier: typeof import('@/app/lazyApply').makeLazyApplier;
  loadExtensionUi: typeof import('@/app/extensions').loadExtensionUi;
  makeExtensionSinks: typeof import('@/app/extensions').makeExtensionSinks;
};

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('virtual:thoremin/extensions', () => ({ default: PURE }));
  vi.doMock('virtual:thoremin/extensions-ui', () => ({ default: UIS }));
  const [load, apply, exts] = await Promise.all([import('@/app/extensionLoad'), import('@/app/lazyApply'), import('@/app/extensions')]);
  app = {
    ensureLazyTypes: load.ensureLazyTypes,
    useExtensionLoad: load.useExtensionLoad,
    makeLazyApplier: apply.makeLazyApplier,
    loadExtensionUi: exts.loadExtensionUi,
    makeExtensionSinks: exts.makeExtensionSinks,
  };
});

/**
 * The app's live applier over a real registry: the "settings" name `graph` (node types), the
 * registry has `lx-node` and `ly-node` declared lazily with the given loaders, and `ensure` is
 * the app's own `ensureLazyTypes` (which reports per-extension status).
 */
function liveApp(loaders: { lx: () => Promise<readonly NodeDef<any>[]>; ly: () => Promise<readonly NodeDef<any>[]> }) {
  const registry = new NodeRegistry().register(node('core')).declareLazy(['lx-node'], loaders.lx).declareLazy(['ly-node'], loaders.ly);
  const state = { graph: ['core', 'lx-node', 'ly-node'] };
  const committed: string[][] = [];
  const loadErrors: string[][] = [];
  const apply = app.makeLazyApplier<string[]>({
    compose: (without) => state.graph.filter((t) => !without.has(t)),
    typesOf: (g) => g,
    pending: (types) => registry.pending(types),
    ensure: (types) => app.ensureLazyTypes(registry, types),
    commit: (g) => committed.push(g),
    onLoadError: (types) => loadErrors.push([...types]),
  });
  const status = (id: string) => app.useExtensionLoad.getState().status[id];
  return { registry, state, committed, loadErrors, apply, status };
}

describe('two lazy extensions pending, one loader rejecting (#393 item 1)', () => {
  it('the instrument still commits, without the failed extension, and the failure is reported', async () => {
    const x = gate<readonly NodeDef<any>[]>();
    const y = gate<readonly NodeDef<any>[]>();
    const w = liveApp({ lx: x.load, ly: y.load });
    const done = w.apply();
    expect(w.status('lx')?.phase).toBe('loading');
    expect(w.status('ly')?.phase).toBe('loading');
    x.fail(new Error('lx offline'));
    y.release([node('ly-node')]);
    await done;
    expect(w.committed.at(-1)).toContain('core');
    expect(w.committed.at(-1)).not.toContain('lx-node');
    expect(w.status('lx')).toEqual({ phase: 'error', message: 'lx offline' });
    expect(w.loadErrors.flat()).toContain('lx-node');
  });

  it.fails("the extension that loaded ends `ready` and its branches are committed (#393 item 1)", async () => {
    const x = gate<readonly NodeDef<any>[]>();
    const y = gate<readonly NodeDef<any>[]>();
    const w = liveApp({ lx: x.load, ly: y.load });
    const done = w.apply();
    x.fail(new Error('lx offline'));
    y.release([node('ly-node')]);
    await done;
    expect(w.status('ly')?.phase).toBe('ready');
    expect(w.committed.at(-1)).toEqual(['core', 'ly-node']);
  });

  it('the registry itself still registers the group that loaded', async () => {
    const registry = new NodeRegistry()
      .declareLazy(['a'], async () => {
        throw new Error('a offline');
      })
      .declareLazy(['b'], async () => [node('b')]);
    await expect(registry.ensure(['a', 'b'])).rejects.toThrow('a offline');
    await new Promise((r) => setTimeout(r, 0));
    expect(registry.pending(['a', 'b'])).toEqual(['a']);
    expect(registry.get('b').type).toBe('b');
  });

  it.fails("`ensure` waits for every group and says which failed, instead of rejecting on the first (#393 item 1)", async () => {
    const b = gate<readonly NodeDef<any>[]>();
    const registry = new NodeRegistry()
      .declareLazy(['a'], async () => {
        throw new Error('a offline');
      })
      .declareLazy(['b'], b.load);
    let settled = false;
    const p = registry.ensure(['a', 'b']).then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((r) => setTimeout(r, 0));
    // Still waiting on `b`: a caller that composes now would drop `b` too.
    expect(settled).toBe(false);
    b.release([node('b')]);
    await p;
  });
});

describe('a failed lazy load, then a retry', () => {
  it('the first request commits without the extension and reports it; the next one loads it and commits it', async () => {
    let attempts = 0;
    const w = liveApp({
      lx: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('lx offline');
        return [node('lx-node')];
      },
      ly: async () => [node('ly-node')],
    });
    w.state.graph = ['core', 'lx-node'];
    await w.apply();
    expect(w.committed.at(-1)).toEqual(['core']);
    expect(w.status('lx')?.phase).toBe('error');
    expect(w.loadErrors).toEqual([['lx-node']]);
    await w.apply();
    expect(attempts).toBe(2);
    expect(w.committed.at(-1)).toEqual(['core', 'lx-node']);
    expect(w.status('lx')).toEqual({ phase: 'ready', message: 'Loaded' });
    expect(w.registry.get('lx-node').type).toBe('lx-node');
  });

  it('ensureLazyTypes on its own: rejects, reports `error`, then succeeds and reports `ready`', async () => {
    let attempts = 0;
    const registry = new NodeRegistry().declareLazy(['lx-node'], async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('flaky');
      return [node('lx-node')];
    });
    await expect(app.ensureLazyTypes(registry, ['lx-node'])).rejects.toThrow('flaky');
    expect(app.useExtensionLoad.getState().status.lx).toEqual({ phase: 'error', message: 'flaky' });
    await app.ensureLazyTypes(registry, ['lx-node']);
    expect(app.useExtensionLoad.getState().status.lx?.phase).toBe('ready');
    expect(registry.pending(['lx-node'])).toEqual([]);
  });
});

describe('loadExtensionUi: a mount effect that throws (#393 item 2)', () => {
  it('runs the effects before the throwing one, once', async () => {
    await app.loadExtensionUi('mount-a').catch(() => undefined);
    await app.loadExtensionUi('mount-a').catch(() => undefined);
    expect(mountA.before).toHaveBeenCalledOnce();
  });

  it.fails('the effects after the throwing one still run (#393 item 2)', async () => {
    await app.loadExtensionUi('mount-a').catch(() => undefined);
    expect(mountA.after).toHaveBeenCalledOnce();
  });

  it.fails('no half-mounted UI is handed out: a UI the cache returns has had every effect run (#393 item 2)', async () => {
    const first = await app.loadExtensionUi('mount-b').then(
      () => 'resolved',
      () => 'rejected',
    );
    const second = await app.loadExtensionUi('mount-b').then(
      () => 'resolved',
      () => 'rejected',
    );
    // Today the first call rejects and the second resolves with the cached UI whose last effect
    // never ran. Whatever the fixed contract reports, a resolved UI must be fully mounted, and
    // both calls must agree.
    expect(second).toBe(first);
    if (second === 'resolved') expect(mountB.after).toHaveBeenCalledOnce();
  });
});

describe('makeExtensionSinks: a status hook whose `make` throws (#393 item 2)', () => {
  const engine = { getOutput: () => undefined };

  it('the other hooks still run every tick', () => {
    const sinks = app.makeExtensionSinks(engine);
    goodSink.mockClear();
    for (let i = 0; i < 5; i += 1) {
      try {
        sinks();
      } catch {
        // the broken hook; asserted in the next test
      }
    }
    expect(goodSink).toHaveBeenCalledTimes(5);
    expect(goodMake).toHaveBeenCalled();
  });

  it.fails('is built once and reported once, not rebuilt and rethrown on every tick (#393 item 2)', () => {
    brokenMake.mockClear();
    const sinks = app.makeExtensionSinks(engine);
    let thrown = 0;
    for (let i = 0; i < 60; i += 1) {
      try {
        sinks();
      } catch {
        thrown += 1;
      }
    }
    expect(brokenMake).toHaveBeenCalledOnce();
    expect(thrown).toBeLessThanOrEqual(1);
  });
});
