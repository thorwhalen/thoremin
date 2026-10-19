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
 * (`delegate.ts`), and a real camera rescales whenever its native mode is not 1280x720.
 * In the built app, a fake camera with a native 1920x1080 clip (so the 1280x720 request is
 * crop-and-scaled) gave ONE hand at (0.73, 0.60) where the frame has two, at (0.48, 0.40) and
 * (0.46, 0.70); with the copy, both, in place.
 *
 * So on the CPU delegate a RESCALED camera frame is drawn into one reusable canvas first:
 * the 2D path scales correctly. The copy is not free: on SwiftShader at 1280x720 it adds
 * about 12 ms to a hand detect of 85 to 110 ms (the canvas asks for `willReadFrequently`,
 * which is 4 ms cheaper than a GPU-backed one there). The models share ONE copy per camera
 * frame (#495): before, each model made its own, so hands with face or body paid it two or
 * three times. So a frame at the camera's native size, which the
 * element reads correctly, keeps the element; a browser that does not report `resizeMode`
 * gets the copy (correct over cheap). The GPU delegate keeps the element (its upload is
 * right, and a copy would cost it a readback). The worker runner already hands the model
 * an `ImageBitmap` made from the element, which is right too, so it needs nothing.
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
  getContext(kind: '2d', options?: { willReadFrequently?: boolean }): { drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void } | null;
}

/** The part of a video element a copy reads. */
interface VideoLike {
  videoWidth: number;
  videoHeight: number;
}

function isVideo(image: unknown): image is VideoLike & CanvasImageSource {
  return typeof image === 'object' && image !== null && 'videoWidth' in image && 'videoHeight' in image;
}

/** The 2D context a copy draws with: CPU-backed, the cheaper one where the model is on the CPU. */
const COPY_CONTEXT = { willReadFrequently: true } as const;

function defaultCanvas(): CopyCanvas | null {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas') as unknown as CopyCanvas;
}

/**
 * Whether a video's frames are a camera's, rescaled from its native mode: a `MediaStream`
 * whose video track's `resizeMode` is not `'none'` (absent counts as rescaled: the copy is
 * the safe side). A video with no stream (a file) is not a rescaled camera.
 */
export function isRescaledCamera(video: unknown): boolean {
  const stream = (video as { srcObject?: unknown } | null)?.srcObject as
    | { getVideoTracks?: () => Array<{ getSettings?: () => { resizeMode?: string } }> }
    | null
    | undefined;
  if (!stream || typeof stream.getVideoTracks !== 'function') return false;
  const track = stream.getVideoTracks()[0];
  if (!track) return false;
  return track.getSettings?.().resizeMode !== 'none';
}

/**
 * A copier: a video element whose frames need it (`needsCopy`, by default
 * {@link isRescaledCamera}) becomes a canvas holding its current frame at the frame's own
 * size; anything else (an `ImageBitmap`, a canvas, a native-size camera) passes through.
 * Where no 2D canvas can be had, the element passes through too: the behaviour before
 * #324, never a lost frame.
 *
 * `frame` names the camera frame (#495): a call for the element and frame the canvas
 * already holds returns it without drawing again, so the models of one camera share one
 * copy. The key is the frame's timestamp each model is handed by its pump: the pumps run
 * in separate `requestVideoFrameCallback`s, but for one camera frame they read the same
 * capture (or presentation) time, so the same frame gets the same key and the next frame
 * another. A stamp with no such source (the clock at the moment a pump noticed the frame,
 * WebKit) differs between pumps, so those frames are copied once per model, as before:
 * never shared wrongly, only not shared. With no `frame`, every call draws.
 */
export function createFrameCopier(
  makeCanvas: () => CopyCanvas | null = defaultCanvas,
  needsCopy: (video: unknown) => boolean = isRescaledCamera,
): <T>(image: T, frame?: number) => T | CopyCanvas {
  let canvas: CopyCanvas | null | undefined;
  let ctx: ReturnType<CopyCanvas['getContext']> = null;
  /** What the canvas holds: the element and the frame key it was drawn for. */
  let held: { image: unknown; frame: number; w: number; h: number } | null = null;
  return <T>(image: T, frame: number = NaN): T | CopyCanvas => {
    if (!isVideo(image) || !needsCopy(image)) return image;
    const w = image.videoWidth;
    const h = image.videoHeight;
    if (!w || !h) return image;
    if (canvas === undefined) {
      canvas = makeCanvas();
      ctx = canvas?.getContext('2d', COPY_CONTEXT) ?? null;
      if (!ctx) console.warn('[thoremin] no 2D canvas for the camera model; it reads the video element (#324)');
    }
    if (!canvas || !ctx) return image;
    // The same frame of the same element, already drawn (another model's call): reuse it.
    if (held && held.image === image && held.frame === frame && held.w === w && held.h === h) return canvas;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.drawImage(image, 0, 0, w, h);
    held = Number.isFinite(frame) ? { image, frame, w, h } : null;
    return canvas;
  };
}

/** The one method this module changes; every landmarker (hand, face, pose) has it. */
interface DetectsForVideo {
  // `any`: each landmarker types its own image and result.
  detectForVideo(image: any, timestampMs: number, ...rest: any[]): any;
}

/** The copier every landmarker shares by default: one canvas, one copy per camera frame
 *  (#495). Sharing it is safe because `detectForVideo` on the CPU delegate reads its image
 *  before it returns, and the models run one after another on the main thread. */
const SHARED_COPY = createFrameCopier();

/**
 * The landmarker a loader returns: on the CPU delegate, one whose `detectForVideo` is
 * handed a copy of each video frame (the shared one, keyed by the frame's timestamp); on
 * the GPU delegate, the landmarker itself. Every other
 * member is the landmarker's own, called on the landmarker (so `close`, `setOptions` and
 * MediaPipe's private state are untouched).
 */
export function copyFramesOnCpu<L extends DetectsForVideo>(
  landmarker: L,
  delegate: Delegate,
  copy: <T>(image: T, frame?: number) => unknown = SHARED_COPY,
): L {
  if (delegate !== 'CPU') return landmarker;
  // Any further arguments (image-processing options, a callback) go through unchanged.
  const detectForVideo = (image: unknown, timestampMs: number, ...rest: unknown[]) =>
    landmarker.detectForVideo(copy(image, timestampMs), timestampMs, ...rest);
  return new Proxy(landmarker, {
    get(target, key) {
      if (key === 'detectForVideo') return detectForVideo;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
