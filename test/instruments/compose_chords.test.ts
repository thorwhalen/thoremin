/**
 * Chord producers as a pool (#600 S4): a branch declares `chords` (a chord-tone stream and a
 * priority) instead of naming one of the chord selector's inputs, and the composer allocates the
 * inputs by priority, highest first, the way it allocates voices into the merge. An explicit edge
 * into the pool (the ASL extension, pinned before the pool existed, wires `c` itself) keeps its
 * input, and the declared producers take the free ones.
 */
import { describe, expect, it } from 'vitest';
import { composeGraph, ComposeError, defineBranch, type ChordTarget } from '@/instruments';
import { chordPool } from '@/nodes/mapping/chord_select.schema';
import { makeChordSelectNode } from '@/nodes/mapping/chord_select';
import { composeInstrumentGraph } from '@/app/graph';

const TARGET: ChordTarget = { node: 'sel', type: 'chord-select', params: {}, pool: chordPool(4), outputs: [{ port: 'chord', to: { node: 'overlay', port: 'chord' } }] };
const overlay = defineBranch({ id: 'overlay', nodes: [{ id: 'overlay', type: 'canvas-overlay' }] });
const producer = (id: string, priority: number) => defineBranch({ id, nodes: [{ id, type: 'chord' }], chords: [{ from: { node: id, port: 'triad' }, priority }] });
const inputOf = (edges: { from: { node: string }; to: { node: string; port: string } }[], from: string) => edges.find((e) => e.from.node === from && e.to.node === 'sel')?.to.port;

describe('the chord pool', () => {
  it('allocates by priority, highest first, whatever the branch order', () => {
    const lib = [overlay, producer('low', 5), producer('high', 30), producer('mid', 20)];
    const { spec } = composeGraph(['overlay', 'low', 'high', 'mid'], lib, { chords: TARGET });
    expect([inputOf(spec.edges, 'high'), inputOf(spec.edges, 'mid'), inputOf(spec.edges, 'low')]).toEqual(['a', 'b', 'c']);
  });

  it('composes the selector and its edge to the overlay when no branch declares it', () => {
    const { spec } = composeGraph(['overlay', 'low'], [overlay, producer('low', 5)], { chords: TARGET });
    expect(spec.nodes).toContainEqual({ id: 'sel', type: 'chord-select', params: {} });
    expect(spec.edges).toContainEqual({ from: { node: 'sel', port: 'chord' }, to: { node: 'overlay', port: 'chord' } });
  });

  it('composes no selector when nothing declares a chord', () => {
    const { spec } = composeGraph(['overlay'], [overlay], { chords: TARGET });
    expect(spec.nodes.map((n) => n.id)).toEqual(['overlay']);
  });

  it('an explicit edge into the pool keeps its input; the declared producers take the free ones', () => {
    const legacy = defineBranch({ id: 'legacy', nodes: [{ id: 'legacy', type: 'chord' }, { id: 'sel', type: 'chord-select', params: {} }], edges: [{ from: { node: 'legacy', port: 'triad' }, to: { node: 'sel', port: 'c' } }] });
    const lib = [overlay, legacy, producer('p1', 30), producer('p2', 20), producer('p3', 10)];
    const { spec } = composeGraph(['overlay', 'legacy', 'p1', 'p2', 'p3'], lib, { chords: TARGET });
    expect([inputOf(spec.edges, 'p1'), inputOf(spec.edges, 'p2'), inputOf(spec.edges, 'legacy'), inputOf(spec.edges, 'p3')]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('refuses a full pool, a missing target and a chord declared twice', () => {
    const lib = [overlay, ...['p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) => producer(id, i))];
    expect(() => composeGraph(lib.map((b) => b.id), lib, { chords: TARGET })).toThrow(/chord pool is full \(4 inputs\)/);
    expect(() => composeGraph(['overlay', 'p1'], lib, {})).toThrow(ComposeError);
    const twice = defineBranch({ id: 'twice', requires: ['p1'], chords: [{ from: { node: 'p1', port: 'triad' }, priority: 1 }] });
    expect(() => composeGraph(['overlay', 'p1', 'twice'], [...lib, twice], { chords: TARGET })).toThrow(/chord p1.triad is declared by branches "(p1" and "twice|twice" and "p1)"/);
  });

  it('the shipped face chords keep their inputs (expression on a, pose on b)', () => {
    const { spec } = composeInstrumentGraph(['face-chord', 'face-controls']);
    expect(inputOf(spec.edges, 'exprChord') ?? spec.edges.find((e) => e.from.node === 'exprChord' && e.to.node === 'chordSel')?.to.port).toBe('a');
    expect(spec.edges.find((e) => e.from.node === 'poseChord' && e.to.node === 'chordSel')?.to.port).toBe('b');
  });
});

describe('the sized chord selector', () => {
  it('passes the first non-empty input in pool order, and never has fewer than three', () => {
    const node = makeChordSelectNode(5);
    expect(node.inputs.map((p) => p.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(makeChordSelectNode(1).inputs.map((p) => p.name)).toEqual(['a', 'b', 'c']);
    const run = node.make(node.params.parse({}));
    expect(run.process({ a: [], d: [62, 65, 69], e: [60] }, {} as never)).toEqual({ chord: [62, 65, 69] });
  });
});
