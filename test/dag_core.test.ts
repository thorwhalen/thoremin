/**
 * Tests for the DAG runtime itself, using small toy nodes (no audio/video).
 * Proves: topo ordering, input gathering + defaults, stateful nodes, fan-in
 * rejection, cycle detection, edge recording, and single-node replay.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  defineNode,
  createRegistry,
  Engine,
  StreamRecorder,
  runHeadless,
  replayNode,
  serializeRecords,
  parseRecords,
  type GraphSpec,
} from '@/dag';

// A source that emits an incrementing counter (stateful).
const counter = defineNode<{ start: number; step: number }>({
  type: 'counter',
  inputs: [],
  outputs: [{ name: 'n', kind: 'number' }],
  params: z.object({ start: z.number().default(0), step: z.number().default(1) }),
  make({ start, step }) {
    let n = start;
    return {
      process() {
        const out = { n };
        n += step;
        return out;
      },
    };
  },
});

// A pure node: out = a * gain + b (b defaults to 0 when unconnected).
const affine = defineNode<{ gain: number }>({
  type: 'affine',
  inputs: [
    { name: 'a', kind: 'number' },
    { name: 'b', kind: 'number', default: 0 },
  ],
  outputs: [{ name: 'out', kind: 'number' }],
  params: z.object({ gain: z.number().default(1) }),
  process(inputs, { gain }) {
    const a = (inputs.a as number) ?? 0;
    const b = (inputs.b as number) ?? 0;
    return { out: a * gain + b };
  },
});

const registry = () => createRegistry([counter, affine]);

describe('Engine topology & evaluation', () => {
  it('evaluates nodes in dependency order and threads values along edges', () => {
    const spec: GraphSpec = {
      nodes: [
        { id: 'c', type: 'counter', params: { start: 1, step: 1 } },
        { id: 'm', type: 'affine', params: { gain: 10 } },
      ],
      edges: [{ from: { node: 'c', port: 'n' }, to: { node: 'm', port: 'a' } }],
    };
    const engine = new Engine(spec, registry());
    expect(engine.evaluationOrder()).toEqual(['c', 'm']);

    engine.tick();
    expect(engine.getOutput('c', 'n')).toBe(1);
    expect(engine.getOutput('m', 'out')).toBe(10);

    engine.tick();
    expect(engine.getOutput('c', 'n')).toBe(2);
    expect(engine.getOutput('m', 'out')).toBe(20);
  });

  it('applies input port defaults when an input is unconnected', () => {
    const spec: GraphSpec = {
      nodes: [{ id: 'm', type: 'affine', params: { gain: 2 } }],
      edges: [],
    };
    const engine = new Engine(spec, registry());
    engine.tick();
    // a is unconnected (treated as 0), b defaults to 0 -> out = 0
    expect(engine.getOutput('m', 'out')).toBe(0);
  });

  it('rejects fan-in to a single input port', () => {
    const spec: GraphSpec = {
      nodes: [
        { id: 'c1', type: 'counter' },
        { id: 'c2', type: 'counter' },
        { id: 'm', type: 'affine' },
      ],
      edges: [
        { from: { node: 'c1', port: 'n' }, to: { node: 'm', port: 'a' } },
        { from: { node: 'c2', port: 'n' }, to: { node: 'm', port: 'a' } },
      ],
    };
    expect(() => new Engine(spec, registry())).toThrow(/fan-in/);
  });

  it('rejects unknown ports and unknown node types', () => {
    expect(
      () =>
        new Engine(
          {
            nodes: [{ id: 'c', type: 'counter' }, { id: 'm', type: 'affine' }],
            edges: [{ from: { node: 'c', port: 'nope' }, to: { node: 'm', port: 'a' } }],
          },
          registry(),
        ),
    ).toThrow(/no output port/);
    expect(() => new Engine({ nodes: [{ id: 'x', type: 'ghost' }], edges: [] }, registry())).toThrow(
      /unknown node type/,
    );
  });

  it('detects cycles', () => {
    const spec: GraphSpec = {
      nodes: [
        { id: 'm1', type: 'affine' },
        { id: 'm2', type: 'affine' },
      ],
      edges: [
        { from: { node: 'm1', port: 'out' }, to: { node: 'm2', port: 'a' } },
        { from: { node: 'm2', port: 'out' }, to: { node: 'm1', port: 'a' } },
      ],
    };
    expect(() => new Engine(spec, registry())).toThrow(/cycle/);
  });
});

describe('Recording & replay', () => {
  it('records every edge value via a tap', async () => {
    const spec: GraphSpec = {
      nodes: [
        { id: 'c', type: 'counter', params: { start: 0, step: 2 } },
        { id: 'm', type: 'affine', params: { gain: 3 } },
      ],
      edges: [{ from: { node: 'c', port: 'n' }, to: { node: 'm', port: 'a' } }],
    };
    const { recorder } = await runHeadless(spec, registry(), { ticks: 3 });
    expect(recorder.values('c.n')).toEqual([0, 2, 4]);
    expect(recorder.values('m.out')).toEqual([0, 6, 12]);
  });

  it('round-trips records through NDJSON', () => {
    const rec = new StreamRecorder();
    rec.onValue('k', { x: 1 }, { tick: 0, time: 0, dt: 0, resources: {} });
    rec.onValue('k', { x: 2 }, { tick: 1, time: 0.5, dt: 0.5, resources: {} });
    const ndjson = serializeRecords(rec.get('k'));
    const parsed = parseRecords(ndjson);
    expect(parsed).toHaveLength(2);
    expect(parsed[1].value).toEqual({ x: 2 });
    expect(parsed[1].t).toBe(0.5);
  });

  it('replays a recorded stream into a downstream node in isolation', async () => {
    // Pretend "c.n" was recorded earlier; replay it into a fresh affine node.
    const recordedA = [0, 2, 4, 6];
    const outs = await replayNode(affine.make(affine.params.parse({ gain: 5 })), { a: recordedA });
    expect(outs.map((o) => o.out)).toEqual([0, 10, 20, 30]);
  });
});
