/**
 * `composeGraph`'s four rules (ADR §3.2), each pinned on small synthetic branches, plus the
 * property the review asked for: every branch subset the real table can produce compiles
 * against the real registry (the engine validates every edge endpoint and refuses fan-in,
 * so "compiles" is the check that no cross-branch edge dangles).
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { composeGraph, ComposeError, defineBranch } from '@/instruments';
import { composeInstrumentGraph, ALL_BRANCHES, ALL_BRANCH_IDS } from '@/app/graph';

const MERGE = { node: 'merge', pools: { instrument: ['v1', 'v2'], score: ['s1'] } } as const;

const trunk = defineBranch({
  id: 'trunk',
  nodes: [
    { id: 'src', type: 'synthetic-hands', params: {} },
    { id: 'merge', type: 'synth-merge', params: {} },
  ],
});

describe('composeGraph rules', () => {
  it('1: a node declared by two branches must be the same node', () => {
    const a = defineBranch({ id: 'a', nodes: [{ id: 'x', type: 'one-euro', params: { minCutoff: 1 } }] });
    const same = defineBranch({ id: 'same', nodes: [{ id: 'x', type: 'one-euro', params: { minCutoff: 1 } }] });
    const other = defineBranch({ id: 'other', nodes: [{ id: 'x', type: 'one-euro', params: { minCutoff: 2 } }] });
    expect(composeGraph(['a', 'same'], [a, same]).spec.nodes).toHaveLength(1);
    expect(() => composeGraph(['a', 'other'], [a, other])).toThrow(ComposeError);
    expect(() => composeGraph(['a', 'other'], [a, other])).toThrow(/"a" and "other"/);
  });

  it('1: a slotted node takes the resolved type, and its params by type', () => {
    const b = defineBranch({
      id: 'b',
      nodes: [{ id: 'cam', slot: 'source', params: {}, paramsByType: { 'webcam-hands': { maxHands: 2 } } }],
    });
    expect(composeGraph(['b'], [b], { slots: { source: 'webcam-hands' } }).spec.nodes[0]).toEqual({
      id: 'cam',
      type: 'webcam-hands',
      params: { maxHands: 2 },
    });
    expect(composeGraph(['b'], [b], { slots: { source: 'synthetic-hands' } }).spec.nodes[0]).toEqual({
      id: 'cam',
      type: 'synthetic-hands',
      params: {},
    });
    expect(() => composeGraph(['b'], [b])).toThrow(/slot "source"/);
  });

  it('2: an optional edge to an absent node is dropped; a required one is an error naming the fix', () => {
    const consumer = defineBranch({
      id: 'consumer',
      nodes: [{ id: 'y', type: 'one-euro', params: {} }],
      edges: [{ from: { node: 'src', port: 'hands' }, to: { node: 'y', port: 'value' }, optional: true }],
    });
    const strict = defineBranch({
      id: 'strict',
      nodes: [{ id: 'z', type: 'one-euro', params: {} }],
      edges: [{ from: { node: 'src', port: 'hands' }, to: { node: 'z', port: 'value' } }],
    });
    expect(composeGraph(['consumer'], [trunk, consumer]).spec.edges).toEqual([]);
    expect(composeGraph(['trunk', 'consumer'], [trunk, consumer]).spec.edges).toHaveLength(1);
    expect(() => composeGraph(['strict'], [trunk, strict])).toThrow(/requires.*optional/);
  });

  it('2: two edges into one input are refused with both branch names', () => {
    const p = defineBranch({
      id: 'p',
      nodes: [{ id: 'y', type: 'one-euro', params: {} }],
      edges: [{ from: { node: 'src', port: 'hands' }, to: { node: 'y', port: 'value' } }],
    });
    const q = defineBranch({
      id: 'q',
      edges: [{ from: { node: 'merge', port: 'params' }, to: { node: 'y', port: 'value' } }],
    });
    expect(() => composeGraph(['trunk', 'p', 'q'], [trunk, p, q])).toThrow(/"p" and "q"/);
  });

  it('2: the same edge declared by two branches is one edge', () => {
    const p = defineBranch({
      id: 'p',
      nodes: [{ id: 'y', type: 'one-euro', params: {} }],
      edges: [{ from: { node: 'src', port: 'hands' }, to: { node: 'y', port: 'value' } }],
    });
    const q = defineBranch({ id: 'q', edges: [{ from: { node: 'src', port: 'hands' }, to: { node: 'y', port: 'value' } }] });
    expect(composeGraph(['trunk', 'p', 'q'], [trunk, p, q]).spec.edges).toHaveLength(1);
  });

  it('2: requirements are resolved transitively and once; the composition order is the library order', () => {
    const a = defineBranch({ id: 'a', requires: ['b'] });
    const b = defineBranch({ id: 'b', requires: ['c'] });
    const c = defineBranch({ id: 'c' });
    expect(composeGraph(['a', 'c'], [a, b, c]).branches).toEqual(['a', 'b', 'c']);
    expect(composeGraph(['c', 'a'], [a, b, c]).branches).toEqual(['a', 'b', 'c']);
    expect(() => composeGraph(['a'], [a, b])).toThrow(/unknown branch "c".*required via a → b/);
    const loop = defineBranch({ id: 'loop', requires: ['loop'] });
    expect(() => composeGraph(['loop'], [loop])).toThrow(/cycle/);
  });

  it('3: voices are allocated to the pool of their role, in branch order, and a full pool is an error', () => {
    const mk = (id: string, role: 'instrument' | 'score') =>
      defineBranch({
        id,
        nodes: [{ id: `${id}N`, type: 'one-euro', params: {} }],
        voices: [{ from: { node: `${id}N`, port: 'value' }, role }],
      });
    const [i1, i2, s1, i3] = [mk('i1', 'instrument'), mk('i2', 'instrument'), mk('s1', 'score'), mk('i3', 'instrument')];
    const { spec } = composeGraph(['trunk', 'i1', 's1', 'i2'], [trunk, i1, i2, s1], { merge: MERGE });
    const into = Object.fromEntries(spec.edges.map((e) => [e.from.node, e.to.port]));
    expect(into).toEqual({ i1N: 'v1', s1N: 's1', i2N: 'v2' });
    expect(() => composeGraph(['trunk', 'i1', 'i2', 'i3'], [trunk, i1, i2, i3], { merge: MERGE })).toThrow(/pool "instrument" is full/);
    expect(() => composeGraph(['trunk', 'i1'], [trunk, i1])).toThrow(/no merge target/);
    const again = mk('again', 'instrument');
    const dup = defineBranch({ id: 'dup', voices: [{ from: { node: 'againN', port: 'value' }, role: 'instrument' }] });
    expect(() => composeGraph(['trunk', 'again', 'dup'], [trunk, again, dup], { merge: MERGE })).toThrow(/one owner/);
  });

  it('3: allocation is order-independent: the hand voices land on voice1 whatever order the caller names', () => {
    const byOrder = (ids: string[]) =>
      Object.fromEntries(composeInstrumentGraph(ids).spec.edges.filter((e) => e.to.node === 'merge' && e.from.node !== 'ui').map((e) => [e.from.node, e.to.port]));
    expect(byOrder(['trunk', 'air-flute', 'field-voices'])).toEqual({ map: 'voice1', airFlute: 'voice2' });
    expect(byOrder(['air-flute', 'face-timbre'])).toEqual({ map: 'voice1', airFlute: 'voice2' });
    expect(byOrder(['conductor', 'field-voices'])).toEqual({ map: 'voice1', score: 'score1' });
  });

  it('a branch table is frozen: mutating one composition cannot leak into the next', () => {
    const feat = composeInstrumentGraph(ALL_BRANCH_IDS).spec.nodes.find((n) => n.id === 'feat')!;
    expect(Object.isFrozen(feat.params)).toBe(true);
    expect(() => {
      (feat.params as { mirrorX: boolean }).mirrorX = false;
    }).toThrow();
    const again = composeInstrumentGraph(ALL_BRANCH_IDS).spec.nodes.find((n) => n.id === 'feat')!;
    expect((again.params as { mirrorX: boolean }).mirrorX).toBe(true);
  });

  it('4: the element set is the deduplicated union, in first-seen order', () => {
    const a = defineBranch({ id: 'a', overlay: ['video', 'markers'] });
    const b = defineBranch({ id: 'b', overlay: ['markers', 'faceLandmarks'] });
    expect(composeGraph(['a', 'b'], [a, b]).elements).toEqual(['video', 'markers', 'faceLandmarks']);
  });

  it('is deterministic: the same ids give the same spec', () => {
    const one = composeInstrumentGraph(ALL_BRANCH_IDS);
    const two = composeInstrumentGraph(ALL_BRANCH_IDS);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});

/** A tiny seeded generator so the subset property is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('every branch subset of the real table compiles against the real registry', () => {
  const registry = createAppRegistry();
  const optional = ALL_BRANCHES.map((b) => b.id).filter((id) => id !== 'trunk');
  const compiles = (ids: readonly string[]): void => {
    const { spec } = composeInstrumentGraph(['trunk', ...ids], undefined, registry);
    // The constructor compiles: resolves every type, validates every edge endpoint and
    // port, and refuses fan-in and cycles. No init, no tick, no models.
    const engine = new Engine(spec, registry);
    engine.dispose();
  };

  it('the trunk alone, and each branch alone with its requirements', () => {
    compiles([]);
    for (const id of optional) compiles([id]);
  });

  it('every pair', () => {
    for (let i = 0; i < optional.length; i++) {
      for (let j = i + 1; j < optional.length; j++) compiles([optional[i], optional[j]]);
    }
  });

  it('300 random subsets (seeded)', () => {
    const rnd = lcg(0x5eed);
    for (let n = 0; n < 300; n++) {
      const ids = optional.filter(() => rnd() < 0.5);
      compiles(ids);
    }
  });
});
