/**
 * Whether the camera is read at all (#869): the pure derivation over composed branches and the
 * shell's readers, the host's reading of the hot store, and the selection the host composes with
 * while the camera is closed. Since #960 a camera model is known by its NODE's declaration
 * (`reads: READS_VIDEO`), slot nodes resolved through the selection, never by a branch flag.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { readsResource } from '@thoremin/dag';
import { branchReadsCamera, deriveReadsCamera, shellReadsCamera } from '@/instruments/camera';
import { trunk, fieldVoices, faceSource, faceTimbre, faceChord } from '@/instruments/branches';
import { branchClosureIds, branchNodeType } from '@/instruments/compose';
import { ALL_BRANCHES, NO_SLOTS, SLOTS, cameraNodes, resolveSlots, sourceSelectionFor } from '@/app/graph';
import { liveReadsCamera } from '@/app/engine/liveApply';
import { createAppRegistry, loadedAppRegistry } from '@/host/appRegistry';
import { CONTRIBUTIONS } from '@/host/contributions';
import { VIDEO_RESOURCE_KEY } from '@thoremin/sdk/sources/video';
import { BODY } from '../helpers/extensions';
import { useControls } from '@/app/store';
import { TRUNK_ID } from '@thoremin/sdk/instruments/trunk';
import { FACE_GROUP_IDS, BODY_GROUP_IDS, HAND_GROUP_IDS } from '@thoremin/sdk/features/sources';
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { seedSettings } from '../../scripts/stability/lib_run';

const byId = new Map(ALL_BRANCHES.map((b) => [b.id, b]));
const registry = createAppRegistry();
/** The node facts for the default selection, as the host reads them while the camera is closed. */
const NODES = cameraNodes(NO_SLOTS, registry);
/** The composed branches for `ids`: the trunk and every requirement in, as the host reads them. */
const composed = (...ids: string[]) => branchClosureIds([TRUNK_ID, ...ids], ALL_BRANCHES).flatMap((id) => byId.get(id) ?? []);

describe('branchReadsCamera', () => {
  it('the trunk alone reads nothing: its hand readers are the shell\'s', () => {
    expect(branchReadsCamera(trunk, NODES)).toBe(false);
  });

  it('a branch reading the hand stream reads the camera (the hand count\'s own reading)', () => {
    expect(branchReadsCamera(fieldVoices, NODES)).toBe(true);
  });

  it('a branch placing a camera model reads it; a face consumer reads it through that source', () => {
    expect(branchReadsCamera(faceSource, NODES)).toBe(true);
    expect(branchReadsCamera(faceTimbre, NODES)).toBe(false);
    expect(deriveReadsCamera(composed(faceChord.id), NODES)).toBe(true);
  });

  it('a branch reading neither does not', () => {
    const listener = defineBranch({ id: 'listener', nodes: [{ id: 'mic', type: 'audio-events' }], edges: [] });
    expect(branchReadsCamera(listener, NODES)).toBe(false);
  });

  it('the camera models declare that they read the video; the finished-frame sources do not', () => {
    const reads = (t: string) => readsResource(registry, t, VIDEO_RESOURCE_KEY);
    expect(reads('webcam-hands')).toBe(true);
    expect(reads('webcam-face')).toBe(true);
    for (const t of ['synthetic-hands', 'replay-hands', 'no-hands', 'canvas-overlay']) expect(reads(t), t).toBe(false);
    if (BODY) {
      expect(reads('webcam-body')).toBe(true);
      expect(reads('synthetic-body')).toBe(false);
      expect(reads('replay-body')).toBe(false);
    }
  });

  it('every branch placing a camera model reads the camera, whichever candidate fills its slot (derived, so a new source cannot forget)', () => {
    for (const b of ALL_BRANCHES) {
      if (b.id === TRUNK_ID) continue; // the trunk's hand source: idled while closed, read through its readers
      for (const n of b.nodes) {
        // Every type the node can be: its own, or each candidate of its slot.
        const types = n.type !== undefined ? [n.type] : (SLOTS[n.slot as string]?.candidates ?? []);
        for (const type of types) {
          if (!readsResource(registry, type, VIDEO_RESOURCE_KEY)) continue;
          const nodes = cameraNodes(n.slot !== undefined ? { [n.slot]: type } : NO_SLOTS, registry);
          expect(branchNodeType(n, nodes.slots), `${b.id}.${n.id}`).toBe(type);
          expect(branchReadsCamera(b, nodes), `${b.id} places ${type}`).toBe(true);
        }
      }
    }
  });

  it('no camera model is a lazy extension\'s (its declaration would be unseen until its code loads)', async () => {
    const loaded = await loadedAppRegistry();
    const lazyTypes = CONTRIBUTIONS.extensions.flatMap((e) => e.provides ?? []);
    for (const t of lazyTypes) expect(readsResource(loaded, t, VIDEO_RESOURCE_KEY), t).toBe(false);
  });

  it.runIf(BODY)('the body branch reads the camera through the webcam, never through a synthetic or replayed body (#960)', () => {
    const bodySource = ALL_BRANCHES.find((b) => b.nodes.some((n) => n.slot === 'body'))!;
    expect(branchReadsCamera(bodySource, cameraNodes(NO_SLOTS, registry))).toBe(true);
    expect(branchReadsCamera(bodySource, cameraNodes({ body: 'synthetic-body' }, registry))).toBe(false);
    expect(branchReadsCamera(bodySource, cameraNodes({ body: 'replay-body' }, registry))).toBe(false);
  });

  it('the trunk reads no camera of its own: its hand source is resolved idle', () => {
    expect(cameraNodes(NO_SLOTS, registry).slots.source).toBe('no-hands');
    expect(resolveSlots(NO_SLOTS, registry).source).toBe(SLOTS.source.default);
    expect(branchReadsCamera(trunk, cameraNodes({ source: 'synthetic-hands' }, registry))).toBe(false);
  });
});

describe('deriveReadsCamera', () => {
  it('the trunk with no shell reader reads no camera', () => {
    expect(deriveReadsCamera(composed(), NODES)).toBe(false);
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
      expect(deriveReadsCamera(composed(), NODES, ctx), JSON.stringify(ctx, (_k, v) => (v instanceof Set ? [...v] : v))).toBe(true);
    }
  });

  it('a field instrument reads it with every shell reader off', () => {
    expect(deriveReadsCamera(composed(fieldVoices.id), NODES, { videoShown: false, skeletonShown: false })).toBe(true);
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

  it('the hand voices read it with the video and the skeleton hidden: they are a branch, never the trunk', () => {
    // The review's scenario: a hand theremin with nothing drawn from the camera still plays from it.
    const s = listening();
    expect(liveReadsCamera({ ...s, handMap: { ...s.handMap, maxGain: initial.handMap.maxGain } }, new Set())).toBe(true);
  });

  it('every seed this build ships that plays from a camera reads it with the video and skeleton hidden', () => {
    const silent = (st: ReturnType<typeof useControls.getState>) => ({
      ...st,
      overlay: { ...st.overlay, video: { ...st.overlay.video, show: false }, landmarks: { ...st.overlay.landmarks, show: false } },
      gestures: { ...st.gestures, enabled: false },
    });
    for (const seed of SEED_INSTRUMENTS) {
      useControls.setState(initial, true);
      useControls.getState().applySettings(seedSettings(seed.name));
      const st = useControls.getState();
      // A seed whose voices the camera drives: a hand voice, a face mapping, or any composed
      // branch that reads it. The listening games (lab build) compose none, and are the exception.
      if ((st as unknown as Record<string, { enabled?: boolean }>).games?.enabled) continue;
      expect(liveReadsCamera(silent(st), new Set()), seed.name).toBe(true);
    }
  });

  it.runIf(BODY)('body tracking reads it through the webcam, and not through a synthetic body (`?slot.body=`, #960)', () => {
    const base = listening() as unknown as Record<string, unknown>;
    const s = { ...base, body: { ...(base.body as object), enabled: true } } as unknown as ReturnType<typeof useControls.getState>;
    expect(liveReadsCamera(s, new Set())).toBe(true);
    expect(liveReadsCamera(s, new Set(), { nodes: cameraNodes({ body: 'synthetic-body' }, registry) })).toBe(false);
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
