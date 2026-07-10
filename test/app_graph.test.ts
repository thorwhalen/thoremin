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
    // #90: keyboard signals (octave / magnetism / mute) now flow from the store
    // via `ui` (store-controls), a source that precedes the mapping/merge it feeds.
    expect(order.indexOf('ui')).toBeLessThan(order.indexOf('map'));
    expect(order.indexOf('ui')).toBeLessThan(order.indexOf('merge'));
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
    // Feature Lab (#119): the pure feature-vector taps sit after their sources and
    // before the overlay that draws their meters.
    expect(order.indexOf('camFace')).toBeLessThan(order.indexOf('faceVec'));
    expect(order.indexOf('cam')).toBeLessThan(order.indexOf('handVec'));
    expect(order.indexOf('faceVec')).toBeLessThan(order.indexOf('overlay'));
    expect(order.indexOf('handVec')).toBeLessThan(order.indexOf('overlay'));
    // 14 base nodes (#90 retired the kbd + kctrl nodes) + the two #119 feature-vector taps.
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

  it('wires the Feature Lab vector taps additively off the existing sources (#119)', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // The vectors tap the SAME face/hand frames the rest of the graph reads (fan-out).
    expect(has('camFace', 'face', 'faceVec', 'face')).toBe(true);
    expect(has('cam', 'hands', 'handVec', 'hands')).toBe(true);
    // ...and feed the overlay's featureLab meters.
    expect(has('faceVec', 'vector', 'overlay', 'faceVector')).toBe(true);
    expect(has('handVec', 'vector', 'overlay', 'handVector')).toBe(true);
    // The original face-mesh + hand-feature edges are untouched (additive).
    expect(has('camFace', 'face', 'overlay', 'faceFrame')).toBe(true);
    expect(has('cam', 'hands', 'feat', 'hands')).toBe(true);
  });

  it('routes the mute to the merge so it silences the chords too (#91)', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // The master mute reaches the single convergence point (synth-merge), so the
    // face-chord instruments (which merge in after voice-mapping) are muted along
    // with the hand voices — the fix for #91. Since #90 the mute is a store flag
    // sourced from `ui` (store-controls), not the retired `keyboard-control` node.
    expect(has('ui', 'mute', 'merge', 'mute')).toBe(true);
    // The original hand-stage mute edge is still present (belt-and-suspenders).
    expect(has('ui', 'mute', 'map', 'mute')).toBe(true);
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
