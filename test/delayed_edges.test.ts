/**
 * Delayed edges and the `delay` node (#101 M-G) — the principled end of R3.
 *
 * The engine evaluates each node once per tick in topological order, so feeding a value
 * backwards is a cycle, which `topoSort` rejects. M-F's `StateReader` got feedback anyway
 * by exploiting that order: a zero-input source runs first, so reading a downstream node
 * necessarily returned last tick's value. That works, and it is a trick — the delay is
 * implied by position rather than declared, and it silently becomes a same-tick read if
 * the reader ever stops being topologically first.
 *
 * A delayed edge declares it instead.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Engine, createRegistry, defineNode, runHeadless, type GraphSpec } from '@/dag';
import { delayNode, replaySourceNode, createCoreRegistry } from '@/nodes';
import { loadStream } from './helpers/fixtures';
import { z } from 'zod';

/** Emits `seed` on the first tick, then whatever came back on `fed`, plus one. */
const accumulator = defineNode({
  type: 'accum', roles: ['source'], params: z.object({}),
  inputs: [{ name: 'fed', kind: 'any' }],
  outputs: [{ name: 'n', kind: 'any' }],
  make: () => ({ process: (inputs) => ({ n: typeof inputs.fed === 'number' ? inputs.fed + 1 : 0 }) }),
});

const passthrough = defineNode({
  type: 'pass', roles: ['mapping'], params: z.object({}),
  inputs: [{ name: 'in', kind: 'any' }],
  outputs: [{ name: 'out', kind: 'any' }],
  process: (inputs) => (inputs.in === undefined ? {} : { out: inputs.in }),
});

describe('a delayed edge breaks a cycle the engine would otherwise reject', () => {
  const registry = () => createRegistry([accumulator, passthrough, delayNode]);
  const cyclic = (delayed: boolean): GraphSpec => ({
    nodes: [
      { id: 'a', type: 'accum', params: {} },
      { id: 'p', type: 'pass', params: {} },
    ],
    edges: [
      { from: { node: 'a', port: 'n' }, to: { node: 'p', port: 'in' } },
      { from: { node: 'p', port: 'out' }, to: { node: 'a', port: 'fed' }, delayed },
    ],
  });

  it('the SAME graph is a cycle without the flag and legal with it', async () => {
    expect(() => new Engine(cyclic(false), registry(), {})).toThrow(/cycle/);
    expect(() => new Engine(cyclic(true), registry(), {})).not.toThrow();
  });

  it('feeds back exactly one tick, so the accumulator counts', async () => {
    const { recorder } = await runHeadless(cyclic(true), registry(), { ticks: 5, nominalDt: 1 / 30 });
    // Tick 0 has no previous output, so `fed` is absent and the node seeds 0.
    expect(recorder.values('a.n')).toEqual([0, 1, 2, 3, 4]);
  });

  it('legalises a self-loop, which is an accumulator rather than a cycle', async () => {
    const spec: GraphSpec = {
      nodes: [{ id: 'a', type: 'accum', params: {} }],
      edges: [{ from: { node: 'a', port: 'n' }, to: { node: 'a', port: 'fed' }, delayed: true }],
    };
    const { recorder } = await runHeadless(spec, registry(), { ticks: 4, nominalDt: 1 / 30 });
    expect(recorder.values('a.n')).toEqual([0, 1, 2, 3]);
    // ...and the same edge without the flag is still refused.
    expect(() => new Engine({ ...spec, edges: [{ ...spec.edges[0], delayed: false }] }, registry(), {})).toThrow(/self-loop/);
  });

  it('reads the SNAPSHOT, not whatever `outputs` happens to hold — proven against a source that already ran', async () => {
    // This is the assertion that separates a declared delay from M-F's ordering trick,
    // and getting it to discriminate takes care. With ONLY a delayed edge the two nodes
    // are independent, so the sort orders them alphabetically and the reader may well run
    // first — at which point `outputs` still holds last tick's value and reading the
    // wrong map looks identical. A first attempt here passed with the delay removed.
    //
    // So the source is forced to run FIRST, by giving the reader an ordinary edge from it
    // as well. Now `outputs.get('a')` is unambiguously THIS tick's value, and only the
    // snapshot yields the previous one. `now` and `past` come from the same node on the
    // same tick and must differ by exactly one.
    const pair = defineNode({
      type: 'pair', roles: ['mapping'], params: z.object({}),
      inputs: [{ name: 'now', kind: 'any' }, { name: 'past', kind: 'any' }],
      outputs: [{ name: 'both', kind: 'any' }],
      process: (inputs) => ({ both: [inputs.now ?? null, inputs.past ?? null] }),
    });
    const spec: GraphSpec = {
      nodes: [
        { id: 'a', type: 'replay-source', params: { values: [10, 20, 30, 40] } },
        { id: 'z', type: 'pair', params: {} },
      ],
      edges: [
        { from: { node: 'a', port: 'value' }, to: { node: 'z', port: 'now' } },
        { from: { node: 'a', port: 'value' }, to: { node: 'z', port: 'past' }, delayed: true },
      ],
    };
    const { engine, recorder } = await runHeadless(spec, createRegistry([replaySourceNode, pair, delayNode]), {
      ticks: 4, nominalDt: 1 / 30,
    });
    // The ordinary edge makes `a` a real dependency, so it is evaluated first.
    expect(engine.evaluationOrder()).toEqual(['a', 'z']);
    expect(recorder.values('z.both')).toEqual([
      [10, null], // tick 0: no previous tick to read
      [20, 10],
      [30, 20],
      [40, 30],
    ]);
  });
});

describe('the delay node aligns streams (it does NOT break cycles)', () => {
  const registry = () => createRegistry([replaySourceNode, delayNode]);
  const spec = (ticks: number): GraphSpec => ({
    nodes: [
      { id: 'src', type: 'replay-source', params: { values: [1, 2, 3, 4, 5] } },
      { id: 'd', type: 'delay', params: { ticks } },
    ],
    edges: [{ from: { node: 'src', port: 'value' }, to: { node: 'd', port: 'value' } }],
  });

  it('delays by N ticks, emitting nothing until it has that much history', async () => {
    const one = await runHeadless(spec(1), registry(), { ticks: 5, nominalDt: 1 / 30 });
    expect(one.recorder.values('d.value')).toEqual([1, 2, 3, 4]);
    const three = await runHeadless(spec(3), registry(), { ticks: 5, nominalDt: 1 / 30 });
    expect(three.recorder.values('d.value')).toEqual([1, 2]);
  });

  it('cannot break a cycle — the sort still sees its edges', () => {
    // The mistake worth naming: a delay NODE in a feedback path is still a cycle.
    const cyclic: GraphSpec = {
      nodes: [
        { id: 'a', type: 'accum', params: {} },
        { id: 'd', type: 'delay', params: { ticks: 1 } },
      ],
      edges: [
        { from: { node: 'a', port: 'n' }, to: { node: 'd', port: 'value' } },
        { from: { node: 'd', port: 'value' }, to: { node: 'a', port: 'fed' } },
      ],
    };
    expect(() => new Engine(cyclic, createRegistry([accumulator, delayNode]), {})).toThrow(/cycle/);
  });
});

describe('a graph with no delayed edge is untouched', () => {
  it('reproduces the committed byte-identity digests exactly', async () => {
    // The engine change adds a per-tick snapshot of `outputs`. Held against the same
    // digests the Applier refactor was, because an engine change is exactly where a
    // recorded stream could shift without any behavioural test noticing.
    //
    // Note what this does NOT prove: the snapshot is gated on the graph having a delayed
    // edge, and that gate is a PERFORMANCE property, not a correctness one. Taking the
    // snapshot unconditionally produces identical bytes — it is simply a Map copy per
    // tick that no shipped graph needs. Removing the gate leaves this suite green, and
    // saying so is better than implying a guard that is not there.
    const GOLDEN: Record<string, string> = {
      'feat.features.ndjson': '02e5f35fdfc3369e95d5d8a2820e081be5d3cad780c5d23c4770719bc1158527',
      'map.params.ndjson': '4cc5a8d8e2a4bed20cc1b21e038dc09b3436c66632d799b7f7799d315fbd4329',
      'src.value.ndjson': '386274e074a0041b005ee3d7e75709323bdbcaf255c2b5c29804ca621a9b39ef',
    };
    const hands = loadStream('video_hand_sweep', 'src.hands');
    const spec: GraphSpec = {
      nodes: [
        { id: 'src', type: 'replay-source', params: { values: hands } },
        { id: 'feat', type: 'hand-features', params: {} },
        { id: 'map', type: 'voice-mapping', params: {} },
      ],
      edges: [
        { from: { node: 'src', port: 'value' }, to: { node: 'feat', port: 'hands' } },
        { from: { node: 'feat', port: 'features' }, to: { node: 'map', port: 'features' } },
      ],
    };
    const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks: 60, nominalDt: 1 / 30 });
    const actual: Record<string, string> = {};
    for (const [name, text] of Object.entries(recorder.toFiles())) {
      actual[name] = createHash('sha256').update(text).digest('hex');
    }
    expect(actual).toEqual(GOLDEN);
  });
});
