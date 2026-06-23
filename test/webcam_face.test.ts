/**
 * Tests for the `webcam-face` source node.
 *
 * The live MediaPipe inference is browser-only, so `@mediapipe/tasks-vision` is
 * mocked here — that lets us drive the node's deterministic logic headlessly:
 *   1. the pure blendshapes → FaceFrame converter (the shape the offline
 *      `scripts/video_to_face.py` fixture also produces),
 *   2. the gating contract: off by default, emit the absent frame and never even
 *      reach the model loader,
 *   3. lazy offload on disable + retry on re-enable + idempotent dispose,
 *   4. the GPU→CPU delegate fallback when GPU creation fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NodeContext } from '@/dag';

/** Drain pending microtasks (the mocked async load chain resolves on them). */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// Mocked MediaPipe runtime — hoisted so the vi.mock factory can reference the spies.
const { forVisionTasks, createFromOptions, fakeLandmarker } = vi.hoisted(() => {
  const fakeLandmarker = { detectForVideo: () => ({}), close: vi.fn() };
  return {
    forVisionTasks: vi.fn(async () => ({})),
    createFromOptions: vi.fn(async () => fakeLandmarker),
    fakeLandmarker,
  };
});
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks },
  FaceLandmarker: { createFromOptions },
}));

// The node lives in a browser-only file; importing it is Node-safe (the heavy
// runtime is only dynamically imported inside the lazy loader).
import { webcamFaceNode, blendshapesToFaceFrame } from '@/nodes/sources/webcam_face';

const ABSENT = { face: { present: false, blendshapes: {} } };

const ctx = (faceEnabled?: boolean, video?: unknown): NodeContext =>
  ({
    tick: 0,
    time: 0,
    dt: 0,
    resources: {
      ...(faceEnabled === undefined ? {} : { controls: () => ({ faceEnabled }) }),
      ...(video === undefined ? {} : { video }),
    },
  }) as unknown as NodeContext;

// A truthy <video> stand-in; never "ready" so the inference loop never fires.
const fakeVideo = () => ({ readyState: 0, videoWidth: 0, currentTime: 0 }) as unknown;

// The node starts a requestAnimationFrame loop once the (mocked) model loads.
// Force a no-op rAF (and restore it after) so the loop never schedules real work
// and we don't pollute the shared global for other test files.
const g = globalThis as Record<string, unknown>;
let savedRaf: unknown;
let savedCaf: unknown;

beforeEach(() => {
  savedRaf = g.requestAnimationFrame;
  savedCaf = g.cancelAnimationFrame;
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  forVisionTasks.mockClear();
  createFromOptions.mockClear();
  createFromOptions.mockImplementation(async () => fakeLandmarker);
  fakeLandmarker.close.mockClear();
});

afterEach(() => {
  g.requestAnimationFrame = savedRaf;
  g.cancelAnimationFrame = savedCaf;
});

describe('blendshapesToFaceFrame', () => {
  it('maps MediaPipe categories to a present FaceFrame keyed by name', () => {
    const frame = blendshapesToFaceFrame({
      faceBlendshapes: [
        {
          categories: [
            { categoryName: 'mouthSmileLeft', score: 0.5 },
            { categoryName: 'mouthSmileRight', score: 0.4 },
            { categoryName: 'jawOpen', score: 0.2 },
          ],
        },
      ],
    });
    expect(frame).toEqual({
      present: true,
      blendshapes: { mouthSmileLeft: 0.5, mouthSmileRight: 0.4, jawOpen: 0.2 },
    });
  });

  it('returns the absent frame when no face was detected', () => {
    const absent = { present: false, blendshapes: {} };
    expect(blendshapesToFaceFrame({})).toEqual(absent);
    expect(blendshapesToFaceFrame({ faceBlendshapes: [] })).toEqual(absent);
    expect(blendshapesToFaceFrame({ faceBlendshapes: [{ categories: [] }] })).toEqual(absent);
  });
});

describe('webcam-face node gating', () => {
  it('emits the absent frame when face control is off and never loads the model', () => {
    const inst = webcamFaceNode.make({ delegate: 'GPU' });
    // No controls getter (headless / pre-wired) and explicitly disabled, both
    // with a video present — the loader must not be reached either way.
    expect(inst.process({}, ctx(undefined, fakeVideo()))).toEqual(ABSENT);
    expect(inst.process({}, ctx(false, fakeVideo()))).toEqual(ABSENT);
    expect(createFromOptions).not.toHaveBeenCalled();
    expect(forVisionTasks).not.toHaveBeenCalled();
  });

  it('does not load the model when enabled but no camera <video> is present', () => {
    const inst = webcamFaceNode.make({ delegate: 'GPU' });
    expect(inst.process({}, ctx(true))).toEqual(ABSENT);
    expect(createFromOptions).not.toHaveBeenCalled();
  });

  it('offloads on disable, re-enables, and is idempotent on dispose — never throws', async () => {
    const inst = webcamFaceNode.make({ delegate: 'GPU' });
    let faceEnabled = true;
    const live = ctx(true, fakeVideo());
    // Re-point the controls getter at the mutable flag.
    (live.resources as Record<string, unknown>).controls = () => ({ faceEnabled });

    // Enable + video → loader kicks off (loading set synchronously); absent this tick.
    expect(inst.process({}, live)).toEqual(ABSENT);
    // Disable while still loading → offload() runs via the `loading` branch.
    faceEnabled = false;
    expect(inst.process({}, live)).toEqual(ABSENT);
    // Re-enable → no throw, still absent.
    faceEnabled = true;
    expect(inst.process({}, live)).toEqual(ABSENT);
    expect(() => {
      inst.dispose?.();
      inst.dispose?.();
    }).not.toThrow();
    expect(inst.process({}, live)).toEqual(ABSENT);
    await flush(); // let the dangling mocked load settle (it self-closes)
  });
});

describe('webcam-face delegate fallback', () => {
  it('falls back to the CPU delegate when GPU model creation fails', async () => {
    // Resolve exactly when the 2nd (CPU) create is invoked — deterministic under
    // any load, unlike a timed flush of the import→fileset→create chain.
    let resolveSecondCall = () => {};
    const secondCall = new Promise<void>((r) => {
      resolveSecondCall = r;
    });
    createFromOptions
      .mockRejectedValueOnce(new Error('no webgl'))
      .mockImplementationOnce(async () => {
        resolveSecondCall();
        return fakeLandmarker;
      });
    const inst = webcamFaceNode.make({ delegate: 'GPU' });
    inst.process({}, ctx(true, fakeVideo())); // kicks the async load (GPU fails → CPU)
    await secondCall;
    expect(createFromOptions).toHaveBeenCalledTimes(2);
    const calls = createFromOptions.mock.calls as unknown as Array<
      [unknown, { baseOptions: { delegate: string } }]
    >;
    expect(calls[0][1].baseOptions.delegate).toBe('GPU');
    expect(calls[1][1].baseOptions.delegate).toBe('CPU');
    inst.dispose?.();
    await flush(); // settle the resolved load (no-op rAF; landmarker set then disposed)
  });
});
