/**
 * Signs choose the chord map in the graph: the ASL reader's reading reaches the map only while the
 * map follows signs (`chord-map-signs`, which requires the reader).
 */
import { describe, it, expect } from 'vitest';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { createAppRegistry } from '@/nodes/browser';
import { ASL, HARMONY } from '../helpers/extensions';

describe.runIf(HARMONY && ASL)('signs choose the chord map in the graph', () => {
  it("composes the sign reader's reading into the map only while it follows signs", () => {
    const s = (follow: string) => ({ chordMap: { enabled: true, follow }, asl: { enabled: true, chords: false } }) as never;
    expect(branchIdsFor(s('signs'))).toEqual(expect.arrayContaining(['chord-map', 'chord-map-signs', 'asl-signs']));
    expect(branchIdsFor(s('hands'))).not.toContain('chord-map-signs');
    const { spec } = composeInstrumentGraph(['chord-map-signs'], { source: 'synthetic-hands' }, createAppRegistry());
    expect(spec.edges).toContainEqual({ from: { node: 'aslSigns', port: 'signs' }, to: { node: 'chordMap', port: 'signs' } });
  });
});
