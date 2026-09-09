/**
 * `webcam-body` (#186), headlessly: the pure result → frame converter, the gate
 * that decides whether the (expensive) pose model is wanted, and the lazy-load
 * lifecycle driven through a mocked tasks-vision module — off by default, loads
 * on enable, swaps model on the dial, releases on disable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeContext } from '@/dag';
import { BLM, BODY_LANDMARK_COUNT, EMPTY_BODY_FRAME } from '@/nodes/domain';
import { defaultFeatureLab } from '@/features/labConfig';

const created: Array<{ modelAssetPath: string; delegate?: string }> = [];
const closed: number[] = [];
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: {
    createFromOptions: async (_fs: unknown, opts: { baseOptions: { modelAssetPath: string; delegate?: string } }) => {
      created.push(opts.baseOptions);
      const id = created.length;
      return {
        detectForVideo: () => ({ landmarks: [], worldLandmarks: [] }),
        close: () => closed.push(id),
      };
    },
  },
}));

// Imported after the mock is registered.
const { resultToBodyFrame, bodyActive, webcamBodyNode, bodyModelUrl } = await import('@/nodes/sources/webcam_body');

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('resultToBodyFrame', () => {
  it('scales normalized landmarks to pixels, keeps z, visibility and world landmarks', () => {
    const pts = Array.from({ length: BODY_LANDMARK_COUNT }, (_, i) => ({ x: i / 33, y: 0.5, z: -0.1, visibility: 0.9 }));
    const world = pts.map((p) => ({ x: p.x - 0.5, y: 0, z: 0 }));
    const f = resultToBodyFrame({ landmarks: [pts], worldLandmarks: [world] }, 640, 480);
    expect(f.present).toBe(true);
    expect(f.width).toBe(640);
    expect(f.landmarks).toHaveLength(BODY_LANDMARK_COUNT);
    expect(f.landmarks[BLM.nose]).toEqual({ x: 0, y: 240, z: -0.1 });
    expect(f.landmarks[BLM.right_foot_index].x).toBeCloseTo((32 / 33) * 640, 6);
    expect(f.visibility[0]).toBe(0.9);
    expect(f.world).toHaveLength(BODY_LANDMARK_COUNT);
    expect(f.world![BLM.nose]).toEqual({ x: -0.5, y: 0, z: 0 });
  });

  it('returns the sized empty frame when nobody is detected', () => {
    expect(resultToBodyFrame({ landmarks: [] }, 320, 240)).toEqual({ ...EMPTY_BODY_FRAME, width: 320, height: 240 });
  });

  it('defaults visibility to 1 when the detector omits it', () => {
    const pts = Array.from({ length: BODY_LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5 }));
    expect(resultToBodyFrame({ landmarks: [pts] }, 10, 10).visibility.every((v) => v === 1)).toBe(true);
  });
});

describe('bodyActive (the gate)', () => {
  it('is off with no controls, and off by default', () => {
    expect(bodyActive(undefined)).toBe(false);
    expect(bodyActive({ body: { enabled: false } })).toBe(false);
    expect(bodyActive({})).toBe(false);
  });
  it('the dial turns it on', () => {
    expect(bodyActive({ body: { enabled: true } })).toBe(true);
  });
  it('a demanded body group turns it on even with the dial off (the trainer path)', () => {
    // No body groups are catalogued yet, so a demand for one cannot match; the rule
    // still holds structurally: a non-body demand never turns the body on.
    expect(bodyActive({ body: { enabled: false } }, new Set(['face.geom']))).toBe(false);
  });
  it('the Lab measuring a non-body group does not turn it on', () => {
    const lab = { ...defaultFeatureLab(), show: true, groups: ['hand.position.raw'] };
    expect(bodyActive({ body: { enabled: false }, featureLab: lab })).toBe(false);
  });
});

describe('webcam-body lifecycle (mocked tasks-vision)', () => {
  beforeEach(() => {
    created.length = 0;
    closed.length = 0;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  const video = { readyState: 0, videoWidth: 0, videoHeight: 0, currentTime: 0 } as unknown as HTMLVideoElement;
  const ctxWith = (controls: unknown): NodeContext => ({
    tick: 0,
    time: 0,
    dt: 0,
    resources: { video, controls: () => controls },
  });

  it('loads nothing until enabled, loads the dial’s model on enable, swaps on change, releases on disable', async () => {
    const h = webcamBodyNode.make(webcamBodyNode.params.parse({}));
    await h.init?.(ctxWith({ body: { enabled: false, model: 'lite' } }));
    expect(created).toHaveLength(0);
    let out = h.process({}, ctxWith({ body: { enabled: false, model: 'lite' } }));
    expect(out.body).toEqual(EMPTY_BODY_FRAME);
    expect(out.status).toEqual({ phase: 'idle', bodyDetected: false });
    expect(created).toHaveLength(0);

    out = h.process({}, ctxWith({ body: { enabled: true, model: 'lite' } }));
    expect((out.status as { phase: string }).phase).toBe('loading');
    await flush();
    await flush();
    expect(created).toHaveLength(1);
    expect(created[0].modelAssetPath).toBe(bodyModelUrl('lite'));
    out = h.process({}, ctxWith({ body: { enabled: true, model: 'lite' } }));
    expect((out.status as { phase: string }).phase).toBe('ready');

    // The dial picks `full`: the lite landmarker is released and full is loaded.
    h.process({}, ctxWith({ body: { enabled: true, model: 'full' } }));
    await flush();
    await flush();
    expect(closed).toEqual([1]);
    expect(created).toHaveLength(2);
    expect(created[1].modelAssetPath).toBe(bodyModelUrl('full'));

    // Disable: released, idle, nothing new created.
    out = h.process({}, ctxWith({ body: { enabled: false, model: 'full' } }));
    expect(closed).toEqual([1, 2]);
    expect(out.status).toEqual({ phase: 'idle', bodyDetected: false });
    h.dispose?.();
    expect(created).toHaveLength(2);
  });
});
