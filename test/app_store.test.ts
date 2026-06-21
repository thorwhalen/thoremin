/**
 * Tests for the DAG app's control store and its bridge into the graph via the
 * `store-controls` node — the only genuinely-new logic the opt-in `?engine=dag`
 * view adds. Covers the Zustand store's reducers (sync behaviour, per-hand
 * instruments) and the store → store-controls → (scale arrays + instruments)
 * path the graph reads each tick. Pure + headless: no React render, camera, or
 * audio. (The full graph's topology + clean tick are covered by app_graph.test.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useControls } from '@/app/store';
import { storeControlsNode } from '@/nodes/browser';
import { generateScale } from '@/music/theory';
import { DEFAULT_INSTRUMENT_RIGHT, DEFAULT_INSTRUMENT_LEFT } from '@/music/instruments';
import type { NodeContext } from '@/dag';

beforeEach(() => {
  // The store is a module singleton; reset to its initial state per test.
  useControls.setState(useControls.getInitialState(), true);
});

describe('control store', () => {
  it('has sensible defaults', () => {
    const s = useControls.getState();
    expect(s.right.instrument).toBe(DEFAULT_INSTRUMENT_RIGHT);
    expect(s.left.instrument).toBe(DEFAULT_INSTRUMENT_LEFT);
    // Pentatonic by default — every snapped note sounds consonant.
    expect(s.right.type).toBe('pentatonic');
    expect(s.left.type).toBe('pentatonic');
    expect(s.syncHands).toBe(true);
    expect(s.masterVolume).toBeCloseTo(0.4, 6);
  });

  it('setVoice with sync ON mirrors both hands but keeps instruments distinct', () => {
    useControls.getState().setVoice('right', { root: 7, octaves: 4 });
    const s = useControls.getState();
    expect(s.right.root).toBe(7);
    expect(s.left.root).toBe(7);
    expect(s.right.octaves).toBe(4);
    expect(s.left.octaves).toBe(4);
    // Instruments stay per-hand even when synced.
    expect(s.right.instrument).toBe(DEFAULT_INSTRUMENT_RIGHT);
    expect(s.left.instrument).toBe(DEFAULT_INSTRUMENT_LEFT);
  });

  it('setVoice with sync ON applies the patched instrument to the addressed hand only', () => {
    // Regression guard: changing the Wave (instrument) while synced — the only
    // instrument control visible in the default (synced) state — must take
    // effect on the addressed hand while the other hand keeps its own timbre.
    useControls.getState().setVoice('right', { instrument: 'square' });
    const s = useControls.getState();
    expect(s.right.instrument).toBe('square');
    expect(s.left.instrument).toBe(DEFAULT_INSTRUMENT_LEFT);
  });

  it('setSync only flips the flag; it does not re-converge already-diverged hands', () => {
    useControls.getState().setSync(false);
    useControls.getState().setVoice('left', { root: 9 });
    useControls.getState().setSync(true);
    const s = useControls.getState();
    // Re-enabling sync leaves the divergence in place until the next setVoice.
    expect(s.syncHands).toBe(true);
    expect(s.right.root).toBe(0);
    expect(s.left.root).toBe(9);
    // The next synced edit re-converges shared fields (instruments stay distinct).
    useControls.getState().setVoice('right', { root: 4 });
    const s2 = useControls.getState();
    expect(s2.right.root).toBe(4);
    expect(s2.left.root).toBe(4);
    expect(s2.right.instrument).toBe(DEFAULT_INSTRUMENT_RIGHT);
    expect(s2.left.instrument).toBe(DEFAULT_INSTRUMENT_LEFT);
  });

  it('setVoice with sync OFF changes only the addressed hand', () => {
    useControls.getState().setSync(false);
    useControls.getState().setVoice('right', { root: 5 });
    const s = useControls.getState();
    expect(s.right.root).toBe(5);
    expect(s.left.root).toBe(0); // untouched default
  });

  it('setMasterVolume updates the master volume', () => {
    useControls.getState().setMasterVolume(0.75);
    expect(useControls.getState().masterVolume).toBeCloseTo(0.75, 6);
  });
});

describe('store-controls node reads the store', () => {
  const ctxWith = (resources: Record<string, unknown>): NodeContext => ({
    tick: 0,
    time: 0,
    dt: 0,
    resources,
  });

  it('emits scale arrays + instruments derived from the store snapshot', () => {
    useControls.getState().setSync(false);
    useControls.getState().setVoice('right', { root: 2, type: 'minor', instrument: 'square' });
    useControls.getState().setVoice('left', { root: 9, instrument: 'sawtooth' });

    const node = storeControlsNode.make(storeControlsNode.params.parse({}));
    const out = node.process({}, ctxWith({ controls: () => useControls.getState() }));

    const s = useControls.getState();
    expect(out.instrumentRight).toBe('square');
    expect(out.instrumentLeft).toBe('sawtooth');
    expect(out.scaleRight).toEqual(generateScale(s.right));
    expect(out.scaleLeft).toEqual(generateScale(s.left));
    expect((out.scaleRight as number[]).length).toBeGreaterThan(0);
  });

  it('emits nothing when no controls getter is injected (safe before host wires it)', () => {
    const node = storeControlsNode.make(storeControlsNode.params.parse({}));
    expect(node.process({}, ctxWith({}))).toEqual({});
  });
});
