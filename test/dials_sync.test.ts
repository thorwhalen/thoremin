/**
 * The dials → hot-store sync (Phase 3): editing the dials store must mirror into the
 * synchronous `useControls` store the DAG reads each tick (via `applySettings`).
 * Covers scalar, enum, nested-voice, and structured (object) dials, plus the
 * invalid-state guard that keeps the hot mirror on its last good value.
 */
import { describe, it, expect } from 'vitest';
import { dialsStore, voiceEditWrites } from '@/app/dials/settingsStore';
import { useControls } from '@/app/store';
import type { OverlayParams } from '@/nodes/output/canvas_overlay';

describe('dials → hot-store sync', () => {
  it('mirrors a scalar dial (master.volume) into useControls', () => {
    dialsStore.set('master.volume', 0.77);
    expect(useControls.getState().masterVolume).toBeCloseTo(0.77);
  });

  it('mirrors enum / nested-voice dials (right.sound, right.type) into useControls', () => {
    dialsStore.set('right.sound', 'bell');
    dialsStore.set('right.type', 'major');
    const { right } = useControls.getState();
    expect(right.sound).toBe('bell');
    expect(right.type).toBe('major');
  });

  it('mirrors faceChord dials into useControls', () => {
    dialsStore.set('faceChord.bpm', 144);
    dialsStore.set('faceChord.voicing', 'close');
    const { faceChord } = useControls.getState();
    expect(faceChord.bpm).toBe(144);
    expect(faceChord.voicing).toBe('close');
  });

  it('mirrors a structured dial (overlay) into useControls', () => {
    const overlay = dialsStore.getState().effective['overlay'] as OverlayParams;
    dialsStore.set('overlay', { ...overlay, video: { ...overlay.video, alpha: 0.33 } });
    expect(useControls.getState().overlay.video.alpha).toBeCloseTo(0.33);
  });

  it('heals a PARTIAL overlay layer on load — the effective overlay is complete (instrument-load path)', () => {
    // An old instrument saved before the cue fields existed: only a partial overlay
    // (faceExpression with just `show`, and no fingerLines/fingerBars). The dials
    // deep-merge must back-fill every field, or the panel would read `.show` on
    // undefined and crash on select. Pins the strategy the panel depends on.
    dialsStore.setLayer({ overlay: { faceExpression: { show: true } } } as never);
    const eff = dialsStore.getState().effective['overlay'] as OverlayParams;
    expect(eff.fingerBars?.show).toBe(false); // new element back-filled
    expect(eff.fingerLines?.show).toBe(false); // new element back-filled
    expect(eff.faceExpression.position).toBe('left'); // new field back-filled
    expect(eff.faceExpression.chordLabels).toBe(true);
    expect(eff.faceExpression.show).toBe(true); // the partial value preserved
  });

  it('mirrors the expression maps (faceExpr.degrees) into useControls', () => {
    const degrees = dialsStore.getState().effective['faceExpr.degrees'] as Record<string, number>;
    dialsStore.set('faceExpr.degrees', { ...degrees, happy: 4 });
    expect(useControls.getState().faceExpr.degrees.happy).toBe(4);
  });

  it('keeps the hot mirror on its last good value when a dial goes out of range', () => {
    dialsStore.set('master.volume', 0.5);
    expect(useControls.getState().masterVolume).toBeCloseTo(0.5);
    // 9 is outside the schema's 0..1 range — layerToSettings throws, the sync is
    // skipped, and the tick loop never sees the bad state.
    dialsStore.set('master.volume', 9);
    expect(useControls.getState().masterVolume).toBeCloseTo(0.5);
  });
});

describe('voiceEditWrites (the panel sync-hands mirror, reproducing setVoice)', () => {
  // A snapshot where the two hands have DIVERGED (the reachable un-sync / edit-left
  // / re-sync state). The mirror must re-converge them on the next edit, like setVoice.
  const eff = {
    'right.root': 0, 'right.type': 'major', 'right.octaves': 2, 'right.baseOctave': 3, 'right.sound': 'warmPad',
    'left.root': 5, 'left.type': 'blues', 'left.octaves': 4, 'left.baseOctave': 2, 'left.sound': 'glass',
  };

  it('unsynced edit writes only the addressed field', () => {
    expect(voiceEditWrites('right', 'root', 7, false, eff)).toEqual([['right.root', 7]]);
  });

  it('synced non-sound edit re-snaps the whole non-sound voice onto the other hand', () => {
    // Editing right.octaves while synced: left re-converges to right (root/type/
    // baseOctave) and takes the new octaves — healing the prior divergence.
    expect(voiceEditWrites('right', 'octaves', 3, true, eff)).toEqual([
      ['right.octaves', 3],
      ['left.root', 0],
      ['left.type', 'major'],
      ['left.octaves', 3],
      ['left.baseOctave', 3],
    ]);
  });

  it('synced sound edit mirrors the non-sound voice but never the other hand sound', () => {
    const writes = voiceEditWrites('right', 'sound', 'bell', true, eff);
    expect(writes).toEqual([
      ['right.sound', 'bell'],
      ['left.root', 0],
      ['left.type', 'major'],
      ['left.octaves', 2],
      ['left.baseOctave', 3],
    ]);
    expect(writes.some(([k]) => k === 'left.sound')).toBe(false);
  });

  it('mirrors left into right symmetrically', () => {
    expect(voiceEditWrites('left', 'root', 9, true, eff)).toEqual([
      ['left.root', 9],
      ['right.root', 9],
      ['right.type', 'blues'],
      ['right.octaves', 4],
      ['right.baseOctave', 2],
    ]);
  });
});
