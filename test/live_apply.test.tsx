/**
 * Re-wiring a RUNNING engine onto the live graph (`applyLive`, `src/app/engine/liveApply.ts`; #391
 * item 2, extracted from `useEngine` by #392). The pure applier rules are
 * `lazy_extensions.test.ts` / `lazy_extensions_failures.test.tsx`; this file pins the host half
 * the hook used to hide: the commit goes to `engine.applyGraph` only once a pending lazy type has
 * loaded, the overlay's element set and the removed nodes follow the COMMIT, a failed load toasts
 * once per extension (a browser never refetches a failed `import()`, so saying it again is
 * noise), a torn-down engine's late failure says nothing, and a failed re-wire is logged only
 * while the engine is still the live one.
 *
 * A real `NodeRegistry` with lazily declared types and the app's own `ensureLazyTypes`; the
 * graph is composed by the test (the `compose` seam), so no shipped extension is involved.
 * `.tsx` because `liveApply` reaches the React extension list through `extensionLoad`, which
 * the strict (React-free) typecheck cannot follow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineNode, NodeRegistry, type Engine, type NodeDef } from '@thoremin/dag';
import type { Composed } from '@/instruments/compose';
import { applyLive, type LiveEngine } from '@/app/engine/liveApply';
import { NO_SLOTS } from '@/app/graph';
import { useControls } from '@/app/store';
import { useToasts } from '@/app/shell/toasts';

const node = (type: string): NodeDef<any> =>
  defineNode({ type, inputs: [], outputs: [{ name: 'out', kind: 'number' }], process: () => ({ out: 1 }) });

/** A loader that resolves (or rejects) when the test says so, counting its calls. */
function gate() {
  let release!: (v: readonly NodeDef<any>[]) => void;
  let fail!: (e: unknown) => void;
  const calls = { n: 0 };
  const load = () => {
    calls.n += 1;
    return new Promise<readonly NodeDef<any>[]>((res, rej) => {
      release = res;
      fail = rej;
    });
  };
  return { load, calls, release: (v: readonly NodeDef<any>[]) => release(v), fail: (e: unknown) => fail(e) };
}

/** A composed graph naming `types` (minus `without`), each type's node carrying its own element. */
const composedOf = (types: readonly string[], without: ReadonlySet<string>): Composed => {
  const kept = types.filter((t) => !without.has(t));
  return { spec: { nodes: kept.map((t) => ({ id: t, type: t })), edges: [] }, elements: kept.map((t) => `el-${t}`), branches: [] };
};

type Change = Awaited<ReturnType<Engine['applyGraph']>>;

/** A stand-in engine: records every spec it is asked to apply, resolving with `removed`. */
function fakeEngine(removed: string[] = []) {
  const applied: string[][] = [];
  const applyGraph = vi.fn(async (spec: Composed['spec']) => {
    applied.push(spec.nodes.map((n) => n.type));
    return { added: [], replaced: [], kept: [], removed } as unknown as Change;
  });
  return { engine: { applyGraph } as LiveEngine, applyGraph, applied };
}

const errorToasts = () => useToasts.getState().toasts.filter((t) => t.level === 'error');

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  useToasts.setState({ toasts: [] });
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
  useControls.getState().setGraphElements(null);
});

describe('applyLive with a pending lazy type', () => {
  it('commits nothing until the load, then the graph that names it; the elements and the removed nodes follow the commit', async () => {
    const lz = gate();
    const registry = new NodeRegistry().register(node('core')).declareLazy(['lz-a'], lz.load);
    const { engine, applyGraph, applied } = fakeEngine(['gone']);
    const onRemoved = vi.fn();
    const settings = { types: ['core', 'lz-a'] };
    useControls.getState().setGraphElements(['before']);
    applyLive(engine, { selection: () => NO_SLOTS, registry, live: () => engine, onRemoved, compose: (w) => composedOf(settings.types, w) });
    expect(lz.calls.n).toBe(1);
    expect(applyGraph).not.toHaveBeenCalled();
    // The settings move on during the fetch: the graph composed AFTER the load is the one committed.
    settings.types = ['core', 'lz-a', 'core2'];
    registry.register(node('core2'));
    lz.release([node('lz-a')]);
    await vi.waitFor(() => expect(onRemoved).toHaveBeenCalledWith(['gone']));
    expect(applied).toEqual([['core', 'lz-a', 'core2']]);
    expect(useControls.getState().graphElements).toEqual(['el-core', 'el-lz-a', 'el-core2']);
    expect(errorToasts()).toEqual([]);
  });

  it('with nothing pending, commits at once', () => {
    const registry = new NodeRegistry().register(node('core'));
    const { engine, applied } = fakeEngine();
    applyLive(engine, { selection: () => NO_SLOTS, registry, live: () => engine, compose: (w) => composedOf(['core'], w) });
    expect(applied).toEqual([['core']]);
  });
});

describe('applyLive when a lazy load fails', () => {
  it('commits without the failed types and toasts once per extension, not once per request', async () => {
    const fx = gate();
    // One extension providing two node types, as one lazy group.
    const registry = new NodeRegistry().register(node('core')).declareLazy(['fx-1', 'fx-2'], fx.load);
    const { engine, applied } = fakeEngine();
    const compose = (w: ReadonlySet<string>) => composedOf(['core', 'fx-1', 'fx-2'], w);
    applyLive(engine, { selection: () => NO_SLOTS, registry, live: () => engine, compose });
    fx.fail(new Error('offline'));
    await vi.waitFor(() => expect(applied).toEqual([['core']]));
    expect(errorToasts()).toHaveLength(1);
    expect(errorToasts()[0].message).toMatch(/add-on could not load/);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('fx-1, fx-2'), expect.any(Error));

    // The next graph change asks again (the registry forgets a failed load) and fails again:
    // the player has been told, so nothing new is said.
    applyLive(engine, { selection: () => NO_SLOTS, registry, live: () => engine, compose });
    expect(fx.calls.n).toBe(2);
    fx.fail(new Error('still offline'));
    await vi.waitFor(() => expect(applied).toHaveLength(2));
    expect(applied[1]).toEqual(['core']);
    expect(errorToasts()).toHaveLength(1);

    // Another extension's failure is news.
    const fy = gate();
    const registry2 = new NodeRegistry().register(node('core')).declareLazy(['fy-1'], fy.load);
    const other = fakeEngine();
    applyLive(other.engine, { selection: () => NO_SLOTS, registry: registry2, live: () => other.engine, compose: (w) => composedOf(['core', 'fy-1'], w) });
    fy.fail(new Error('offline'));
    await vi.waitFor(() => expect(other.applied).toEqual([['core']]));
    expect(errorToasts()).toHaveLength(2);
  });

  it("a torn-down engine's late failure says nothing", async () => {
    const tz = gate();
    const registry = new NodeRegistry().register(node('core')).declareLazy(['tz-1'], tz.load);
    const { engine, applied } = fakeEngine();
    let current: LiveEngine | null = engine;
    applyLive(engine, { selection: () => NO_SLOTS, registry, live: () => current, compose: (w) => composedOf(['core', 'tz-1'], w) });
    current = null; // the hook's cleanup nulls the ref
    tz.fail(new Error('offline'));
    await vi.waitFor(() => expect(applied).toHaveLength(1));
    expect(errorToasts()).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('applyLive when the re-wire itself fails', () => {
  const rejecting = () => {
    const engine: LiveEngine = { applyGraph: vi.fn(async () => Promise.reject(new Error('bad spec'))) };
    return engine;
  };

  it('is logged while the engine is the live one, and leaves the element set alone', async () => {
    const registry = new NodeRegistry().register(node('core'));
    const engine = rejecting();
    useControls.getState().setGraphElements(['running']);
    applyLive(engine, { selection: () => NO_SLOTS, registry, live: () => engine, compose: (w) => composedOf(['core'], w) });
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith('[thoremin] could not apply the instrument graph', expect.any(Error)));
    expect(useControls.getState().graphElements).toEqual(['running']);
  });

  it('is quiet once the engine was torn down (the ordinary unmount path)', async () => {
    const registry = new NodeRegistry().register(node('core'));
    const engine = rejecting();
    applyLive(engine, { selection: () => NO_SLOTS, registry, live: () => null, compose: (w) => composedOf(['core'], w) });
    await vi.waitFor(() => expect(engine.applyGraph).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(consoleError).not.toHaveBeenCalled();
  });
});
