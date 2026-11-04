/**
 * Declared resource reads are checked at init (#974 item 1).
 *
 * A node declares the host resources it needs (`defineNode({ reads })`, #960). Under
 * `EngineOptions.checkReads`, on by default in `runHeadless`, the engine refuses to init a graph
 * whose host left a declared key out of `resources`, and refuses an `applyGraph` that would add
 * such a node, before the running graph is touched. So a replay or a test that forgets to provide
 * the video or the audio input fails at once, naming the node, its type and the key, instead of
 * recording a source that silently emitted nothing. A plain `Engine` (the live host, which fills a
 * resource only once it has acquired it) does not check unless asked.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Engine, createRegistry, defineNode, runHeadless, type GraphSpec } from '@thoremin/dag';

const camera = defineNode({
  type: 'test-camera',
  inputs: [],
  outputs: [{ name: 'x', kind: 'number' }],
  params: z.object({}),
  reads: ['video'],
  make: () => ({ process: () => ({ x: 1 }) }),
});
const plain = defineNode({
  type: 'test-plain',
  inputs: [],
  outputs: [{ name: 'x', kind: 'number' }],
  params: z.object({}),
  make: () => ({ process: () => ({ x: 2 }) }),
});
const registry = createRegistry([camera, plain]);
const withCamera: GraphSpec = { nodes: [{ id: 'cam', type: 'test-camera' }], edges: [] };
const withoutCamera: GraphSpec = { nodes: [{ id: 'p', type: 'test-plain' }], edges: [] };

describe('runHeadless checks declared reads at init', () => {
  it('fails naming the node, its type and the missing key', async () => {
    await expect(runHeadless(withCamera, registry, { ticks: 1 })).rejects.toThrow(/node "cam" \(test-camera\) reads "video"/);
  });

  it('runs when the resource is provided', async () => {
    const { engine } = await runHeadless(withCamera, registry, { ticks: 1, resources: { video: {} } });
    expect(engine.getOutput('cam', 'x')).toBe(1);
  });

  it('counts a key holding undefined as missing', async () => {
    await expect(runHeadless(withCamera, registry, { ticks: 1, resources: { video: undefined } })).rejects.toThrow(/reads "video"/);
  });

  it('opts out per call with false', async () => {
    const { engine } = await runHeadless(withCamera, registry, { ticks: 1, checkReads: false });
    expect(engine.getOutput('cam', 'x')).toBe(1);
  });

  it('keeps the check on when the option key is present but undefined', async () => {
    await expect(runHeadless(withCamera, registry, { ticks: 1, checkReads: undefined })).rejects.toThrow(/reads "video"/);
  });
});

describe('Engine.checkReads', () => {
  it('is off in a plain Engine', async () => {
    const engine = new Engine(withCamera, registry);
    await engine.init();
    engine.tick();
    expect(engine.getOutput('cam', 'x')).toBe(1);
  });

  it('refuses an applyGraph that adds an unprovided reader, leaving the running graph as it was', async () => {
    const engine = new Engine(withoutCamera, registry, { checkReads: true });
    await engine.init();
    engine.tick();
    await expect(engine.applyGraph(withCamera)).rejects.toThrow(/node "cam" \(test-camera\) reads "video"/);
    expect(engine.currentGraph().nodes.map((n) => n.id)).toEqual(['p']);
    engine.tick();
    expect(engine.getOutput('p', 'x')).toBe(2);
  });
});

describe('checkReads: { omit }', () => {
  it('exempts the omitted keys and still checks the rest', async () => {
    const both = defineNode({
      type: 'test-both',
      inputs: [],
      outputs: [{ name: 'x', kind: 'number' }],
      params: z.object({}),
      reads: ['video', 'audioInput'],
      make: () => ({ process: () => ({ x: 3 }) }),
    });
    const reg = createRegistry([both]);
    const spec: GraphSpec = { nodes: [{ id: 'b', type: 'test-both' }], edges: [] };
    await expect(runHeadless(spec, reg, { ticks: 1, checkReads: { omit: ['video'] } })).rejects.toThrow(/node "b" \(test-both\) reads "audioInput"/);
    const { engine } = await runHeadless(spec, reg, { ticks: 1, checkReads: { omit: ['video'] }, resources: { audioInput: {} } });
    expect(engine.getOutput('b', 'x')).toBe(3);
  });
});
