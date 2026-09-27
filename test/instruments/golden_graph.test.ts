/**
 * The golden test of the instruments-as-graphs ADR, PR 1: composing every branch
 * reproduces the graph `defaultGraph()` built by hand before the refactor, for every slot
 * selection, node for node and edge for edge.
 *
 * The fixtures under `test/fixtures/graph/` were dumped from the hand-listed builder at
 * main `e45b8ee` (32 nodes, 104 edges). One normalisation is deliberate: the merge's
 * inputs were letters (`a`..`e`) and are now role pools (`voice1..8`, `score1..2`), so an
 * edge into the merge is compared by the ROLE of its input, not its name. Everything else
 * must match exactly.
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

/** The letters the hand-listed graph used, by the role the ADR gives them. */
const LEGACY_MERGE_ROLE: Record<string, 'instrument' | 'score'> = { a: 'instrument', b: 'instrument', c: 'instrument', d: 'score', e: 'instrument' };

function roleOfMergePort(port: string): 'instrument' | 'score' | undefined {
  if (LEGACY_MERGE_ROLE[port]) return LEGACY_MERGE_ROLE[port];
  if ((SYNTH_MERGE_POOLS.instrument as readonly string[]).includes(port)) return 'instrument';
  if ((SYNTH_MERGE_POOLS.score as readonly string[]).includes(port)) return 'score';
  return undefined;
}

const nodeKey = (n: NodeSpec): string => JSON.stringify([n.id, n.type, n.params ?? {}]);

function edgeKey(e: EdgeSpec): string {
  const to = e.to.node === 'merge' && roleOfMergePort(e.to.port) ? `merge.<${roleOfMergePort(e.to.port)}>` : `${e.to.node}.${e.to.port}`;
  return `${e.from.node}.${e.from.port} -> ${to}${e.delayed ? ' (delayed)' : ''}`;
}

const sorted = (xs: string[]): string[] => [...xs].sort();

describe('composed graph == the hand-listed graph (golden)', () => {
  const registry = createAppRegistry();

  for (const [name, selection] of Object.entries(CASES)) {
    it(`selection "${name}"`, () => {
      const golden = JSON.parse(readFileSync(join(FIXTURES, `default_graph.${name}.json`), 'utf8')) as GraphSpec;
      const composed = defaultGraph(selection, registry);

      expect(composed.nodes).toHaveLength(golden.nodes.length);
      expect(sorted(composed.nodes.map(nodeKey))).toEqual(sorted(golden.nodes.map(nodeKey)));

      expect(composed.edges).toHaveLength(golden.edges.length);
      expect(sorted(composed.edges.map(edgeKey))).toEqual(sorted(golden.edges.map(edgeKey)));
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
