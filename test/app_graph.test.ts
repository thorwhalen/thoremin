/**
 * Verifies the real production sound graph (the one the browser app runs)
 * is structurally valid and ticks cleanly headlessly — no camera, audio, or DOM.
 * This catches wiring mistakes (bad port names, fan-in, cycles) in CI without a
 * browser. The webcam node lazy-loads TF.js inside init(), which we never call
 * here, so the app registry is Node-importable.
 */
import { describe, it, expect } from 'vitest';
import { Engine, StreamRecorder } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import type { SynthParams } from '@/nodes';

describe('production app graph', () => {
  it('builds with a valid topology', () => {
    const engine = new Engine(defaultGraph(), createAppRegistry());
    const order = engine.evaluationOrder();
    // sources must precede mapping which (via the merge) must precede synth
    expect(order.indexOf('cam')).toBeLessThan(order.indexOf('feat'));
    expect(order.indexOf('feat')).toBeLessThan(order.indexOf('map'));
    expect(order.indexOf('map')).toBeLessThan(order.indexOf('merge'));
    expect(order.indexOf('merge')).toBeLessThan(order.indexOf('synth'));
    expect(order.indexOf('kbd')).toBeLessThan(order.indexOf('kctrl'));
    // face timbre branch: webcam-face → face-features → voice-mapping
    expect(order.indexOf('camFace')).toBeLessThan(order.indexOf('faceFeat'));
    expect(order.indexOf('faceFeat')).toBeLessThan(order.indexOf('map'));
    // face chord branch: webcam-face → face-expression → expression-chord → merge
    expect(order.indexOf('camFace')).toBeLessThan(order.indexOf('faceExpr'));
    expect(order.indexOf('faceExpr')).toBeLessThan(order.indexOf('exprChord'));
    expect(order.indexOf('exprChord')).toBeLessThan(order.indexOf('merge'));
    // head-pose controls branch: webcam-face → face-controls → pose-chord → merge (#76)
    expect(order.indexOf('camFace')).toBeLessThan(order.indexOf('faceCtrl'));
    expect(order.indexOf('faceCtrl')).toBeLessThan(order.indexOf('poseChord'));
    expect(order.indexOf('poseChord')).toBeLessThan(order.indexOf('merge'));
    // both chord instruments feed the overlay highlight via the chord-select join
    expect(order.indexOf('exprChord')).toBeLessThan(order.indexOf('chordSel'));
    expect(order.indexOf('poseChord')).toBeLessThan(order.indexOf('chordSel'));
    expect(order.indexOf('chordSel')).toBeLessThan(order.indexOf('overlay'));
    expect(order).toHaveLength(16);
  });

  it('wires the face overlays (mesh + expression readout + both chord highlights)', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(has('camFace', 'face', 'overlay', 'faceFrame')).toBe(true); // face mesh data
    expect(has('faceExpr', 'expression', 'overlay', 'expression')).toBe(true); // expression readout
    // The overlay chord highlight is fed by whichever chord instrument sounds (#76).
    expect(has('exprChord', 'triad', 'chordSel', 'a')).toBe(true);
    expect(has('poseChord', 'chord', 'chordSel', 'b')).toBe(true);
    expect(has('chordSel', 'chord', 'overlay', 'chord')).toBe(true);
    // The overlay reads the MERGED params (hands + both chord instruments) so the
    // keyboard strip's voiced-now cue lights the sounding chord voices, not only the
    // hands (#89). The hand voices stay at indices 0/1, so per-hand labels are intact.
    expect(has('merge', 'params', 'overlay', 'params')).toBe(true);
    expect(has('map', 'params', 'overlay', 'params')).toBe(false);
  });

  it('ticks cleanly with no host resources (everything no-ops or idles)', () => {
    const recorder = new StreamRecorder();
    // No resources: webcam has no video (emits empty frame), synth has no
    // AudioContext (no-op), overlay has no canvas (no-op), store-controls has
    // no getter. The graph must still run and produce silent synth params.
    const engine = new Engine(defaultGraph(), createAppRegistry(), { taps: [recorder] });
    expect(() => {
      engine.tick();
      engine.tick();
    }).not.toThrow();

    const params = recorder.values('map.params') as SynthParams[];
    expect(params.length).toBe(2);
    // No hands present → both voices silent.
    expect(params[0].voices.every((v) => !v.present)).toBe(true);
    expect(params[0].voices).toHaveLength(2);

    // The synth's actual input is the merge of hand voices (0,1) + the 4 stable
    // emotion-chord voices (2..5) + the 5 stable pose-chord voices (6..10) — all
    // distinct ids, all silent while both face chord sources are idle (#76).
    const merged = recorder.values('merge.params') as SynthParams[];
    const ids = merged[0].voices.map((v) => v.id);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(ids).size).toBe(11); // no id collision across hands + both chords
    expect(merged[0].voices.every((v) => !v.present)).toBe(true);
  });
});
