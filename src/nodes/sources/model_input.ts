/**
 * What a camera model is handed on the CPU delegate (#324): a 2D copy of the frame, never
 * the `<video>` element itself.
 *
 * Why. MediaPipe reads an `HTMLVideoElement` through a WebGL upload of the current video
 * frame. When Chromium has RESCALED the camera's frame to the size the page asked for
 * (`getSettings().resizeMode === 'crop-and-scale'`: the camera's native mode was another
 * size), that upload, on a software WebGL renderer, holds the top-left W x H pixels of the
 * native frame instead of the scaled picture. Measured in headless Chromium 153 on
 * SwiftShader, a fake camera playing a 1280x720 clip asked for smaller sizes:
 *
 * - the hand model on the CPU delegate found NO hands at 320x180, 480x270 and 640x360 (0 of
 *   25 frames, the original report), and at 960x540 it found them in the WRONG place (a
 *   wrist at y 0.94 against 0.40 in the frame); the pose model lost the body the same way;
 * - the same frame drawn into a 2D canvas, or made an `ImageBitmap`, gave the right hands
 *   at every size (25 of 25), and so did the GPU delegate on the element itself;
 * - a `<video>` playing a FILE at 640x360 was fine: only a rescaled camera frame is hit;
 * - at the camera's native size (1280x720 there, `resizeMode: 'none'`) the element and the
 *   copy agree exactly.
 *
 * The CPU delegate is what `delegate: 'auto'` picks on exactly those renderers
 * (`delegate.ts`), and a real camera rescales whenever its native mode is not 1280x720
 * (a 1080p-only camera, a 4:3 one cropped to 16:9). So on the CPU delegate every frame is
 * drawn into one reusable canvas first: the 2D path scales correctly, and costs a
 * `drawImage` (about a millisecond) against the model's 75 to 110 ms. The GPU delegate keeps
 * the element (its zero-copy upload is right, and a copy would cost it a readback). The
 * worker runner already hands the model an `ImageBitmap` made from the element, which is
 * right too, so it needs nothing.
 *
 * Applied by {@link copyFramesOnCpu} where each loader knows the delegate it actually got
 * (after its GPU-to-CPU fallback); `test/model_input.test.ts` fails a main-thread loader
 * that creates a landmarker without it.
 */
import type { Delegate } from './delegate';

/** The 2D drawing surface a copy is made on (a seam for tests). */
export interface CopyCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): { drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void } | null;
}

/** The part of a video element a copy reads. */
interface VideoLike {
  videoWidth: number;
  videoHeight: number;
}

function isVideo(image: unknown): image is VideoLike & CanvasImageSource {
  return typeof image === 'object' && image !== null && 'videoWidth' in image && 'videoHeight' in image;
}

function defaultCanvas(): CopyCanvas | null {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas') as unknown as CopyCanvas;
}

/**
 * A copier: a video element becomes a canvas holding its current frame at the frame's own
 * size; anything else (an `ImageBitmap`, a canvas) passes through. Where no 2D canvas can
 * be had, the element passes through too: today's behaviour, never a lost frame.
 */
export function createFrameCopier(makeCanvas: () => CopyCanvas | null = defaultCanvas): <T>(image: T) => T | CopyCanvas {
  let canvas: CopyCanvas | null | undefined;
  let ctx: ReturnType<CopyCanvas['getContext']> = null;
  return <T>(image: T): T | CopyCanvas => {
    if (!isVideo(image)) return image;
    const w = image.videoWidth;
    const h = image.videoHeight;
    if (!w || !h) return image;
    if (canvas === undefined) {
      canvas = makeCanvas();
      ctx = canvas?.getContext('2d') ?? null;
    }
    if (!canvas || !ctx) return image;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.drawImage(image, 0, 0, w, h);
    return canvas;
  };
}

/** The one method this module changes; every landmarker (hand, face, pose) has it. */
interface DetectsForVideo {
  // `any`: each landmarker types its own image and result.
  detectForVideo(image: any, timestampMs: number): any;
}

/**
 * The landmarker a loader returns: on the CPU delegate, one whose `detectForVideo` is
 * handed a copy of each video frame; on the GPU delegate, the landmarker itself. Every other
 * member is the landmarker's own, called on the landmarker (so `close`, `setOptions` and
 * MediaPipe's private state are untouched).
 */
export function copyFramesOnCpu<L extends DetectsForVideo>(
  landmarker: L,
  delegate: Delegate,
  copy: <T>(image: T) => unknown = createFrameCopier(),
): L {
  if (delegate !== 'CPU') return landmarker;
  const detectForVideo = (image: unknown, timestampMs: number) => landmarker.detectForVideo(copy(image), timestampMs);
  return new Proxy(landmarker, {
    get(target, key) {
      if (key === 'detectForVideo') return detectForVideo;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
