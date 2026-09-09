/**
 * `defineMergeNode` — R2 composition (#101 M-E).
 *
 * The behaviours worth pinning are the ones about ABSENCE, because that is what a merge
 * is actually for: two streams that do not both have something to say on every tick.
 */
import { describe, it, expect } from 'vitest';
import {
  defineMergeNode,
  createRegistry,
  runHeadless,
  replayNode,
  MERGE_INPUTS,
  MERGE_OUTPUT,
  type GraphSpec,
} from '@/dag';
import { replaySourceNode } from '@/nodes';

/** Primary wins, secondary is the fallback — the composition case the design names. */
const mergeNum = defineMergeNode<number>({
  type: 'merge-num',
  kind: 'number',
  combine: (a, b) => a ?? b,
});

describe('the shape a merge declares', () => {
  it('is kind-preserving: two inputs and one output, all the same kind', () => {
    expect(mergeNum.inputs.map((p) => p.name)).toEqual([...MERGE_INPUTS]);
    expect(mergeNum.outputs.map((p) => p.name)).toEqual([MERGE_OUTPUT]);
    expect(new Set([...mergeNum.inputs, ...mergeNum.outputs].map((p) => p.kind))).toEqual(new Set(['number']));
  });
});

describe('combining a tick', () => {
  it('hands `combine` both sides, and emits what it returns', async () => {
    const out = await replayNode(mergeNum.make({}), { a: [1, 2, 3], b: [10, 20, 30] }, { dt: 1 / 30 });
    expect(out.map((r) => r[MERGE_OUTPUT])).toEqual([1, 2, 3]);
  });

  it('calls `combine` when ONE side is absent — deciding that is the merge\'s job, not the engine\'s', async () => {
    // The b-only case: a primary that has not produced yet, or a clip that ended.
    const seen: [unknown, unknown][] = [];
    const spy = defineMergeNode<number>({
      type: 'merge-spy', kind: 'number',
      combine: (a, b) => { seen.push([a, b]); return a ?? b; },
    });
    const out = await replayNode(spy.make({}), { a: [undefined, 2], b: [10, 20] }, { dt: 1 / 30 });
    expect(seen).toEqual([[undefined, 10], [2, 20]]);
    expect(out.map((r) => r[MERGE_OUTPUT])).toEqual([10, 2]);
  });

  it('emits NOTHING when both sides are absent, rather than merging two silences', async () => {
    // A node that emits on a port it declares when it has nothing is what validatePorts
    // exists to catch. "There was nothing to merge" is the honest reading.
    let called = 0;
    const spy = defineMergeNode<number>({
      type: 'merge-silent', kind: 'number',
      combine: (a, b) => { called++; return a ?? b; },
    });
    const out = await replayNode(spy.make({}), { a: [undefined], b: [undefined] }, { dt: 1 / 30 });
    expect(called).toBe(0);
    expect(MERGE_OUTPUT in out[0]).toBe(false);
  });

  it('emits nothing when `combine` itself returns undefined — a merge may decline a tick', async () => {
    const dropOdd = defineMergeNode<number>({
      type: 'merge-drop', kind: 'number',
      combine: (a) => (a !== undefined && a % 2 === 0 ? a : undefined),
    });
    const out = await replayNode(dropOdd.make({}), { a: [1, 2, 3, 4] }, { dt: 1 / 30 });
    // Assert on KEY PRESENCE, not value. `{merged: undefined}` and `{}` both read as
    // undefined, and they are not the same thing to the engine: declaring a port and
    // emitting undefined on it is precisely what `EngineOptions.validatePorts` flags.
    expect(out.map((r) => MERGE_OUTPUT in r)).toEqual([false, true, false, true]);
    expect(out.map((r) => r[MERGE_OUTPUT])).toEqual([undefined, 2, undefined, 4]);
  });
});

describe('in a real graph', () => {
  it('merges two replayed streams the engine could not have fanned into one port', async () => {
    // The reason this node exists: the engine rejects two edges into one input port, so
    // composition has to be an explicit, typed node.
    const registry = createRegistry([replaySourceNode, mergeNum]);
    const spec: GraphSpec = {
      nodes: [
        { id: 'primary', type: 'replay-source', params: { values: [undefined, undefined, 7] } },
        { id: 'backup', type: 'replay-source', params: { values: [1, 2, 3] } },
        { id: 'mix', type: 'merge-num', params: {} },
      ],
      edges: [
        { from: { node: 'primary', port: 'value' }, to: { node: 'mix', port: 'a' } },
        { from: { node: 'backup', port: 'value' }, to: { node: 'mix', port: 'b' } },
      ],
    };
    const { recorder } = await runHeadless(spec, registry, { ticks: 3, nominalDt: 1 / 30 });
    // Falls back to the backup until the primary starts producing, then prefers it.
    expect(recorder.values(`mix.${MERGE_OUTPUT}`)).toEqual([1, 2, 7]);
  });

  it('is pure: the same inputs merge identically on a second run', async () => {
    const registry = createRegistry([replaySourceNode, mergeNum]);
    const spec: GraphSpec = {
      nodes: [
        { id: 'a', type: 'replay-source', params: { values: [1, 2, 3] } },
        { id: 'b', type: 'replay-source', params: { values: [9, 9, 9] } },
        { id: 'mix', type: 'merge-num', params: {} },
      ],
      edges: [
        { from: { node: 'a', port: 'value' }, to: { node: 'mix', port: 'a' } },
        { from: { node: 'b', port: 'value' }, to: { node: 'mix', port: 'b' } },
      ],
    };
    const one = await runHeadless(spec, registry, { ticks: 3, nominalDt: 1 / 30 });
    const two = await runHeadless(spec, registry, { ticks: 3, nominalDt: 1 / 30 });
    expect(one.recorder.toFiles()).toEqual(two.recorder.toFiles());
  });
});
