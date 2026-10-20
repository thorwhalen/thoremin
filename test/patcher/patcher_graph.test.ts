/**
 * The patcher's pure halves (#14) over the REAL composed graph: the layered layout of the shipped
 * default graph, the settings the inspector finds for its nodes, and the live-graph sink against a
 * real `Engine` re-wired by `applyGraph`.
 */
import { describe, it, expect } from 'vitest';
import { Engine, type GraphSpec } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import { settingsForm } from '@/app/dials/settingsStore';
import { columnsOf, layoutGraph } from '@thoremin/ext-patcher/lib/layout';
import { DERIVED_PORT_DIALS, dialsForPort, settingsFeeding, summarize, wiringOf } from '@thoremin/ext-patcher/lib/inspect';
import { isGraphReader, makeLiveGraphSink, useLiveGraph } from '@thoremin/ext-patcher/app/liveGraph';
import { hasExtension } from '../helpers/extensions';

const PATCHER = hasExtension('patcher');
const FIELD_KEYS = settingsForm.fields.map((f) => f.key);

describe.runIf(PATCHER)('the patcher: layout', () => {
  it('places every node of the shipped graph once, every ordinary edge pointing right', () => {
    const spec = defaultGraph();
    const placed = layoutGraph(spec);
    expect(placed.map((p) => p.id).sort()).toEqual(spec.nodes.map((n) => n.id).sort());
    expect(new Set(placed.map((p) => `${p.x},${p.y}`)).size).toBe(placed.length);
    const column = new Map(placed.map((p) => [p.id, p.column]));
    for (const e of spec.edges.filter((e) => !e.delayed)) expect(column.get(e.from.node)!, `${e.from.node} -> ${e.to.node}`).toBeLessThan(column.get(e.to.node)!);
  });

  it('a source sits in column 0, and a cycle (which the engine refuses) does not hang the layout', () => {
    const cyclic: GraphSpec = {
      nodes: [{ id: 'a', type: 't' }, { id: 'b', type: 't' }, { id: 'c', type: 't' }],
      edges: [
        { from: { node: 'a', port: 'o' }, to: { node: 'b', port: 'i' } },
        { from: { node: 'b', port: 'o' }, to: { node: 'c', port: 'i' } },
        { from: { node: 'c', port: 'o' }, to: { node: 'b', port: 'j' } },
      ],
    };
    const columns = columnsOf(cyclic);
    expect(columns.get('a')).toBe(0);
    expect(columns.size).toBe(3);
  });
});

describe.runIf(PATCHER)('the patcher: which settings feed a node', () => {
  const spec = defaultGraph();
  const controlsPorts = [...new Set(spec.edges.filter((e) => e.from.node === 'ui').map((e) => e.from.port))];

  it('every alias the shipped graph uses names real dials', () => {
    const used = controlsPorts.filter((p) => p in DERIVED_PORT_DIALS);
    expect(used.length).toBeGreaterThan(5);
    for (const port of used) expect(dialsForPort(port, FIELD_KEYS), port).not.toEqual([]);
  });

  it('every structured dial the graph carries under its own key is found (the whole-object slices)', () => {
    for (const port of controlsPorts.filter((p) => settingsForm.fields.some((f) => f.key === p && f.isStructured))) {
      expect(dialsForPort(port, FIELD_KEYS)).toEqual([port]);
    }
  });

  it('the voice mapping is fed by the right voice, the magnetism and the octave shift', () => {
    const keys = settingsFeeding(spec, 'map', FIELD_KEYS).flatMap((f) => f.keys);
    expect(keys).toEqual(expect.arrayContaining(['right.root', 'right.type', 'right.sound', 'left.sound', 'master.magnetism', 'master.octaveShift']));
  });

  it('a port that is no setting (the hush, a transient) is listed with no dial: read-only', () => {
    const feeds = settingsFeeding(spec, 'merge', FIELD_KEYS);
    expect(feeds.find((f) => f.port === 'hushVoices')?.keys).toEqual([]);
  });

  it('a node no setting feeds gets nothing, and its wiring is listed both ways', () => {
    expect(settingsFeeding(spec, 'cam', FIELD_KEYS)).toEqual([]);
    const { inputs, outputs } = wiringOf(spec, 'map');
    expect(inputs.length).toBeGreaterThan(0);
    expect(outputs.length).toBeGreaterThan(0);
  });

  it('summarizes a live value in one short line', () => {
    expect(summarize(undefined)).toBe('(nothing)');
    expect(summarize(0.12345)).toBe('0.123');
    expect(summarize([1, 2, 3])).toBe('[3]');
    expect(summarize({ a: 'x'.repeat(100) }).length).toBeLessThanOrEqual(60);
  });
});

describe.runIf(PATCHER)('the patcher: the live graph', () => {
  it('a real engine is a graph reader; the sink publishes its graph, then again only after a re-wire', async () => {
    const engine = new Engine(defaultGraph(), createAppRegistry());
    expect(isGraphReader(engine)).toBe(true);
    useLiveGraph.setState({ spec: null, version: -1, reader: null });
    const sink = makeLiveGraphSink(engine);
    sink(0);
    const first = useLiveGraph.getState();
    expect(first.spec?.nodes.length).toBe(defaultGraph().nodes.length);
    expect(first.reader).toBe(engine);
    sink(1);
    expect(useLiveGraph.getState().spec).toBe(first.spec);

    const smaller = defaultGraph();
    const drop = smaller.nodes.find((n) => !smaller.edges.some((e) => e.from.node === n.id))!;
    await engine.applyGraph({ nodes: smaller.nodes.filter((n) => n !== drop), edges: smaller.edges.filter((e) => e.to.node !== drop.id) });
    sink(2);
    expect(useLiveGraph.getState().version).toBe(first.version + 1);
    expect(useLiveGraph.getState().spec?.nodes.some((n) => n.id === drop.id)).toBe(false);
    engine.dispose();
  });

  it('a reader that is not an engine (a test double) leaves the store alone', () => {
    useLiveGraph.setState({ spec: null, version: -1, reader: null });
    makeLiveGraphSink({ getOutput: () => undefined })(0);
    expect(useLiveGraph.getState().spec).toBeNull();
  });
});
