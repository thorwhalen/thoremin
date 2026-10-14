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
  // #187 PR 5: the sampled orchestra reads the conductor and the dial, and takes the
  // piece over from the score's oscillator voices once it is loaded.
  { from: { node: 'conductor', port: 'time' }, to: { node: 'orchestra', port: 'time' } },
  { from: { node: 'conductor', port: 'velocityScale' }, to: { node: 'orchestra', port: 'velocityScale' } },
  { from: { node: 'conductor', port: 'articulation' }, to: { node: 'orchestra', port: 'articulation' } },
  { from: { node: 'conductor', port: 'leadsScore' }, to: { node: 'orchestra', port: 'conducting' } },
  { from: { node: 'ui', port: 'scoreDoc' }, to: { node: 'orchestra', port: 'doc' } },
  { from: { node: 'ui', port: 'conductor' }, to: { node: 'orchestra', port: 'config' } },
  { from: { node: 'ui', port: 'claimed' }, to: { node: 'orchestra', port: 'claimed' } },
  { from: { node: 'orchestra', port: 'playing' }, to: { node: 'score', port: 'replaced' } },
  // #186 PR F: the dancer's pulse reads the body frame and feeds the body vector.
  { from: { node: 'camBody', port: 'body' }, to: { node: 'bodyPulse', port: 'body' } },
  { from: { node: 'bodyPulse', port: 'pulse' }, to: { node: 'bodyVec', port: 'pulse' } },
  // #186 PR G: the song player, in the trunk, fed by the store and a tool's claim.
  { from: { node: 'ui', port: 'songHandle' }, to: { node: 'songPlayer', port: 'song' } },
  { from: { node: 'ui', port: 'songPlaying' }, to: { node: 'songPlayer', port: 'playing' } },
  { from: { node: 'ui', port: 'songRate' }, to: { node: 'songPlayer', port: 'rate' } },
  { from: { node: 'ui', port: 'songVolume' }, to: { node: 'songPlayer', port: 'volume' } },
  { from: { node: 'ui', port: 'claimed' }, to: { node: 'songPlayer', port: 'claimed' } },
  // #186 PR H: the song follows the dancer; the pace controller reads the player back on
  // delayed edges and feeds its rate in.
  { from: { node: 'bodyPulse', port: 'pulse' }, to: { node: 'pace', port: 'pulse' } },
  { from: { node: 'songPlayer', port: 'songTime' }, to: { node: 'pace', port: 'song' }, delayed: true },
  { from: { node: 'songPlayer', port: 'rate' }, to: { node: 'pace', port: 'rate' }, delayed: true },
  { from: { node: 'ui', port: 'songRate' }, to: { node: 'pace', port: 'base' } },
  { from: { node: 'ui', port: 'songFollowRange' }, to: { node: 'pace', port: 'range' } },
  { from: { node: 'pace', port: 'rate' }, to: { node: 'songPlayer', port: 'followRate' } },
  // #187 PR 7: the conductor leads the recording through the same pace controller, and the
  // score (and the orchestra) play only while he leads the score.
  { from: { node: 'conductor', port: 'recordingTime' }, to: { node: 'pace', port: 'lead' } },
  { from: { node: 'pace', port: 'playing' }, to: { node: 'songPlayer', port: 'followPlaying' } },
  { from: { node: 'pace', port: 'cue' }, to: { node: 'songPlayer', port: 'cue' } },
  { from: { node: 'conductor', port: 'leadsScore' }, to: { node: 'score', port: 'enabled' } },
  // #375: the body conductor reads the pose stream (present whenever the body source is).
  { from: { node: 'camBody', port: 'body' }, to: { node: 'conductor', port: 'body' } },
  // #380: a dancer leads the score: the dancer's pulse reaches the conductor.
  { from: { node: 'bodyPulse', port: 'pulse' }, to: { node: 'conductor', port: 'pulse' } },
];

/** Nodes the branch table gained after the snapshot, named for the same reason. */
const NODES_ADDED_SINCE_SNAPSHOT: NodeSpec[] = [
  // #187 PR 5: the sampled orchestra, in the conductor branch.
  { id: 'orchestra', type: 'orchestra', params: {} },
  // #186 PR F: the dancer's pulse, in the body-source branch.
  { id: 'bodyPulse', type: 'body-pulse', params: {} },
  // #186 PR G: the song player, in the trunk.
  { id: 'songPlayer', type: 'song-player', params: {} },
  // #186 PR H: the pace controller, in the song-pace branch.
  { id: 'pace', type: 'pace-controller', params: {} },
];

/** Edges the branch table LOST after the snapshot, each named here for the same reason. */
const REMOVED_SINCE_SNAPSHOT: EdgeSpec[] = [
  // #168 Q3: MIDI out no longer reads the muted merge stream (it reads `unmuted`, above).
  { from: { node: 'merge', port: 'params' }, to: { node: 'midiOut', port: 'params' } },
  // #168 Q3: the mapping node no longer mutes at the source; the merge is the one place
  // the master mute applies (#91), so the hands' voices can reach MIDI through a mute.
  { from: { node: 'ui', port: 'mute' }, to: { node: 'map', port: 'mute' } },
  // #187 PR 7: the score plays on `leadsScore` (not while the conductor leads a recording).
  { from: { node: 'conductor', port: 'enabled' }, to: { node: 'score', port: 'enabled' } },
];

/** Nodes of extensions added after the snapshot (the ASL reader and its chords): the golden
 *  is the core + air graph, so these and every edge touching them are set aside before the
 *  comparison; their own branches are tested in `test/asl/`. */
const LATER_EXTENSION_NODES = new Set([...(hasExtension('asl') ? ['aslSigns', 'signChord'] : []), ...(hasExtension('faces') ? ['faceCat', 'poseCat'] : [])]);
/** The faces extension's categorizer REPLACES the general face chord when every branch is
 *  composed (#330 P4, rule 5): the general reading's two edges then run through `faceCat`, set
 *  aside above, so they are restored here to compare with the core + air snapshot. */
const REPLACED_BY_LATER_EXTENSIONS: EdgeSpec[] = hasExtension('faces')
  ? [
      { from: { node: 'faceExpr', port: 'expression' }, to: { node: 'exprChord', port: 'expression' } },
      { from: { node: 'faceExpr', port: 'expression' }, to: { node: 'overlay', port: 'expression' } },
    ]
  : [];
const withoutLaterExtensions = (spec: GraphSpec): GraphSpec => ({
  ...spec,
  nodes: spec.nodes.filter((n) => !LATER_EXTENSION_NODES.has(n.id)),
  edges: [
    ...spec.edges.filter((e) => !LATER_EXTENSION_NODES.has(e.from.node) && !LATER_EXTENSION_NODES.has(e.to.node)),
    ...REPLACED_BY_LATER_EXTENSIONS,
  ],
});

describe.runIf(AIR)('composed graph == the hand-listed graph (golden)', () => {
  const registry = createAppRegistry();

  for (const [name, selection] of Object.entries(CASES)) {
    it(`selection "${name}"`, () => {
      const golden = JSON.parse(readFileSync(join(FIXTURES, `default_graph.${name}.json`), 'utf8')) as GraphSpec;
      const composed = withoutLaterExtensions(defaultGraph(selection, registry));

      const expectedNodes = [...golden.nodes, ...NODES_ADDED_SINCE_SNAPSHOT];
      expect(composed.nodes).toHaveLength(expectedNodes.length);
      expect(sorted(composed.nodes.map(nodeKey))).toEqual(sorted(expectedNodes.map(nodeKey)));

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
