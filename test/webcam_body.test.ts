/**
 * `webcam-body` (#186), headlessly: the pure result → frame converter, the gate
 * that decides whether the (expensive) pose model is wanted, and the lazy-load
 * lifecycle through the injected loader seam (`ctx.resources.createBodyLandmarker`,
 * the `src/lazy` pattern): off by default, `no-camera` until the video has frames
 * (then a self-retry), loads the dial's model on enable, swaps model on change —
 * also after a FAILED load — and releases on disable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeContext } from '@/dag';
import { BLM, BODY_LANDMARK_COUNT, EMPTY_BODY_FRAME, type BodyFrame } from '@/nodes/domain';
import { defaultFeatureLab } from '@/features/labConfig';
import {
  resultToBodyFrame,
  bodyActive,
  webcamBodyNode,
  NO_CAMERA_REASON,
  type BodyLandmarkerFactory,
  type PoseLandmarkerLike,
} from '@/nodes/sources/webcam_body';

const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

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
  it('a non-body demand never turns it on', () => {
    expect(bodyActive({ body: { enabled: false } }, new Set(['face.geom']))).toBe(false);
  });
  it('the Lab measuring a non-body group does not turn it on', () => {
    const lab = { ...defaultFeatureLab(), show: true, groups: ['hand.position.raw'] };
    expect(bodyActive({ body: { enabled: false }, featureLab: lab })).toBe(false);
  });
});

describe('webcam-body lifecycle (injected loader)', () => {
  const created: string[] = [];
  const closed: string[] = [];
  let failModel: string | null = null;

  const factory: BodyLandmarkerFactory = async ({ model }) => {
    if (model === failModel) throw new Error(`no ${model} for you`);
    created.push(model);
    const landmarker: PoseLandmarkerLike = {
      detectForVideo: () => ({ landmarks: [], worldLandmarks: [] }),
      close: () => closed.push(model),
    };
    return { resource: { landmarker, model } };
  };

  const liveVideo = { readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 0 } as unknown as HTMLVideoElement;
  const deadVideo = { readyState: 0, videoWidth: 0, videoHeight: 0, currentTime: 0 } as unknown as HTMLVideoElement;
  const ctxWith = (controls: unknown, video: HTMLVideoElement = liveVideo): NodeContext => ({
    tick: 0,
    time: 0,
    dt: 0,
    resources: { video, controls: () => controls, createBodyLandmarker: factory },
  });
  const phase = (out: Record<string, unknown>) => (out.status as { phase: string; reason?: string });

  beforeEach(() => {
    created.length = 0;
    closed.length = 0;
    failModel = null;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('loads nothing until enabled; loads the dial’s model on enable; swaps on change; releases on disable', async () => {
    const h = webcamBodyNode.make(webcamBodyNode.params.parse({}));
    await h.init?.(ctxWith({ body: { enabled: false, model: 'lite' } }));
    let out = h.process({}, ctxWith({ body: { enabled: false, model: 'lite' } }));
    expect(out.body).toEqual(EMPTY_BODY_FRAME);
    expect(phase(out).phase).toBe('off');
    expect(created).toHaveLength(0);

    out = h.process({}, ctxWith({ body: { enabled: true, model: 'lite' } }));
    expect(phase(out).phase).toBe('loading');
    await flush();
    expect(created).toEqual(['lite']);
    out = h.process({}, ctxWith({ body: { enabled: true, model: 'lite' } }));
    expect(phase(out).phase).toBe('ready');

    // The dial picks `full`: lite is released, full loads.
    out = h.process({}, ctxWith({ body: { enabled: true, model: 'full' } }));
    expect(phase(out).phase).toBe('loading');
    await flush();
    expect(closed).toEqual(['lite']);
    expect(created).toEqual(['lite', 'full']);

    // Disable: released, off, nothing new created.
    out = h.process({}, ctxWith({ body: { enabled: false, model: 'full' } }));
    expect(closed).toEqual(['lite', 'full']);
    expect(phase(out).phase).toBe('off');
    h.dispose?.();
    expect(created).toHaveLength(2);
  });

  it('a failed load is not re-hammered, and switching model retries (the review’s finding)', async () => {
    failModel = 'lite';
    const h = webcamBodyNode.make(webcamBodyNode.params.parse({}));
    await h.init?.(ctxWith({ body: { enabled: true, model: 'lite' } }));
    h.process({}, ctxWith({ body: { enabled: true, model: 'lite' } }));
    await flush();
    let out = h.process({}, ctxWith({ body: { enabled: true, model: 'lite' } }));
    expect(phase(out).phase).toBe('error');
    // Ticking on does not retry the failed model.
    for (let i = 0; i < 5; i++) h.process({}, ctxWith({ body: { enabled: true, model: 'lite' } }));
    await flush();
    expect(created).toEqual([]);
    // Picking the other model on the dial retries at once.
    out = h.process({}, ctxWith({ body: { enabled: true, model: 'full' } }));
    expect(phase(out).phase).toBe('loading');
    await flush();
    expect(created).toEqual(['full']);
    expect(phase(h.process({}, ctxWith({ body: { enabled: true, model: 'full' } }))).phase).toBe('ready');
    h.dispose?.();
  });

  it('with no camera frames it says so (no download), and retries by itself when frames arrive', async () => {
    const h = webcamBodyNode.make(webcamBodyNode.params.parse({}));
    await h.init?.(ctxWith({ body: { enabled: true, model: 'lite' } }, deadVideo));
    let out = h.process({}, ctxWith({ body: { enabled: true, model: 'lite' } }, deadVideo));
    expect(phase(out)).toMatchObject({ phase: 'unavailable', reason: NO_CAMERA_REASON });
    await flush();
    expect(created).toEqual([]);
    // The camera comes up: the next tick loads without the player touching anything.
    out = h.process({}, ctxWith({ body: { enabled: true, model: 'lite' } }, liveVideo));
    expect(phase(out).phase).toBe('loading');
    await flush();
    expect(created).toEqual(['lite']);
    h.dispose?.();
  });

  it('reports active while a body is detected', async () => {
    const present: BodyFrame = { ...EMPTY_BODY_FRAME, present: true };
    const detecting: BodyLandmarkerFactory = async ({ model }) => ({
      resource: {
        model,
        landmarker: {
          detectForVideo: () => ({
            landmarks: [Array.from({ length: BODY_LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, visibility: 1 }))],
          }),
          close: () => {},
        },
      },
    });
    // Run the rAF loop exactly ONCE when first scheduled (the loop re-arms itself, and a
    // stub that always ran it would spin the microtask queue forever).
    let armed = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      if (armed++ === 0) queueMicrotask(cb);
      return 1;
    });
    const h = webcamBodyNode.make(webcamBodyNode.params.parse({}));
    const ctx: NodeContext = { tick: 0, time: 0, dt: 0, resources: { video: { ...liveVideo, currentTime: 1 }, controls: () => ({ body: { enabled: true } }), createBodyLandmarker: detecting } };
    await h.init?.(ctx);
    h.process({}, ctx);
    await flush();
    h.process({}, ctx); // schedules the loop
    await flush();
    const out = h.process({}, ctx);
    expect((out.body as BodyFrame).present).toBe(present.present);
    expect(phase(out).phase).toBe('active');
    h.dispose?.();
  });
});
