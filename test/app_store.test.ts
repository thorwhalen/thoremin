/**
 * Tests for the DAG app's control store and its bridge into the graph via the
 * `store-controls` node — the only genuinely-new logic the opt-in `?engine=dag`
 * view adds. Covers the Zustand store's reducers (sync behaviour, per-hand
 * instruments) and the store → store-controls → (scale arrays + instruments)
 * path the graph reads each tick. Pure + headless: no React render, camera, or
 * audio. (The full graph's topology + clean tick are covered by app_graph.test.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useControls, toSettings, migrateControls, mergeControls } from '@/app/store';
import { DEFAULT_FACE_CHORD } from '@/settings/schema';
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
    expect(s.faceMapping).toBe('none'); // face control off by default
    // Chord-sound defaults (open voicing, sustained pad, 100 BPM).
    expect(s.faceChord.voicing).toBe('spread');
    expect(s.faceChord.rendering).toBe('sustained');
    expect(s.faceChord.bpm).toBe(100);
  });

  it('setFaceMapping switches the face mapping mode', () => {
    useControls.getState().setFaceMapping('chord');
    expect(useControls.getState().faceMapping).toBe('chord');
    useControls.getState().setFaceMapping('none');
    expect(useControls.getState().faceMapping).toBe('none');
  });

  it('setFaceChord patches chord settings without touching the rest', () => {
    useControls.getState().setFaceChord({ voicing: 'power', bpm: 120 });
    const c = useControls.getState().faceChord;
    expect(c.voicing).toBe('power');
    expect(c.bpm).toBe(120);
    expect(c.rendering).toBe('sustained'); // untouched
  });

  it('setExpressionSensitivity / setExpressionDegree patch one entry, leaving siblings', () => {
    useControls.getState().setExpressionSensitivity('angry', 0.2);
    useControls.getState().setExpressionDegree('happy', 4);
    const fe = useControls.getState().faceExpr;
    expect(fe.sensitivity.angry).toBe(0.2);
    expect(fe.sensitivity.happy).toBe(0.5); // sibling sensitivity untouched (default)
    expect(fe.degrees.happy).toBe(4);
    expect(fe.degrees.neutral).toBe(5); // sibling degree untouched (confusion-aware default)
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

  it('has overlay element defaults (index-finger guide opt-in/off)', () => {
    const o = useControls.getState().overlay;
    expect(o.video.show).toBe(true);
    expect(o.scaleGuide.show).toBe(true);
    expect(o.indexGuide.show).toBe(false);
  });

  it('setOverlayElement patches one element without touching the others', () => {
    useControls.getState().setOverlayElement('indexGuide', { show: true });
    const o = useControls.getState().overlay;
    expect(o.indexGuide.show).toBe(true);
    expect(o.indexGuide.dashed).toBe(true); // sibling field untouched
    expect(o.video.show).toBe(true); // sibling element untouched
  });

  it('toSettings snapshots the live state and applySettings restores it', () => {
    useControls.getState().setSync(false);
    useControls.getState().setVoice('right', { root: 3, instrument: 'bell' });
    useControls.getState().setMasterVolume(0.6);
    useControls.getState().setFaceMapping('chord');
    useControls.getState().setFaceChord({ voicing: 'power', bpm: 140 });
    useControls.getState().setOverlayElement('indexGuide', { show: true });
    const snap = toSettings(useControls.getState());

    // Mutate away, then restore from the snapshot.
    useControls.getState().setMasterVolume(0.1);
    useControls.getState().setFaceMapping('none');
    useControls.getState().setFaceChord({ voicing: 'close', bpm: 90 });
    useControls.getState().setOverlayElement('indexGuide', { show: false });
    useControls.getState().applySettings(snap);

    const s = useControls.getState();
    expect(s.masterVolume).toBeCloseTo(0.6);
    expect(s.right.instrument).toBe('bell');
    expect(s.syncHands).toBe(false);
    expect(s.faceMapping).toBe('chord');
    expect(s.faceChord.voicing).toBe('power'); // faceChord survives toSettings → applySettings
    expect(s.faceChord.bpm).toBe(140);
    expect(s.overlay.indexGuide.show).toBe(true);
  });

  it('toSettings → applySettings round-trips faceExpr (schema-derived persistence)', () => {
    useControls.getState().setExpressionSensitivity('angry', 0.2);
    useControls.getState().setExpressionDegree('neutral', 1);
    const snap = toSettings(useControls.getState());
    // Mutate away, then restore from the snapshot.
    useControls.getState().setExpressionSensitivity('angry', 0.9);
    useControls.getState().setExpressionDegree('neutral', 6);
    useControls.getState().applySettings(snap);
    const fe = useControls.getState().faceExpr;
    expect(fe.sensitivity.angry).toBe(0.2);
    expect(fe.degrees.neutral).toBe(1);
  });
});

describe('persist migration (v1 → v2, returning users)', () => {
  it('migrateControls maps the legacy faceEnabled flag onto faceMapping', () => {
    const on = migrateControls({ masterVolume: 0.5, faceEnabled: true }, 1) as unknown as Record<string, unknown>;
    expect(on.faceMapping).toBe('timbre');
    expect(on.faceEnabled).toBeUndefined();
    expect(
      (migrateControls({ faceEnabled: false }, 1) as unknown as Record<string, unknown>).faceMapping,
    ).toBe('none');
  });

  it('mergeControls heals a stale overlay (missing later elements) so it cannot crash readers', () => {
    const initial = useControls.getInitialState();
    // A legacy overlay blob written before chordGuide / face / timbre elements existed.
    const legacyOverlay = { video: { show: true, alpha: 0.35 }, scaleGuide: { show: true, showLabels: true } };
    const merged = mergeControls({ overlay: legacyOverlay }, initial);
    // Every element added since the blob was written gets its default (no undefined read).
    for (const k of ['chordGuide', 'faceLandmarks', 'faceExpression', 'timbreLevels'] as const) {
      expect(typeof merged.overlay[k]?.show).toBe('boolean');
    }
    expect(merged.overlay.timbreLevels.show).toBe(false); // opt-in default survives the heal
  });

  it('mergeControls heals a partial faceExpr (missing emotions/degrees filled from defaults)', () => {
    const initial = useControls.getInitialState();
    const merged = mergeControls({ faceExpr: { sensitivity: { angry: 0.1 } } } as never, initial);
    expect(merged.faceExpr.sensitivity.angry).toBe(0.1); // kept
    expect(merged.faceExpr.sensitivity.happy).toBe(0.5); // filled from default
    expect(typeof merged.faceExpr.degrees.happy).toBe('number'); // degree map filled too
  });

  it('mergeControls clamps an unknown faceMapping to a safe value', () => {
    const initial = useControls.getInitialState();
    expect(mergeControls({ faceMapping: 'rainbow' as never }, initial).faceMapping).toBe('none');
    expect(mergeControls({ faceMapping: 'chord' }, initial).faceMapping).toBe('chord');
  });

  it('mergeControls fills the default faceChord for a returning v2 user (blob lacks it)', () => {
    const initial = useControls.getInitialState();
    const merged = mergeControls({ masterVolume: 0.5 }, initial); // no faceChord key
    expect(merged.faceChord).toEqual(DEFAULT_FACE_CHORD);
  });

  it('mergeControls completes/heals a partial or corrupt faceChord so no UI control binds undefined', () => {
    const initial = useControls.getInitialState();
    // A hand-edited partial blob: only volume set.
    const partial = mergeControls({ faceChord: { volume: 0.5 } as never }, initial).faceChord;
    expect(partial.volume).toBe(0.5); // kept
    expect(partial.voicing).toBe(DEFAULT_FACE_CHORD.voicing); // filled from default
    expect(typeof partial.rendering).toBe('string');
    expect(typeof partial.instrument).toBe('string');
    // A corrupt value (out of range) falls back to the default whole.
    expect(mergeControls({ faceChord: { volume: 99 } as never }, initial).faceChord).toEqual(DEFAULT_FACE_CHORD);
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

    useControls.getState().setFaceMapping('chord');
    const node = storeControlsNode.make(storeControlsNode.params.parse({}));
    const out = node.process({}, ctxWith({ controls: () => useControls.getState() }));

    const s = useControls.getState();
    expect(out.instrumentRight).toBe('square');
    expect(out.instrumentLeft).toBe('sawtooth');
    expect(out.scaleRight).toEqual(generateScale(s.right));
    expect(out.scaleLeft).toEqual(generateScale(s.left));
    expect((out.scaleRight as number[]).length).toBeGreaterThan(0);
    // The chord-path ports: the right voice's scale spec + the face mode + config.
    expect(out.faceMapping).toBe('chord');
    expect(out.rightSpec).toMatchObject({ root: 2, type: 'minor' });
    // chordConfig maps the store's faceChord (volume → gain) for expression-chord.
    expect(out.chordConfig).toMatchObject({ voicing: 'spread', gain: 0.22, bpm: 100 });
    // The expression-mapping ports: per-emotion sensitivity + per-expression degrees.
    expect(out.expressionSensitivity).toMatchObject({ happy: 0.5, angry: 0.45 });
    expect((out.expressionDegrees as Record<string, number>).neutral).toBe(5);
  });

  it('emits nothing when no controls getter is injected (safe before host wires it)', () => {
    const node = storeControlsNode.make(storeControlsNode.params.parse({}));
    expect(node.process({}, ctxWith({}))).toEqual({});
  });

  it('emits the live overlay element config for canvas-overlay', () => {
    useControls.getState().setOverlayElement('indexGuide', { show: true });
    const node = storeControlsNode.make(storeControlsNode.params.parse({}));
    const out = node.process({}, ctxWith({ controls: () => useControls.getState() }));
    const overlay = out.overlay as { indexGuide: { show: boolean } } | undefined;
    expect(overlay?.indexGuide.show).toBe(true);
  });
});
