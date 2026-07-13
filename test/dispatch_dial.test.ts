/**
 * The panel-side dispatchers (#126) — `src/app/dispatchDial.ts`, the glue every discrete
 * settings control now writes through. The panels themselves are React and are guarded
 * STATICALLY (`dials_write_path.test.ts` proves each control calls one of these); this file
 * proves the three functions they call actually land the write — and surface a refusal.
 *
 * `dispatchDialPatch` in particular re-shapes the panel's `[key, value]` pairs (what
 * `voiceEditWrites` speaks) into the command's `{ key, value }` params, so it needs a test
 * of its own: a silent mis-mapping there would make every synced-hands voice edit a no-op.
 *
 * Fire-and-forget by design, so each assertion awaits a microtask flush rather than the
 * dispatch itself. Pure + headless: no camera, audio, or React.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchDialSet, dispatchDialSetIn, dispatchDialPatch } from '@/app/dispatchDial';
import { dialsStore } from '@/app/dials/settingsStore';
import { voiceEditWrites } from '@/app/dials/settingsStore';
import { useControls } from '@/app/store';
import { useToasts } from '@/app/toasts';

/** The dispatchers do not await, so let the dispatch promise settle before asserting. */
const settled = () => new Promise((r) => setTimeout(r, 0));

describe('panel dispatchers (#126)', () => {
  beforeEach(() => useToasts.setState({ toasts: [] }));

  it('dispatchDialSet lands a scalar dial in the hot mirror', async () => {
    dispatchDialSet('faceChord.voicing', 'close');
    await settled();
    expect(useControls.getState().faceChord.voicing).toBe('close');
  });

  it('dispatchDialSetIn lands a nested leaf of a structured dial', async () => {
    dispatchDialSetIn('overlay.fingerLines.showLabels', false);
    await settled();
    expect(useControls.getState().overlay.fingerLines.showLabels).toBe(false);
  });

  it('dispatchDialPatch applies EVERY write — the panel\'s [key, value] pairs, re-shaped', async () => {
    // Exactly the shape a synced-hands voice edit produces. If the tuple → { key, value }
    // mapping were wrong, the command would see `{}`s, reject them, and the edit would be a
    // silent no-op that still looked fine in the panel (which re-renders from the store).
    dispatchDialPatch(voiceEditWrites('right', 'root', 9, true, dialsStore.getState().effective));
    await settled();
    expect(useControls.getState().right.root).toBe(9);
    expect(useControls.getState().left.root).toBe(9); // mirrored onto the synced hand
  });

  it('dispatchDialPatch carries an ABSENT optional dial through the mirror (a pre-#63 voice)', async () => {
    // The #63 octave-range dials have no default, so a voice loaded without them is
    // legitimately UNSET — and the sync-hands mirror must be able to propagate that absence.
    // A required `value` in the patch params would reject the whole batch here, turning a
    // scale change on a legacy instrument into a toast and a no-op.
    dispatchDialPatch([
      ['right.type', 'minorHarmonic'],
      ['left.type', 'minorHarmonic'],
      ['left.rangeLow', undefined],
    ]);
    await settled();
    expect(useToasts.getState().toasts).toEqual([]); // not refused
    expect(useControls.getState().right.type).toBe('minorHarmonic');
    expect(useControls.getState().left.type).toBe('minorHarmonic');
  });

  it('a refused write TOASTS the reason and leaves the dial alone (errors-as-data, surfaced)', async () => {
    const before = useControls.getState().overlay.video.alpha;
    dispatchDialSetIn('overlay.video.alpha', 42); // bounded 0..1
    await settled();
    const toasts = useToasts.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].level).toBe('error');
    expect(toasts[0].message).toContain('overlay.video.alpha');
    expect(useControls.getState().overlay.video.alpha).toBe(before);
  });

  it('a successful write toasts NOTHING (the panel stays quiet on the happy path)', async () => {
    dispatchDialSet('faceChord.rendering', 'sustained');
    await settled();
    expect(useToasts.getState().toasts).toEqual([]);
  });
});
