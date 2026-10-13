/**
 * The golden test of the instruments-as-graphs ADR, PR 1: composing every branch
 * reproduces the graph `defaultGraph()` built by hand before the refactor, for every slot
 * selection, node for node and edge for edge.
 *
 * The fixtures under `test/fixtures/graph/` were dumped from the hand-listed builder at
 * main `e45b8ee` (32 nodes, 104 edges), plus one edge added since: the air drum's
 * `pattern` port fed from the store (#269, 105 edges). One translation is deliberate: the merge's inputs
 * were letters (`a`..`e`) and are now role pools (`voice1..8`, `score1..2`); each letter maps
 * to exactly one pool input, and the comparison is exact after that mapping. (The overlay
 * reads the hand voices by position in the merged stream, so which input a producer lands
 * on is behaviour, not a detail.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EdgeSpec, GraphSpec, NodeSpec } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { SYNTH_MERGE_POOLS } from '@/nodes/mapping/synth_merge';
import { defaultGraph, type SlotSelection } from '@/app/graph';
import { AIR, hasExtension } from '../helpers/extensions';

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
  // PR 3: the composed element set reaches the overlay through the UI bridge.
  { from: { node: 'ui', port: 'graphElements' }, to: { node: 'overlay', port: 'elements' } },
  // #148: the handedness dwell dial reaches the sound path's hand reader live.
  { from: { node: 'ui', port: 'handednessDwell' }, to: { node: 'feat', port: 'handednessDwell' } },
  // #168 Q3: MIDI out reads the merge before the master mute, and takes the player's
  // mute, a tool's claim and the `midi.muteFollowsMaster` dial as live inputs.
  { from: { node: 'merge', port: 'unmuted' }, to: { node: 'midiOut', port: 'params' } },
  { from: { node: 'ui', port: 'mute' }, to: { node: 'midiOut', port: 'mute' } },
  { from: { node: 'ui', port: 'claimed' }, to: { node: 'midiOut', port: 'claimed' } },
  { from: { node: 'ui', port: 'midiMuteFollowsMaster' }, to: { node: 'midiOut', port: 'muteFollowsMaster' } },
];

/** Edges the branch table LOST after the snapshot, each named here for the same reason. */
const REMOVED_SINCE_SNAPSHOT: EdgeSpec[] = [
  // #168 Q3: MIDI out no longer reads the muted merge stream (it reads `unmuted`, above).
  { from: { node: 'merge', port: 'params' }, to: { node: 'midiOut', port: 'params' } },
  // #168 Q3: the mapping node no longer mutes at the source; the merge is the one place
  // the master mute applies (#91), so the hands' voices can reach MIDI through a mute.
  { from: { node: 'ui', port: 'mute' }, to: { node: 'map', port: 'mute' } },
];

/** Nodes of extensions added after the snapshot (the ASL reader and its chords): the golden
 *  is the core + air graph, so these and every edge touching them are set aside before the
 *  comparison; their own branches are tested in `test/asl/`. */
const LATER_EXTENSION_NODES = new Set(hasExtension('asl') ? ['aslSigns', 'signChord'] : []);
const withoutLaterExtensions = (spec: GraphSpec): GraphSpec => ({
  ...spec,
  nodes: spec.nodes.filter((n) => !LATER_EXTENSION_NODES.has(n.id)),
  edges: spec.edges.filter((e) => !LATER_EXTENSION_NODES.has(e.from.node) && !LATER_EXTENSION_NODES.has(e.to.node)),
});

describe.runIf(AIR)('composed graph == the hand-listed graph (golden)', () => {
  const registry = createAppRegistry();

  for (const [name, selection] of Object.entries(CASES)) {
    it(`selection "${name}"`, () => {
      const golden = JSON.parse(readFileSync(join(FIXTURES, `default_graph.${name}.json`), 'utf8')) as GraphSpec;
      const composed = withoutLaterExtensions(defaultGraph(selection, registry));

      expect(composed.nodes).toHaveLength(golden.nodes.length);
      expect(sorted(composed.nodes.map(nodeKey))).toEqual(sorted(golden.nodes.map(nodeKey)));

      const removed = new Set(REMOVED_SINCE_SNAPSHOT.map(edgeKey));
      const expected = [...golden.edges.filter((e) => !removed.has(edgeKey(e))), ...ADDED_SINCE_SNAPSHOT];
      // Every named removal was really in the snapshot (a stale entry would hide a drift).
      for (const e of REMOVED_SINCE_SNAPSHOT) expect(golden.edges.map(edgeKey), edgeKey(e)).toContain(edgeKey(e));
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
