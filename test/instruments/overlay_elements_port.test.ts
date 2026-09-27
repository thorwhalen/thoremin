/**
 * PR 3 of the instruments-as-graphs ADR, §3.2 rule 4, end to end: the composed element set
 * travels hot store → `store-controls` (`graphElements` port) → `canvas-overlay` (`elements`
 * input), and the overlay draws only those elements. The review of the first draft found
 * the port declared on both ends and wired on neither; this test drives the real graph.
 *
 * The canvas is a recording proxy: every 2D-context method call is logged by name, so the
 * assertion is about what the overlay DID, not about a returned value it has none of.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Engine } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { useControls } from '@/app/store';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { branchIdsFor } from '@/app/graph';
import { composeInstrumentGraph } from '@/app/graph';

function recordingCanvas(): { canvas: unknown; calls: string[] } {
  const calls: string[] = [];
  const g = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'canvas') return canvas;
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} });
        return (..._args: unknown[]) => {
          calls.push(String(prop));
          return undefined;
        };
      },
      set: () => true,
    },
  );
  const canvas = { width: 320, height: 240, getContext: () => g };
  return { canvas, calls };
}

describe('the element set reaches the overlay through the UI bridge', () => {
  afterEach(() => {
    useControls.getState().setGraphElements(null);
  });

  it('with an EMPTY set the overlay draws nothing but its clear; with no set it draws', () => {
    const registry = createAppRegistry();
    const seed = SEED_INSTRUMENTS.find((s) => s.name === 'Pentatonic')!;
    const { spec } = composeInstrumentGraph(branchIdsFor(settingsFromLayer(seed.layer)), { source: 'synthetic-hands' }, registry);
    const run = (elements: string[] | null): string[] => {
      useControls.getState().setGraphElements(elements);
      const { canvas, calls } = recordingCanvas();
      const engine = new Engine(spec, registry, {
        resources: { canvas, controls: () => useControls.getState() },
      });
      engine.tick();
      engine.tick();
      engine.dispose();
      return calls;
    };
    const drawn = run(null).filter((c) => c !== 'clearRect' && c !== 'save' && c !== 'restore' && c !== 'setTransform');
    const none = run([]).filter((c) => c !== 'clearRect' && c !== 'save' && c !== 'restore' && c !== 'setTransform');
    expect(drawn.length).toBeGreaterThan(0);
    expect(none).toEqual([]);
  });

  it('a set naming only the scale guide draws it and not the markers', () => {
    const registry = createAppRegistry();
    const seed = SEED_INSTRUMENTS.find((s) => s.name === 'Pentatonic')!;
    const { spec, elements } = composeInstrumentGraph(
      branchIdsFor(settingsFromLayer(seed.layer)),
      { source: 'synthetic-hands' },
      registry,
    );
    expect(elements).toContain('scaleGuide');
    const count = (set: string[]): number => {
      useControls.getState().setGraphElements(set);
      const { canvas, calls } = recordingCanvas();
      const engine = new Engine(spec, registry, { resources: { canvas, controls: () => useControls.getState() } });
      engine.tick();
      engine.tick();
      engine.dispose();
      return calls.length;
    };
    const guideOnly = count(['scaleGuide']);
    const guideAndMarkers = count(['scaleGuide', 'markers', 'landmarks']);
    expect(guideOnly).toBeGreaterThan(0);
    // The synthetic hands are present from the first tick, so the markers draw: strictly more.
    expect(guideAndMarkers).toBeGreaterThan(guideOnly);
  });
});
