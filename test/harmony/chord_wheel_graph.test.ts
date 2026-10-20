/**
 * The chord wheel in the real composed graph: the shipped instruments compose its branch; its
 * grid reaches the air extension's own overlay element (#600 S5: a generated overlay port, the
 * element in the composed set, its config delivered by the host); the engine, ticking a scripted
 * hand, draws the wheel's chords on a recording canvas; its chord reaches the shared chord display.
 */
import { describe, it, expect } from 'vitest';
import { Engine } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { useControls } from '@/app/store';
import { overlayElementId, overlayPortName } from '@thoremin/sdk/instruments/extension';
import { DEFAULT_CHORD_WHEEL } from '@thoremin/ext-harmony/dials';
import { makeRecordingCanvas } from '../helpers/canvas';
import { palmAt, W, H } from './synthetic_chord_map';
import { wheelRegion } from '@thoremin/ext-harmony/nodes/chord_wheel';
import { radial } from '@thoremin/sdk/harmony/layout';
import { HARMONY } from '../helpers/extensions';

describe.runIf(HARMONY)('the chord wheel in the composed graph', () => {
  it('the shipped chord wheels compose its branch', () => {
    for (const name of ['Chord Wheel', 'Tonnetz Wheel', 'Wheel Walk', 'Next-Chord Wheel']) {
      const settings = settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === name)!.layer);
      expect(settings.chordWheel.enabled, name).toBe(true);
      expect(branchIdsFor(settings), name).toContain('chord-wheel');
    }
    expect(settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Tonnetz Wheel')!.layer).chordWheel.moves).toBe('tonnetz');
    expect(settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Wheel Walk')!.layer).chordWheel.walk).toBe(true);
    const next = settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Next-Chord Wheel')!.layer);
    expect(next.chordWheel.surpriseFrom).toBe('hand'); // #672: raise the right hand for rarer moves
    expect(branchIdsFor({ ...next, chordWheel: { ...next.chordWheel, surpriseFrom: 'face' } })).toContain('chord-wheel-affect');
    expect(branchIdsFor(next)).not.toContain('chord-wheel-affect');
    expect(branchIdsFor({ ...next, chordWheel: { ...next.chordWheel, surpriseFrom: 'face', order: 'fixed' } })).not.toContain('chord-wheel-affect'); // no ranking, no face
  });

  it('wires its grid to its own overlay element, and draws the wheel', () => {
    const reg = createAppRegistry();
    const composed = composeInstrumentGraph(['chord-wheel'], { source: 'replay-hands' }, reg);
    const port = overlayPortName('harmonic-layers', 'chordWheel', 'grid');
    expect(composed.spec.edges).toContainEqual({ from: { node: 'chordWheel', port: 'grid' }, to: { node: 'overlay', port } });
    expect(composed.spec.edges).toContainEqual({ from: { node: 'ui', port: 'chordWheel' }, to: { node: 'overlay', port: overlayPortName('harmonic-layers', 'chordWheel', 'config') } });
    expect(composed.elements).toContain(overlayElementId('harmonic-layers', 'chordWheel'));
    expect(composed.spec.edges.some((e) => e.from.node === 'chordWheel' && e.from.port === 'triad' && e.to.node === 'chordSel')).toBe(true);

    const centre = radial(wheelRegion('left'), 6, { aspect: W / H, radius: 0.3 })[0];
    const frames = Array.from({ length: 10 }, (_, i) => ({ t: i / 30, width: W, height: H, hands: [palmAt({ x: centre.x, y: centre.y }, 'Left')] }));
    composed.spec.nodes.find((n) => n.id === 'cam')!.params = { frames };
    const rc = makeRecordingCanvas();
    const controls = { ...useControls.getState(), chordWheel: { ...DEFAULT_CHORD_WHEEL, enabled: true, mirrorHandedness: false }, graphElements: composed.elements };
    const engine = new Engine(composed.spec, reg, { resources: { controls: () => controls, canvas: rc.canvas, video: rc.video } });
    for (let i = 0; i < 10; i++) engine.tick(i / 30);
    expect(rc.texts()).toEqual(expect.arrayContaining(['C', 'I', 'F', '4th up', 'B°']));
  });
});
