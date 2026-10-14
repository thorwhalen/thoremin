/**
 * #324: on the CPU delegate a camera model is handed a 2D copy of the frame, never the
 * `<video>` element (a rescaled camera frame's WebGL upload is the wrong picture on a
 * software renderer; `src/nodes/sources/model_input.ts` has the numbers). The copier, the
 * wrapper, and a structural guard that every main-thread loader applies it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyFramesOnCpu, createFrameCopier, isRescaledCamera, type CopyCanvas } from '../src/nodes/sources/model_input';

function fakeCanvas() {
  const draws: Array<{ image: unknown; w: number; h: number }> = [];
  const canvas: CopyCanvas & { draws: typeof draws } = {
    width: 300,
    height: 150,
    draws,
    getContext: () => ({
      drawImage: (image: unknown, _x: number, _y: number, w: number, h: number) => void draws.push({ image, w, h }),
    }),
  };
  return canvas;
}

/** A camera video; `resizeMode` as the track reports it (`undefined`: not reported). */
const camera = (w: number, h: number, resizeMode: string | undefined = 'crop-and-scale') => ({
  videoWidth: w,
  videoHeight: h,
  srcObject: { getVideoTracks: () => [{ getSettings: () => (resizeMode === undefined ? {} : { resizeMode }) }] },
});
const video = camera;

describe('isRescaledCamera', () => {
  it('is a camera frame rescaled from its native mode, or one whose mode is not reported', () => {
    expect(isRescaledCamera(camera(640, 360, 'crop-and-scale'))).toBe(true);
    expect(isRescaledCamera(camera(1280, 720, 'none'))).toBe(false);
    expect(isRescaledCamera(camera(1280, 720, undefined))).toBe(true);
  });

  it('is not a video with no stream (a file) or a stream with no video track', () => {
    expect(isRescaledCamera({ videoWidth: 640, videoHeight: 360, srcObject: null })).toBe(false);
    expect(isRescaledCamera({ videoWidth: 640, videoHeight: 360, srcObject: { getVideoTracks: () => [] } })).toBe(false);
  });
});

describe('createFrameCopier', () => {
  it('draws a rescaled camera frame into one canvas at the frame size and returns the canvas', () => {
    const canvas = fakeCanvas();
    let made = 0;
    const copy = createFrameCopier(() => (made++, canvas));
    const v = video(640, 360);
    expect(copy(v)).toBe(canvas);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(canvas.draws).toEqual([{ image: v, w: 640, h: 360 }]);
    // The camera changes mode: the same canvas follows it.
    expect(copy(video(1280, 720))).toBe(canvas);
    expect([canvas.width, canvas.height]).toEqual([1280, 720]);
    expect(made).toBe(1);
  });

  it('passes through what is not a video, a video with no frame yet, and a browser with no canvas', () => {
    const canvas = fakeCanvas();
    const copy = createFrameCopier(() => canvas);
    const bitmap = { width: 640, height: 360 };
    expect(copy(bitmap)).toBe(bitmap);
    const empty = video(0, 0);
    expect(copy(empty)).toBe(empty);
    // A camera at its native size reads correctly from the element: no copy to pay for.
    const native = camera(1280, 720, 'none');
    expect(copy(native)).toBe(native);
    expect(canvas.draws).toHaveLength(0);
    const v = video(640, 360);
    expect(createFrameCopier(() => null)(v)).toBe(v);
    const noContext: CopyCanvas = { width: 0, height: 0, getContext: () => null };
    expect(createFrameCopier(() => noContext)(v)).toBe(v);
  });
});

describe('copyFramesOnCpu', () => {
  class FakeLandmarker {
    #closed = false;
    seen: unknown[] = [];
    numHands = 2;
    detectForVideo(image: unknown, ts: number) {
      this.seen.push(image);
      return { ts };
    }
    async setOptions(o: { numHands?: number }) {
      if (o.numHands) this.numHands = o.numHands;
    }
    close() {
      this.#closed = true; // a private field: the wrapper must call on the landmarker itself
    }
    get closed() {
      return this.#closed;
    }
  }

  it('hands the CPU delegate a copy, and forwards every other member to the landmarker', async () => {
    const lm = new FakeLandmarker();
    const canvas = fakeCanvas();
    const wrapped = copyFramesOnCpu(lm, 'CPU', createFrameCopier(() => canvas));
    const v = video(640, 360);
    expect(wrapped.detectForVideo(v, 42)).toEqual({ ts: 42 });
    expect(lm.seen).toEqual([canvas]);
    await wrapped.setOptions({ numHands: 1 });
    expect(lm.numHands).toBe(1);
    wrapped.close();
    expect(lm.closed).toBe(true);
    expect(wrapped.closed).toBe(true);
  });

  it('leaves the GPU delegate on the element itself', () => {
    const lm = new FakeLandmarker();
    expect(copyFramesOnCpu(lm, 'GPU')).toBe(lm);
  });
});

describe('every main-thread camera model loader copies frames on the CPU delegate', () => {
  const root = join(__dirname, '..');
  // The worker is handed ImageBitmaps made by `createImageBitmap(video)`, which are right.
  const EXEMPT = new Set(['src/nodes/sources/hands.worker.ts']);
  const walk = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(`${dir}/${e.name}`)) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  // Any tasks-vision factory (`createFromOptions`, `createFromModelPath`, ...) called on a
  // landmarker class, wherever its arguments wrap to.
  const CREATE = /\.\w+Landmarker\s*\.\s*createFrom\w+\s*\(/;
  const files = [...walk('src'), ...walk('packages')].filter((f) => !EXEMPT.has(f) && !f.includes('.test.'));
  const loaders = files.filter((f) => CREATE.test(readFileSync(join(root, f), 'utf8')));

  it('finds the loaders', () => {
    expect(loaders.sort()).toEqual(['src/nodes/sources/webcam_body.ts', 'src/nodes/sources/webcam_face.ts', 'src/nodes/sources/webcam_hands.ts']);
  });

  it.each(loaders)('%s wraps every landmarker it creates, with the delegate it was created with', (f) => {
    const text = readFileSync(join(root, f), 'utf8').replace(/\s+/g, ' ');
    const creates = text.match(/\.\w+Landmarker \. createFrom\w+ \(|\.\w+Landmarker\.createFrom\w+\(/g) ?? [];
    // Each creation is the first argument of `copyFramesOnCpu`, whose second argument is the
    // delegate the options were built with (`optionsFor(d)` / `options(d)` ... `, d)`).
    const wrapped = [...text.matchAll(/copyFramesOnCpu\(await \w+\.\w+Landmarker\.createFrom\w+\(fileset, \w+\(([^()]+)\)\), ([^()]+?)\)/g)];
    expect(creates.length).toBeGreaterThan(0);
    expect(wrapped).toHaveLength(creates.length);
    for (const m of wrapped) expect(m[2].trim()).toBe(m[1].trim());
  });
});
