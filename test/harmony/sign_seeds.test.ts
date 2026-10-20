/**
 * The sign instruments (sign-harmony lane, task 4): Sign Wheel (signed letters steer the chord
 * wheel) and Sign Map (a signed letter lights the chord map's chord, the other hand plays over
 * it). Each turns the ASL reader on with its own chords off, composes the reader's edge into the
 * harmony node, and is withheld from a build without the ASL plugin (`requires`).
 */
import { describe, expect, it } from 'vitest';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { createAppRegistry } from '@/nodes/browser';
import { ASL, HARMONY } from '../helpers/extensions';

const settingsOf = (name: string) => settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === name)!.layer) as unknown as Record<string, Record<string, unknown>>;

describe.runIf(HARMONY && ASL)('the sign instruments', () => {
  it('Sign Wheel: the reader on, its chords off, the wheel steered by signs', () => {
    const s = settingsOf('Sign Wheel');
    expect(s.asl).toMatchObject({ enabled: true, chords: false });
    expect(s.chordWheel).toMatchObject({ enabled: true, steer: 'signs' });
    const ids = branchIdsFor(s as never);
    expect(ids).toEqual(expect.arrayContaining(['asl-signs', 'chord-wheel', 'chord-wheel-signs']));
    expect(ids).not.toContain('asl-chord');
    const { spec } = composeInstrumentGraph(ids, { source: 'synthetic-hands' }, createAppRegistry());
    expect(spec.edges).toContainEqual({ from: { node: 'aslSigns', port: 'signs' }, to: { node: 'chordWheel', port: 'signs' } });
  });

  it('Sign Map: the map follows signs, the other hand plays the melody', () => {
    const s = settingsOf('Sign Map');
    expect(s.chordMap).toMatchObject({ enabled: true, follow: 'signs', melody: true });
    const ids = branchIdsFor(s as never);
    expect(ids).toEqual(expect.arrayContaining(['asl-signs', 'chord-map', 'chord-map-signs']));
    expect(ids).not.toContain('asl-chord');
    const { spec } = composeInstrumentGraph(ids, { source: 'synthetic-hands' }, createAppRegistry());
    expect(spec.edges).toContainEqual({ from: { node: 'aslSigns', port: 'signs' }, to: { node: 'chordMap', port: 'signs' } });
  });
});
