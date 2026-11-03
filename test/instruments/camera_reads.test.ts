/**
 * Whether the camera is read at all (#869): the pure derivation over composed branches and the
 * shell's readers, the host's reading of the hot store, and the selection the host composes with
 * while the camera is closed.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { branchReadsCamera, deriveReadsCamera, shellReadsCamera } from '@/instruments/camera';
import { trunk, fieldVoices, faceSource, faceTimbre, faceChord } from '@/instruments/branches';
import { branchClosureIds } from '@/instruments/compose';
import { ALL_BRANCHES, SLOTS, sourceSelectionFor } from '@/app/graph';
import { liveReadsCamera } from '@/app/engine/liveApply';
import { useControls } from '@/app/store';
import { TRUNK_ID } from '@thoremin/sdk/instruments/trunk';
import { FACE_GROUP_IDS, BODY_GROUP_IDS, HAND_GROUP_IDS } from '@thoremin/sdk/features/sources';
import { defineBranch } from '@thoremin/sdk/instruments/branch';

const byId = new Map(ALL_BRANCHES.map((b) => [b.id, b]));
/** The composed branches for `ids`: the trunk and every requirement in, as the host reads them. */
const composed = (...ids: string[]) => branchClosureIds([TRUNK_ID, ...ids], ALL_BRANCHES).flatMap((id) => byId.get(id) ?? []);

describe('branchReadsCamera', () => {
  it('the trunk alone reads nothing: its hand readers are the shell\'s', () => {
    expect(branchReadsCamera(trunk)).toBe(false);
  });

  it('a branch reading the hand stream reads the camera (the hand count\'s own reading)', () => {
    expect(branchReadsCamera(fieldVoices)).toBe(true);
  });

  it('a source branch with a camera model declares it; a face consumer reads it through that source', () => {
    expect(branchReadsCamera(faceSource)).toBe(true);
    expect(branchReadsCamera(faceTimbre)).toBe(false);
    expect(deriveReadsCamera(composed(faceChord.id))).toBe(true);
  });

  it('a branch reading neither does not', () => {
    const listener = defineBranch({ id: 'listener', nodes: [{ id: 'mic', type: 'audio-events' }], edges: [] });
    expect(branchReadsCamera(listener)).toBe(false);
  });

  it('every branch that holds a camera model declares it (a new source cannot forget)', () => {
    // The camera models: the default of each camera slot, and the face model.
    const cameraTypes = new Set([SLOTS.source.default, SLOTS.body.default, 'webcam-face'].filter(Boolean));
    const cameraSlots = new Set(['body']);
    for (const b of ALL_BRANCHES) {
      if (b.id === TRUNK_ID) continue; // the trunk's hand source: read through `hands`, by its readers
      const holds = b.nodes.some((n) => (n.type !== undefined && cameraTypes.has(n.type)) || (n.slot !== undefined && cameraSlots.has(n.slot)));
      if (holds) expect(b.camera, `${b.id} runs a camera model`).toBe(true);
    }
  });
});

describe('deriveReadsCamera', () => {
  it('the trunk with no shell reader reads no camera', () => {
    expect(deriveReadsCamera(composed())).toBe(false);
    expect(shellReadsCamera()).toBe(false);
  });

  it('each shell reader reads it', () => {
    for (const ctx of [
      { videoShown: true },
      { gesturesEnabled: true },
      { skeletonShown: true },
      { demanded: new Set([HAND_GROUP_IDS[0]]) },
      { demanded: new Set([FACE_GROUP_IDS[0]]) },
      ...(BODY_GROUP_IDS.length ? [{ demanded: new Set([BODY_GROUP_IDS[0]]) }] : []),
    ]) {
      expect(deriveReadsCamera(composed(), ctx), JSON.stringify(ctx, (_k, v) => (v instanceof Set ? [...v] : v))).toBe(true);
    }
  });

  it('a field instrument reads it with every shell reader off', () => {
    expect(deriveReadsCamera(composed(fieldVoices.id), { videoShown: false, skeletonShown: false })).toBe(true);
  });
});

describe('liveReadsCamera (the host\'s reading of the hot store)', () => {
  const initial = useControls.getState();
  afterEach(() => useControls.setState(initial, true));

  /** An instrument that only listens: no hand voices, no face, nothing drawn from the camera. */
  const listening = () => {
    const s = useControls.getState();
    return {
      ...s,
      handMap: { ...s.handMap, maxGain: 0 },
      faceMapping: 'none' as const,
      overlay: { ...s.overlay, video: { ...s.overlay.video, show: false }, landmarks: { ...s.overlay.landmarks, show: false } },
    };
  };

  it('the default instrument reads it', () => {
    expect(liveReadsCamera(useControls.getState(), new Set())).toBe(true);
  });

  it('an instrument that only listens does not', () => {
    expect(liveReadsCamera(listening(), new Set())).toBe(false);
  });

  it('a face mapping, the video, the skeleton, gestures or a tool\'s claim each make it read', () => {
    const s = listening();
    expect(liveReadsCamera({ ...s, faceMapping: 'chord' }, new Set())).toBe(true);
    expect(liveReadsCamera({ ...s, overlay: { ...s.overlay, video: { ...s.overlay.video, show: true } } }, new Set())).toBe(true);
    expect(liveReadsCamera({ ...s, overlay: { ...s.overlay, landmarks: { show: true } } }, new Set())).toBe(true);
    expect(liveReadsCamera({ ...s, gestures: { ...s.gestures, enabled: true } }, new Set())).toBe(true);
    expect(liveReadsCamera(s, new Set([HAND_GROUP_IDS[0]]))).toBe(true);
  });
});

describe('sourceSelectionFor', () => {
  it('idles the default hand source while no video is there, and gives it back once one is', () => {
    expect(sourceSelectionFor({}, { video: false }).source).toBe('no-hands');
    expect(sourceSelectionFor({ source: SLOTS.source.default }, { video: false }).source).toBe('no-hands');
    expect(sourceSelectionFor({}, { video: true })).toEqual({});
  });

  it('keeps a source the selection chose: a verification override reads no camera', () => {
    expect(sourceSelectionFor({ source: 'synthetic-hands' }, { video: false }).source).toBe('synthetic-hands');
    expect(sourceSelectionFor({ source: 'replay-hands' }, { video: false }).source).toBe('replay-hands');
  });

  it('leaves the other slots alone', () => {
    expect(sourceSelectionFor({ body: 'synthetic-body' }, { video: false })).toEqual({ body: 'synthetic-body', source: 'no-hands' });
  });
});
