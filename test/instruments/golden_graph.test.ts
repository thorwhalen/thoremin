/**
 * The golden test of the instruments-as-graphs ADR, PR 1: composing every branch
 * reproduces the graph `defaultGraph()` built by hand before the refactor, for every slot
 * selection, node for node and edge for edge.
 *
 * The fixtures under `test/fixtures/graph/` were dumped from the hand-listed builder at
 * main `e45b8ee` (32 nodes, 104 edges). One translation is deliberate: the merge's inputs
 * were letters (`a`..`e`) and are now role pools (`voice1..8`, `score1..2`); each letter maps
 * to exactly one pool input, and the comparison is exact after that mapping. (The overlay
 * reads the hand voices by position in the merged stream, so which input a producer lands
 * on is behaviour, not a detail.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EdgeSpec, GraphSpec, NodeSpec } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { SYNTH_MERGE_POOLS } from '@/nodes/mapping/synth_merge';
import { defaultGraph, type SlotSelection } from '@/app/graph';

const FIXTURES = join(__dirname, '..', 'fixtures', 'graph');

const CASES: Record<string, SlotSelection> = {
  default: {},
  'synthetic-hands': { source: 'synthetic-hands' },
  'replay-hands': { source: 'replay-hands' },
  'synthetic-body': { body: 'synthetic-body' },
};

/** The letter each producer used in the hand-listed graph, and the pool input it now has. */
const LEGACY_MERGE_PORT: Record<string, string> = { a: 'voice1', b: 'voice2', c: 'voice3', d: 'score1', e: 'voice4' };

const nodeKey = (n: NodeSpec): string => JSON.stringify([n.id, n.type, n.params ?? {}]);

function edgeKey(e: EdgeSpec): string {
  const port = e.to.node === 'merge' ? (LEGACY_MERGE_PORT[e.to.port] ?? e.to.port) : e.to.port;
  return `${e.from.node}.${e.from.port} -> ${e.to.node}.${port}${e.delayed ? ' (delayed)' : ''}`;
}

const sorted = (xs: string[]): string[] => [...xs].sort();

/** Edges the branch table gained AFTER the snapshot, each named here so the golden stays
 *  exact: the composed graph must equal the fixture plus exactly these. */
const ADDED_SINCE_SNAPSHOT: EdgeSpec[] = [
  // PR 3: the air flute's status feeds its breath cue on the overlay.
  { from: { node: 'airFlute', port: 'status' }, to: { node: 'overlay', port: 'airFluteStatus' } },
];

describe('composed graph == the hand-listed graph (golden)', () => {
  const registry = createAppRegistry();

  for (const [name, selection] of Object.entries(CASES)) {
    it(`selection "${name}"`, () => {
      const golden = JSON.parse(readFileSync(join(FIXTURES, `default_graph.${name}.json`), 'utf8')) as GraphSpec;
      const composed = defaultGraph(selection, registry);

      expect(composed.nodes).toHaveLength(golden.nodes.length);
      expect(sorted(composed.nodes.map(nodeKey))).toEqual(sorted(golden.nodes.map(nodeKey)));

      const expected = [...golden.edges, ...ADDED_SINCE_SNAPSHOT];
      expect(composed.edges).toHaveLength(expected.length);
      expect(sorted(composed.edges.map(edgeKey))).toEqual(sorted(expected.map(edgeKey)));
    });
  }

  it('the conducted score is on a score-pool input and every other voice on an instrument-pool input', () => {
    const edges = defaultGraph({}, registry).edges.filter((e) => e.to.node === 'merge');
    const byFrom = Object.fromEntries(edges.map((e) => [e.from.node, e.to.port]));
    expect(SYNTH_MERGE_POOLS.score).toContain(byFrom.score);
    for (const producer of ['map', 'exprChord', 'poseChord', 'airFlute']) {
      expect(SYNTH_MERGE_POOLS.instrument).toContain(byFrom[producer]);
    }
  });
});
