/**
 * Tests the engine graph lifecycle (#51's "engine lifecycle on swap" bullet):
 * `Engine.applyGraph` reconciles a RUNNING engine onto a new GraphSpec in place,
 * keeping every node the new spec leaves unchanged.
 *
 * The guarantees under test, in the order they matter:
 *
 *  1. **Keep means keep.** A node whose id, type and validated params are
 *     unchanged is the same live instance: `init()` is not re-run, its internal
 *     state survives, and its last outputs still stand. This is the whole point —
 *     swapping one mapping node must not reload the MediaPipe model.
 *  2. **The tick loop never freezes.** `init()` is async (model loads, audio
 *     graph setup); the old graph keeps evaluating for the whole prepare phase
 *     and the swap lands atomically between two ticks.
 *  3. **A bad apply changes nothing.** An invalid spec, or a new node whose
 *     `init` rejects, leaves the running graph bit-for-bit as it was — and it
 *     keeps ticking.
 *
 * Everything here is headless: the mechanism is proved on synthetic nodes where
 * init/dispose/process calls can be counted exactly, and the classification is
 * then checked against the REAL production graph (`defaultGraph`) so the mapping
 * slot swap is verified on the wiring the browser actually runs.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  Engine,
  createRegistry,
  defineNode,
  type GraphSpec,
  type NodeRegistry,
  type Tap,
} from '../src/dag';
import { createAppRegistry, BROWSER_NODES } from '@/nodes/browser';
import { CORE_NODES } from '@/nodes';
import { defaultGraph } from '@/app/graph';
import { MAPPING_SLOT_INPUTS, MAPPING_SLOT_OUTPUT } from '@/nodes/mapping/mapping_contract';

// ---- instrumented node types ---------------------------------------------

/** Per-node-type call counters, so "was this instance rebuilt?" is a hard fact. */
interface Calls {
  init: string[];
  dispose: string[];
  process: string[];
}

/**
 * A stateful counter node: emits how many times THIS INSTANCE has processed, so
 * a surviving instance is distinguishable from a freshly built one by its output
 * alone (a rebuilt node restarts at 1). `offset` is a param, so changing it is
 * how a test asks for a replace.
 */
function counterNode(calls: Calls, type = 'counter') {
  return defineNode({
    type,
    inputs: [{ name: 'in', kind: 'number' }],
    outputs: [{ name: 'n', kind: 'number' }],
    params: z.object({ offset: z.number().default(0) }),
    make(p) {
      let n = 0;
      const id = `${type}:${p.offset}`;
      return {
        init: () => {
          calls.init.push(id);
        },
        process: () => {
          n += 1;
          calls.process.push(id);
          return { n: n + p.offset };
        },
        dispose: () => {
          calls.dispose.push(id);
        },
      };
    },
  });
}

/** A zero-input source emitting a constant, for wiring tests. */
const constNode = defineNode({
  type: 'const',
  inputs: [],
  outputs: [{ name: 'v', kind: 'number' }],
  params: z.object({ value: z.number().default(1) }),
  process: (_i, p) => ({ v: p.value }),
});

/** Passes its input through, tagged, so edge rewiring is observable downstream. */
const passNode = defineNode({
  type: 'pass',
  inputs: [{ name: 'in', kind: 'number', default: -1 }],
  outputs: [{ name: 'out', kind: 'number' }],
  params: z.object({}),
  process: (i) => ({ out: i.in }),
});

const freshCalls = (): Calls => ({ init: [], dispose: [], process: [] });

function registryFor(calls: Calls, extra: ReturnType<typeof defineNode>[] = []): NodeRegistry {
  return createRegistry([counterNode(calls), counterNode(calls, 'counter-b'), constNode, passNode, ...extra]);
}

/** Two counters in a chain: a -> b. */
const chain = (aOffset = 0, bOffset = 0): GraphSpec => ({
  nodes: [
    { id: 'a', type: 'counter', params: { offset: aOffset } },
    { id: 'b', type: 'counter', params: { offset: bOffset } },
  ],
  edges: [{ from: { node: 'a', port: 'n' }, to: { node: 'b', port: 'in' } }],
});

async function startedEngine(spec: GraphSpec, registry: NodeRegistry): Promise<Engine> {
  const engine = new Engine(spec, registry);
  await engine.init();
  return engine;
}

// ---- 1. keep means keep ---------------------------------------------------

describe('applyGraph — keeping unchanged nodes', () => {
  it('re-applying the identical spec keeps every node: no init, no dispose, no rebuild', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    engine.tick();
    engine.tick();
    expect(calls.init).toEqual(['counter:0', 'counter:0']);

    const change = await engine.applyGraph(chain());

    expect(change.kept.sort()).toEqual(['a', 'b']);
    expect(change.added).toEqual([]);
    expect(change.replaced).toEqual([]);
    expect(change.removed).toEqual([]);
    expect(change.rewired).toBe(false);
    // Nothing was re-init'd and nothing was torn down.
    expect(calls.init).toHaveLength(2);
    expect(calls.dispose).toEqual([]);
  });

  it('a kept node keeps its internal state; a replaced one starts over', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    engine.tick();
    engine.tick();
    engine.tick();
    expect(engine.getOutput('a', 'n')).toBe(3); // three processes on this instance
    expect(engine.getOutput('b', 'n')).toBe(3);

    // Change ONLY b's params.
    const change = await engine.applyGraph(chain(0, 100));
    expect(change.kept).toEqual(['a']);
    expect(change.replaced).toEqual(['b']);
    expect(calls.dispose).toEqual(['counter:0']); // b's old instance only
    expect(calls.init).toEqual(['counter:0', 'counter:0', 'counter:100']);

    engine.tick();
    expect(engine.getOutput('a', 'n')).toBe(4); // a carried on: 4th process
    expect(engine.getOutput('b', 'n')).toBe(101); // b restarted: 1st process + offset
  });

  it('a kept node keeps its last outputs, so downstream sees no one-tick hole', async () => {
    const calls = freshCalls();
    const spec: GraphSpec = {
      nodes: [
        { id: 'a', type: 'counter', params: { offset: 0 } },
        { id: 'p', type: 'pass' },
      ],
      edges: [{ from: { node: 'a', port: 'n' }, to: { node: 'p', port: 'in' } }],
    };
    const engine = await startedEngine(spec, registryFor(calls));
    engine.tick();
    engine.tick();
    expect(engine.getOutput('a', 'n')).toBe(2);

    // Replace only `p`; `a`'s stored output must survive the commit.
    await engine.applyGraph({
      ...spec,
      nodes: [spec.nodes[0], { id: 'p', type: 'pass', params: {} }],
    });
    expect(engine.getOutput('a', 'n')).toBe(2);
  });

  it('distinguishes a real params change from a re-specified default', async () => {
    const calls = freshCalls();
    // `offset` defaults to 0, so omitting it and passing 0 must compare EQUAL —
    // otherwise every re-apply would needlessly rebuild the world.
    const withDefault: GraphSpec = { nodes: [{ id: 'a', type: 'counter' }], edges: [] };
    const withExplicitZero: GraphSpec = {
      nodes: [{ id: 'a', type: 'counter', params: { offset: 0 } }],
      edges: [],
    };
    const engine = await startedEngine(withDefault, registryFor(calls));
    expect((await engine.applyGraph(withExplicitZero)).kept).toEqual(['a']);
    expect((await engine.applyGraph(withDefault)).kept).toEqual(['a']);
    expect(calls.dispose).toEqual([]);
  });

  it('a type change on the same id is a replace, not a keep', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    const change = await engine.applyGraph({
      nodes: [
        { id: 'a', type: 'counter' },
        { id: 'b', type: 'counter-b' },
      ],
      edges: [{ from: { node: 'a', port: 'n' }, to: { node: 'b', port: 'in' } }],
    });
    expect(change.kept).toEqual(['a']);
    expect(change.replaced).toEqual(['b']);
    expect(calls.init).toContain('counter-b:0');
  });
});

// ---- 2. structural changes ------------------------------------------------

describe('applyGraph — structural changes', () => {
  it('adds a node: it is init\'d, the rest are kept', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    const change = await engine.applyGraph({
      nodes: [...chain().nodes, { id: 'c', type: 'pass' }],
      edges: [
        ...chain().edges,
        { from: { node: 'b', port: 'n' }, to: { node: 'c', port: 'in' } },
      ],
    });
    expect(change.added).toEqual(['c']);
    expect(change.kept.sort()).toEqual(['a', 'b']);
    expect(change.rewired).toBe(true);
    expect(engine.evaluationOrder()).toEqual(['a', 'b', 'c']);
    engine.tick();
    expect(engine.getOutput('c', 'out')).toBe(1);
  });

  it('removes a node: it is disposed and its outputs are dropped', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    engine.tick();
    expect(engine.getOutput('b', 'n')).toBe(1);

    const change = await engine.applyGraph({ nodes: [{ id: 'a', type: 'counter' }], edges: [] });
    expect(change.removed).toEqual(['b']);
    expect(change.kept).toEqual(['a']);
    expect(calls.dispose).toEqual(['counter:0']);
    expect(engine.getOutput('b', 'n')).toBeUndefined();
    expect(engine.evaluationOrder()).toEqual(['a']);
  });

  it('rewires edges with every node kept, and recomputes the evaluation order', async () => {
    const calls = freshCalls();
    const spec: GraphSpec = {
      nodes: [
        { id: 'src', type: 'const', params: { value: 7 } },
        { id: 'x', type: 'pass' },
        { id: 'y', type: 'pass' },
      ],
      // src -> x -> y
      edges: [
        { from: { node: 'src', port: 'v' }, to: { node: 'x', port: 'in' } },
        { from: { node: 'x', port: 'out' }, to: { node: 'y', port: 'in' } },
      ],
    };
    const engine = await startedEngine(spec, registryFor(calls));
    engine.tick();
    expect(engine.getOutput('y', 'out')).toBe(7);

    // src -> y -> x (reversed downstream half)
    const change = await engine.applyGraph({
      nodes: spec.nodes,
      edges: [
        { from: { node: 'src', port: 'v' }, to: { node: 'y', port: 'in' } },
        { from: { node: 'y', port: 'out' }, to: { node: 'x', port: 'in' } },
      ],
    });
    expect(change.kept.sort()).toEqual(['src', 'x', 'y']);
    expect(change.rewired).toBe(true);
    expect(calls.dispose).toEqual([]);
    expect(engine.evaluationOrder()).toEqual(['src', 'y', 'x']);
    engine.tick();
    expect(engine.getOutput('x', 'out')).toBe(7);
  });

  it('reports rewired=false when the same edges arrive in a different order', async () => {
    const calls = freshCalls();
    const spec: GraphSpec = {
      nodes: [
        { id: 'src', type: 'const' },
        { id: 'x', type: 'pass' },
        { id: 'y', type: 'pass' },
      ],
      edges: [
        { from: { node: 'src', port: 'v' }, to: { node: 'x', port: 'in' } },
        { from: { node: 'src', port: 'v' }, to: { node: 'y', port: 'in' } },
      ],
    };
    const engine = await startedEngine(spec, registryFor(calls));
    const change = await engine.applyGraph({ nodes: spec.nodes, edges: [spec.edges[1], spec.edges[0]] });
    expect(change.rewired).toBe(false);
  });

  it('keeps taps attached across a swap', async () => {
    const calls = freshCalls();
    const seen: string[] = [];
    const tap: Tap = { onValue: (key) => void seen.push(key) };
    const engine = new Engine(chain(), registryFor(calls), { taps: [tap] });
    await engine.init();
    engine.tick();
    seen.length = 0;
    await engine.applyGraph(chain(0, 5));
    engine.tick();
    expect(seen.sort()).toEqual(['a.n', 'b.n']);
  });

  it('preserves tick/time continuity across a swap (dt does not jump)', async () => {
    const calls = freshCalls();
    const dts: number[] = [];
    const probe = defineNode({
      type: 'dt-probe',
      inputs: [],
      outputs: [{ name: 'dt', kind: 'number' }],
      params: z.object({}),
      process: (_i, _p, ctx) => {
        dts.push(ctx.dt);
        return { dt: ctx.dt };
      },
    });
    const spec: GraphSpec = { nodes: [{ id: 'd', type: 'dt-probe' }], edges: [] };
    const engine = await startedEngine(spec, registryFor(calls, [probe]));
    engine.tick(10);
    engine.tick(10.5);
    await engine.applyGraph({ nodes: [...spec.nodes, { id: 'c', type: 'const' }], edges: [] });
    engine.tick(11);
    expect(dts).toEqual([0, 0.5, 0.5]); // the swap did not reset lastTime
  });
});

// ---- 3. the tick loop never freezes --------------------------------------

describe('applyGraph — the old graph keeps ticking through a slow async init', () => {
  it('evaluates the OLD graph for the whole prepare phase, then swaps atomically', async () => {
    const calls = freshCalls();
    let beginInit!: () => void;
    let releaseInit!: () => void;
    const initBegan = new Promise<void>((r) => {
      beginInit = r;
    });
    const gate = new Promise<void>((r) => {
      releaseInit = r;
    });
    const slow = defineNode({
      type: 'slow-init',
      inputs: [],
      outputs: [{ name: 'v', kind: 'number' }],
      params: z.object({}),
      make() {
        return {
          init: async () => {
            beginInit();
            await gate;
          },
          process: () => ({ v: 42 }),
        };
      },
    });

    const engine = await startedEngine(chain(), registryFor(calls, [slow]));
    engine.tick();
    expect(calls.process).toHaveLength(2);

    const pending = engine.applyGraph({
      nodes: [...chain().nodes, { id: 's', type: 'slow-init' }],
      edges: chain().edges,
    });

    await initBegan; // the new node's init is running; nothing has committed yet
    expect(engine.evaluationOrder()).toEqual(['a', 'b']); // still the old graph
    expect(engine.getOutput('s', 'v')).toBeUndefined();

    // The instrument keeps playing while the model loads.
    engine.tick();
    engine.tick();
    expect(calls.process).toHaveLength(6);
    expect(engine.getOutput('a', 'n')).toBe(3);

    releaseInit();
    const change = await pending;

    expect(change.added).toEqual(['s']);
    expect(change.kept.sort()).toEqual(['a', 'b']);
    // Independents sort alphabetically in the topo order, so the new source
    // lands between a and b — the point is that all three are now in it.
    expect(engine.evaluationOrder()).toEqual(['a', 's', 'b']);
    engine.tick();
    expect(engine.getOutput('s', 'v')).toBe(42);
    expect(engine.getOutput('a', 'n')).toBe(4); // a never restarted
  });

  it('serializes overlapping applies; the last one wins and nothing leaks', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    const [first, second] = await Promise.all([
      engine.applyGraph(chain(0, 10)),
      engine.applyGraph(chain(0, 20)),
    ]);
    expect(first.replaced).toEqual(['b']);
    expect(second.replaced).toEqual(['b']);
    // b was built twice and the intermediate instance was disposed, not orphaned.
    expect(calls.init).toEqual(['counter:0', 'counter:0', 'counter:10', 'counter:20']);
    expect(calls.dispose).toEqual(['counter:0', 'counter:10']);
    engine.tick();
    expect(engine.getOutput('b', 'n')).toBe(21);
  });
});

// ---- 4. a bad apply changes nothing --------------------------------------

describe('applyGraph — failure leaves the running graph untouched', () => {
  // [label, spec, expected error, instances the failed compile builds then discards].
  // Only a spec that introduces a NEW node id constructs anything before failing;
  // those instances must be disposed, and the LIVE ones never touched.
  const badSpecs: Array<[string, GraphSpec, RegExp, number]> = [
    [
      'unknown node type',
      { nodes: [{ id: 'a', type: 'counter' }, { id: 'z', type: 'ghost' }], edges: [] },
      /unknown node type/,
      0,
    ],
    [
      'invalid params',
      { nodes: [{ id: 'a', type: 'counter', params: { offset: 'nope' } }], edges: [] },
      /invalid params/,
      0,
    ],
    [
      'edge to an unknown node',
      {
        nodes: [{ id: 'a', type: 'counter' }],
        edges: [{ from: { node: 'a', port: 'n' }, to: { node: 'nope', port: 'in' } }],
      },
      /edge to unknown node/,
      0,
    ],
    [
      'edge to an undeclared port',
      {
        nodes: [
          { id: 'a', type: 'counter' },
          { id: 'b', type: 'counter' },
        ],
        edges: [{ from: { node: 'a', port: 'n' }, to: { node: 'b', port: 'nope' } }],
      },
      /has no input port/,
      0,
    ],
    [
      'fan-in to one input port',
      {
        nodes: [
          { id: 'a', type: 'counter' },
          { id: 'b', type: 'counter' },
          { id: 'c', type: 'counter' },
        ],
        edges: [
          { from: { node: 'a', port: 'n' }, to: { node: 'c', port: 'in' } },
          { from: { node: 'b', port: 'n' }, to: { node: 'c', port: 'in' } },
        ],
      },
      /fan-in/,
      1, // `c` is new: built, then discarded when the fan-in is rejected
    ],
    [
      'a cycle',
      {
        nodes: [
          { id: 'a', type: 'counter' },
          { id: 'b', type: 'counter' },
        ],
        edges: [
          { from: { node: 'a', port: 'n' }, to: { node: 'b', port: 'in' } },
          { from: { node: 'b', port: 'n' }, to: { node: 'a', port: 'in' } },
        ],
      },
      /cycle/,
      0,
    ],
    [
      'duplicate node ids',
      {
        nodes: [
          { id: 'a', type: 'counter' },
          { id: 'a', type: 'counter-b' },
        ],
        edges: [],
      },
      /duplicate node id/,
      0,
    ],
  ];

  for (const [label, bad, pattern, discarded] of badSpecs) {
    it(`rejects ${label} and keeps the running graph evaluating`, async () => {
      const calls = freshCalls();
      const engine = await startedEngine(chain(), registryFor(calls));
      engine.tick();

      await expect(engine.applyGraph(bad)).rejects.toThrow(pattern);

      // Untouched: same order, same live instances, still ticking. Any dispose
      // seen here belongs to a node the failed compile itself built.
      expect(engine.evaluationOrder()).toEqual(['a', 'b']);
      expect(calls.dispose).toHaveLength(discarded);
      expect(engine.graphVersion()).toBe(0);
      engine.tick();
      expect(engine.getOutput('a', 'n')).toBe(2);
      expect(engine.getOutput('b', 'n')).toBe(2);
    });
  }

  it('disposes instances built by a failed compile instead of leaking them', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    // `c` compiles fine, then the cycle check fails — `c` must be torn down.
    await expect(
      engine.applyGraph({
        nodes: [
          { id: 'a', type: 'counter' },
          { id: 'b', type: 'counter' },
          { id: 'c', type: 'counter', params: { offset: 9 } },
        ],
        edges: [
          { from: { node: 'b', port: 'n' }, to: { node: 'c', port: 'in' } },
          { from: { node: 'c', port: 'n' }, to: { node: 'b', port: 'in' } },
        ],
      }),
    ).rejects.toThrow(/cycle/);
    expect(calls.dispose).toEqual(['counter:9']); // only the newly-built one
    expect(calls.init).toHaveLength(2); // a + b, from the original init()
  });

  it('rolls back when a new node\'s init rejects, and the old graph plays on', async () => {
    const calls = freshCalls();
    const disposed: string[] = [];
    const boom = defineNode({
      type: 'boom-init',
      inputs: [],
      outputs: [{ name: 'v', kind: 'number' }],
      params: z.object({}),
      make() {
        return {
          init: async () => {
            throw new Error('model failed to load');
          },
          process: () => ({ v: 1 }),
          dispose: () => void disposed.push('boom'),
        };
      },
    });
    const engine = await startedEngine(chain(), registryFor(calls, [boom]));
    engine.tick();

    await expect(
      engine.applyGraph({
        nodes: [...chain().nodes, { id: 'x', type: 'boom-init' }],
        edges: chain().edges,
      }),
    ).rejects.toThrow(/model failed to load/);

    expect(disposed).toEqual(['boom']); // the half-built node was torn down
    expect(calls.dispose).toEqual([]); // the running nodes were not
    expect(engine.evaluationOrder()).toEqual(['a', 'b']);
    expect(engine.graphVersion()).toBe(0);
    engine.tick();
    expect(engine.getOutput('a', 'n')).toBe(2);
  });

  it('a failed apply does not poison the queue for the next one', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    await expect(engine.applyGraph({ nodes: [{ id: 'a', type: 'ghost' }], edges: [] })).rejects.toThrow();
    const change = await engine.applyGraph(chain(0, 3));
    expect(change.replaced).toEqual(['b']);
    expect(engine.graphVersion()).toBe(1);
  });

  it('refuses to apply to a disposed engine', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    engine.dispose();
    await expect(engine.applyGraph(chain(1))).rejects.toThrow(/disposed/);
  });
});

// ---- 5. lifecycle bookkeeping --------------------------------------------

describe('applyGraph — bookkeeping', () => {
  it('does not init new nodes before the engine itself has been init\'d', async () => {
    const calls = freshCalls();
    const engine = new Engine(chain(), registryFor(calls)); // no init() yet
    await engine.applyGraph({
      nodes: [...chain().nodes, { id: 'c', type: 'counter', params: { offset: 5 } }],
      edges: chain().edges,
    });
    expect(calls.init).toEqual([]); // nothing running, nothing to keep alive

    await engine.init(); // the deferred init covers the WHOLE graph, including 'c'
    expect(calls.init.sort()).toEqual(['counter:0', 'counter:0', 'counter:5']);
  });

  it('waits for an in-flight init() before swapping the graph out from under it', async () => {
    const calls = freshCalls();
    let releaseInit!: () => void;
    const gate = new Promise<void>((r) => {
      releaseInit = r;
    });
    const slow = defineNode({
      type: 'slow-boot',
      inputs: [],
      outputs: [{ name: 'v', kind: 'number' }],
      params: z.object({}),
      make: () => ({ init: () => gate, process: () => ({ v: 1 }) }),
    });
    const engine = new Engine(
      { nodes: [{ id: 's', type: 'slow-boot' }, { id: 'a', type: 'counter' }], edges: [] },
      registryFor(calls, [slow]),
    );
    const booting = engine.init();
    // Ask for a rewire — removing one node and ADDING another — while init() is
    // still walking the CURRENT order. The added node is the sharp case: if the
    // apply committed mid-init it would see `started === false`, skip its own
    // prepare phase, and the in-flight init() (already past that point in its
    // own iteration) would never reach it, leaving `c` permanently un-init'd.
    const applying = engine.applyGraph({
      nodes: [
        { id: 'a', type: 'counter' },
        { id: 'c', type: 'counter', params: { offset: 7 } },
      ],
      edges: [],
    });
    releaseInit();
    await booting;
    const change = await applying;
    expect(change.removed).toEqual(['s']);
    expect(change.kept).toEqual(['a']);
    expect(change.added).toEqual(['c']);
    // init() completed on the full OLD graph first, then the apply init'd the new node.
    expect(calls.init).toEqual(['counter:0', 'counter:7']);
  });

  it('bumps graphVersion on every committed apply and exposes the live spec', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    expect(engine.graphVersion()).toBe(0);
    expect(engine.currentGraph().nodes.map((n) => n.id)).toEqual(['a', 'b']);

    await engine.applyGraph(chain(0, 1));
    expect(engine.graphVersion()).toBe(1);
    await engine.applyGraph(chain(0, 1)); // a no-op apply still commits a version
    expect(engine.graphVersion()).toBe(2);
    expect(engine.currentGraph().nodes[1].params).toEqual({ offset: 1 });
  });

  it('currentGraph returns a fresh container that callers can safely modify', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    const snapshot = engine.currentGraph();
    snapshot.nodes.push({ id: 'intruder', type: 'counter' });
    expect(engine.currentGraph().nodes).toHaveLength(2);
  });

  it('disposes only the surviving-instance complement (no double dispose)', async () => {
    const calls = freshCalls();
    const engine = await startedEngine(chain(), registryFor(calls));
    await engine.applyGraph({ nodes: [], edges: [] });
    expect(calls.dispose).toEqual(['counter:0', 'counter:0']);
    engine.dispose();
    expect(calls.dispose).toHaveLength(2); // the emptied graph has nothing left to dispose
  });

  it('survives a node whose dispose throws', async () => {
    const rude = defineNode({
      type: 'rude',
      inputs: [],
      outputs: [{ name: 'v', kind: 'number' }],
      params: z.object({}),
      make: () => ({
        process: () => ({ v: 1 }),
        dispose: () => {
          throw new Error('teardown exploded');
        },
      }),
    });
    const calls = freshCalls();
    const logged: string[] = [];
    const engine = new Engine({ nodes: [{ id: 'r', type: 'rude' }], edges: [] }, registryFor(calls, [rude]), {
      log: (m) => void logged.push(m),
    });
    await engine.init();
    const change = await engine.applyGraph({ nodes: [{ id: 'a', type: 'counter' }], edges: [] });
    expect(change.removed).toEqual(['r']);
    expect(logged.join()).toMatch(/dispose of node "r" \(rude\) threw/);
    engine.tick();
    expect(engine.getOutput('a', 'n')).toBe(1);
  });
});

// ---- 6. the real production graph ----------------------------------------

describe('applyGraph on the real instrument graph', () => {
  /** A second, contract-satisfying mapping impl — the thing the `mapping` slot exists for. */
  const altMapping = defineNode({
    type: 'alt-mapping',
    roles: ['mapping'],
    inputs: [...MAPPING_SLOT_INPUTS],
    outputs: [MAPPING_SLOT_OUTPUT],
    process: () => ({ params: { voices: [] } }),
  });

  it('a mapping-slot swap replaces exactly one node and keeps the camera nodes', async () => {
    const registry = createRegistry([...CORE_NODES, ...BROWSER_NODES, altMapping]);
    // NB: no engine.init() — webcam-hands lazy-loads MediaPipe inside init(), which
    // is exactly the cost this whole mechanism exists to avoid paying on a swap.
    const engine = new Engine(defaultGraph(), registry);
    const before = engine.evaluationOrder().length;

    const change = await engine.applyGraph(defaultGraph({ mapping: 'alt-mapping' }, registry), registry);

    expect(change.replaced).toEqual(['map']);
    expect(change.added).toEqual([]);
    expect(change.removed).toEqual([]);
    // Every other production node — including the two MediaPipe sources — is kept.
    expect(change.kept).toContain('cam');
    expect(change.kept).toContain('camFace');
    expect(change.kept).toContain('synth');
    expect(change.kept).toHaveLength(before - 1);
    // The swap is edge-stable: the mapping contract guarantees the port names.
    expect(change.rewired).toBe(false);
    expect(engine.evaluationOrder()).toHaveLength(before);
  });

  it('swapping back restores the default mapping, still keeping everything else', async () => {
    const registry = createRegistry([...CORE_NODES, ...BROWSER_NODES, altMapping]);
    const engine = new Engine(defaultGraph(), registry);
    await engine.applyGraph(defaultGraph({ mapping: 'alt-mapping' }, registry), registry);
    const change = await engine.applyGraph(defaultGraph(), registry);
    expect(change.replaced).toEqual(['map']);
    expect(engine.currentGraph().nodes.find((n) => n.id === 'map')?.type).toBe('voice-mapping');
    expect(engine.graphVersion()).toBe(2);
  });

  it('re-applying the production graph is a pure no-op (every node kept)', async () => {
    const engine = new Engine(defaultGraph(), createAppRegistry());
    const change = await engine.applyGraph(defaultGraph());
    expect(change.added).toEqual([]);
    expect(change.removed).toEqual([]);
    expect(change.replaced).toEqual([]);
    expect(change.rewired).toBe(false);
    expect(change.kept).toHaveLength(engine.evaluationOrder().length);
  });

  it('a non-conforming swap is caught by resolveSlot, so the engine never sees it', async () => {
    const registry = createAppRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = new Engine(defaultGraph(), registry);
    // indirect-map carries role:mapping but emits `steer`, not `params`.
    const change = await engine.applyGraph(defaultGraph({ mapping: 'indirect-map' }, registry), registry);
    expect(change.replaced).toEqual([]); // fell back to voice-mapping → nothing changed
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
