/**
 * Verifies the real production instrument graph (the one the browser app runs)
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
    // sources must precede mapping which must precede synth
    expect(order.indexOf('cam')).toBeLessThan(order.indexOf('feat'));
    expect(order.indexOf('feat')).toBeLessThan(order.indexOf('map'));
    expect(order.indexOf('map')).toBeLessThan(order.indexOf('synth'));
    expect(order.indexOf('kbd')).toBeLessThan(order.indexOf('kctrl'));
    expect(order).toHaveLength(8);
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
  });
});
