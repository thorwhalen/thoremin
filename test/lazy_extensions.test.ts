/**
 * Lazy extensions (`docs/design/lazy-extensions.md`): an extension whose node code is declared
 * up front and loaded the first time a graph names one of its nodes.
 *
 * Pinned here, each with its own extensions and loaders (never the shipped ones, which the
 * test setup preloads):
 *  - the registry: declared types are known but not usable until loaded, one shared load per
 *    group, a failed load is retried, a loader that provides the wrong types is refused;
 *  - the app registry: a lazy extension is declared, and a registry rebuilt after its load
 *    registers it synchronously;
 *  - the live applier: nothing pending commits at once; two rapid requests during a fetch
 *    commit only the latest, composed after the load; a failed load commits the graph without
 *    the extension, reports it, and the next request retries;
 *  - the build: a `lazy` entry becomes a dynamic `import()` in the generated list.
 *
 * The React side (the load status, the panel placeholder) is `lazy_extensions_ui.test.tsx`.
 */
import { describe, expect, it, vi } from 'vitest';
import { defineNode, NodeRegistry, type NodeDef } from '@thoremin/dag';
import { defineExtension, type Extension, type ExtensionNodes } from '@thoremin/sdk/instruments/extension';
import { createAppRegistry } from '@/nodes/browser';
import { loadExtensionNodes, loadedExtensionNodes } from '@/extensions';
import { branchIdsWithout } from '@/app/graph';
import { composeLoaded, makeLazyApplier, type LazyApplyDeps } from '@/app/lazyApply';
import { listModuleSource, readExtensionEntries } from '../vite.extensions';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASL } from './helpers/extensions';

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

describe('NodeRegistry: lazily declared node types', () => {
  it('knows a declared type at once, refuses to hand it out until loaded, then registers it', async () => {
    const g = gate<readonly NodeDef<any>[]>();
    const r = new NodeRegistry().register(node('core')).declareLazy(['a', 'b'], g.load);
    expect(r.has('a')).toBe(true);
    expect(r.pending(['core', 'a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(() => r.get('a')).toThrow(/declared lazily and not loaded yet/);
    expect(r.list().map((d) => d.type)).toEqual(['core']);
    const p = r.ensure(['a']);
    g.release([node('a'), node('b')]);
    await p;
    expect(r.pending(['a', 'b'])).toEqual([]);
    expect(r.get('b').type).toBe('b');
    expect(r.list().map((d) => d.type).sort()).toEqual(['a', 'b', 'core']);
  });

  it('shares one load between concurrent callers', async () => {
    const g = gate<readonly NodeDef<any>[]>();
    const r = new NodeRegistry().declareLazy(['a', 'b'], g.load);
    const both = Promise.all([r.ensure(['a']), r.ensure(['b']), r.ensure(['a', 'b'])]);
    g.release([node('a'), node('b')]);
    await both;
    expect(g.calls.n).toBe(1);
  });

  it('forgets a failed load, so the next ensure retries', async () => {
    let attempt = 0;
    const r = new NodeRegistry().declareLazy(['a'], async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('offline');
      return [node('a')];
    });
    await expect(r.ensure(['a'])).rejects.toThrow('offline');
    expect(r.pending(['a'])).toEqual(['a']);
    await r.ensure(['a']);
    expect(r.pending(['a'])).toEqual([]);
    expect(attempt).toBe(2);
  });

  it('refuses a loader that provides other types than it declared, and a duplicate declaration', async () => {
    const r = new NodeRegistry().register(node('core')).declareLazy(['a'], async () => [node('z')]);
    await expect(r.ensure(['a'])).rejects.toThrow(/declared \[a\] but provided \[z\]/);
    expect(() => r.declareLazy(['core'], async () => [])).toThrow(/duplicate/);
    expect(() => r.register(node('a'))).toThrow(/duplicate/);
  });
});

describe('the app registry and a lazy extension', () => {
  const lazyExt = (id: string, load: () => Promise<ExtensionNodes>): Extension => ({
    ...defineExtension({ id, branches: [], dials: [] as const, derive: () => [] }),
    provides: [`${id}-node`],
    load,
  });

  it('declares its nodes until they load, and a registry rebuilt after the load registers them synchronously', async () => {
    const g = gate<ExtensionNodes>();
    const ext = lazyExt('lazy-rebuilt', g.load);
    const first = createAppRegistry([ext]);
    expect(first.pending(['lazy-rebuilt-node'])).toEqual(['lazy-rebuilt-node']);
    expect(loadedExtensionNodes(ext)).toBeUndefined();
    const ensured = first.ensure(['lazy-rebuilt-node']);
    g.release({ nodes: [node('lazy-rebuilt-node')] });
    await ensured;
    // A new engine builds a new registry: no second fetch, nothing pending.
    const rebuilt = createAppRegistry([ext]);
    expect(rebuilt.pending(['lazy-rebuilt-node'])).toEqual([]);
    expect(rebuilt.get('lazy-rebuilt-node').type).toBe('lazy-rebuilt-node');
    expect(g.calls.n).toBe(1);
  });

  it('loads once per page, and retries after a failure', async () => {
    let n = 0;
    const ext = lazyExt('lazy-retry', async () => {
      n += 1;
      if (n === 1) throw new Error('offline');
      return { nodes: [node('lazy-retry-node')] };
    });
    await expect(loadExtensionNodes(ext)).rejects.toThrow('offline');
    await expect(loadExtensionNodes(ext)).resolves.toHaveLength(1);
    await loadExtensionNodes(ext);
    expect(n).toBe(2);
  });

  it.runIf(ASL)('the shipped ASL extension is lazy: its stub names its node types and carries no node code', async () => {
    const { default: stub } = await import('@thoremin/ext-asl');
    expect(stub.nodes).toBeUndefined();
    expect([...(stub.provides ?? [])].sort()).toEqual(['asl-signs', 'sign-chord']);
    const { default: deferred } = await import('@thoremin/ext-asl/lazy');
    expect(deferred.nodes.map((n) => n.type).sort()).toEqual(['asl-signs', 'sign-chord']);
  });

  it.runIf(ASL)('a failed load composes the graph without the branches that need it, and those that require them', () => {
    expect(branchIdsWithout(['trunk', 'asl-signs', 'asl-chord'], new Set(['asl-signs']))).toEqual(['trunk']);
    expect(branchIdsWithout(['trunk', 'asl-signs', 'asl-chord'], new Set(['sign-chord']))).toEqual(['trunk', 'asl-signs']);
    expect(branchIdsWithout(['trunk', 'asl-signs'], new Set())).toEqual(['trunk', 'asl-signs']);
  });
});

describe('the live applier (src/app/lazyApply.ts)', () => {
  /** A fake world: the "settings" pick a graph (a list of node types), some types are lazy. */
  function world(lazy: string[]) {
    const state = { graph: ['core'] as string[] };
    const loaded = new Set<string>();
    const g = gate<void>();
    let inFlight: Promise<void> | null = null;
    const committed: string[][] = [];
    const errors: string[][] = [];
    const deps: LazyApplyDeps<string[]> = {
      compose: (without) => state.graph.filter((t) => !without.has(t)),
      typesOf: (graph) => graph,
      pending: (types) => types.filter((t) => lazy.includes(t) && !loaded.has(t)),
      // Like the registry: one load in flight, shared by concurrent requests; forgotten on failure.
      ensure: (types) => {
        inFlight ??= g.load().finally(() => {
          inFlight = null;
        });
        return inFlight.then(() => {
          for (const t of types) loaded.add(t);
        });
      },
      commit: (graph) => committed.push(graph),
      onLoadError: (types) => errors.push([...types]),
    };
    return { state, g, committed, errors, deps, apply: makeLazyApplier(deps) };
  }

  it('commits at once, synchronously, when nothing is pending', () => {
    const w = world(['asl']);
    w.state.graph = ['core', 'drum'];
    expect(w.apply()).toBeUndefined();
    expect(w.committed).toEqual([['core', 'drum']]);
  });

  it('two rapid switches during a fetch: the stale request is dropped, the last one chosen commits, composed after the load', async () => {
    const w = world(['asl']);
    w.state.graph = ['core', 'asl'];
    const first = w.apply(); // ASL Viewer picked: its chunk starts loading
    w.state.graph = ['core', 'asl', 'chord']; // ASL Chords picked while it is still loading
    const second = w.apply();
    expect(w.committed).toEqual([]); // the running graph keeps playing meanwhile
    w.g.release();
    await Promise.all([first, second]);
    expect(w.committed).toEqual([['core', 'asl', 'chord']]);
  });

  it('a switch AWAY during a fetch commits at once, and the late load commits nothing', async () => {
    const w = world(['asl']);
    w.state.graph = ['core', 'asl'];
    const first = w.apply();
    w.state.graph = ['core', 'drum'];
    w.apply();
    expect(w.committed).toEqual([['core', 'drum']]);
    w.g.release();
    await first;
    expect(w.committed).toEqual([['core', 'drum']]);
  });

  it('a failed load: the graph is committed without the extension, the failure is reported, and the next request retries', async () => {
    const w = world(['asl']);
    w.state.graph = ['core', 'asl'];
    const first = w.apply();
    w.g.fail(new Error('offline'));
    await first;
    expect(w.committed).toEqual([['core']]);
    expect(w.errors).toEqual([['asl']]);
    const retry = w.apply(); // the player picks the instrument again
    expect(w.g.calls.n).toBe(2);
    w.g.release();
    await retry;
    expect(w.committed.at(-1)).toEqual(['core', 'asl']);
  });

  it('composeLoaded gives up (and reports) on a loader that resolves without loading', async () => {
    const onLoadError = vi.fn();
    const g = await composeLoaded({
      compose: (without) => ['core', 'asl'].filter((t) => !without.has(t)),
      typesOf: (x) => x,
      pending: (types) => types.filter((t) => t === 'asl'),
      ensure: async () => undefined,
      onLoadError,
    });
    expect(g).toEqual(['core']);
    expect(onLoadError).toHaveBeenCalledOnce();
  });
});

describe('the build: a lazy entry in extensions.json', () => {
  const write = (manifest: unknown): string => {
    const file = join(mkdtempSync(join(tmpdir(), 'thoremin-lazy-')), 'extensions.json');
    writeFileSync(file, JSON.stringify(manifest));
    return file;
  };

  it('is validated: both deferred halves, as module specifiers', () => {
    const base = { id: 'x', module: 'pkg-x', ui: 'pkg-x/ui' };
    expect(readExtensionEntries(write({ extensions: [{ ...base, lazy: { module: 'pkg-x/lazy', ui: 'pkg-x/lazy_ui' } }] }))[0].lazy).toEqual({
      module: 'pkg-x/lazy',
      ui: 'pkg-x/lazy_ui',
    });
    expect(() => readExtensionEntries(write({ extensions: [{ ...base, lazy: { module: 'pkg-x/lazy' } }] }))).toThrow(/lazy\.ui/);
    expect(() => readExtensionEntries(write({ extensions: [{ ...base, lazy: { module: './lazy', ui: 'pkg-x/lazy_ui' } }] }))).toThrow(/lazy\.module/);
  });

  it('becomes the stub, statically, plus a dynamic import() of the deferred half', () => {
    const src = listModuleSource([{ id: 'x', module: 'pkg-x', ui: 'pkg-x/ui', lazy: { module: 'pkg-x/lazy', ui: 'pkg-x/lazy_ui' } }], 'module');
    expect(src).toContain('import e0 from "pkg-x";');
    expect(src).toContain('load: () => import("pkg-x/lazy").then((m) => m.default)');
    expect(src).not.toMatch(/import .* from "pkg-x\/lazy"/);
    const ui = listModuleSource([{ id: 'x', module: 'pkg-x', ui: 'pkg-x/ui', lazy: { module: 'pkg-x/lazy', ui: 'pkg-x/lazy_ui' } }], 'ui');
    expect(ui).toContain('import("pkg-x/lazy_ui")');
  });
});
