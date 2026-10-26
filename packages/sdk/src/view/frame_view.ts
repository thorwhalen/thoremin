/**
 * The one frame-to-display transform (#817): where a point of the camera frame lands on a canvas.
 *
 * Why it exists: every overlay element used to convert landmarks to pixels by hand
 * (`mirrorX(x, frame.width, W)`, `(y / frame.height) * H`), the backdrop stretched the video to the
 * canvas, and the mirror was applied (or forgotten) element by element. That is right only while the
 * canvas has the video's aspect ratio. A {@link FrameView} is built once per draw pass from the
 * canvas, the frame and the host's {@link ViewOptions}; the video and every dot go through the same
 * rectangle and the same mirror, so they cannot disagree, and no element holds a mirror flag it
 * could apply twice. Text, labels and handedness colours never go through it.
 *
 * Pure and Node-safe (no DOM): the overlay, the drum pads and any mapping node that needs display
 * coordinates import it from the SDK. With `fit: 'stretch'` (the default) every coordinate is
 * bitwise what the hand-written expressions gave.
 */

/** How the frame is placed on the canvas: filled exactly, covering it (cropped), or contained (bars). */
export const FITS = ['stretch', 'cover', 'contain'] as const;
export type Fit = (typeof FITS)[number];

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewOptions {
  /** Selfie view: the displayed image is the frame flipped left-right. Default true. */
  mirror?: boolean;
  /** Default `stretch`: the frame fills the canvas, as the app has always drawn it. */
  fit?: Fit;
}

/** The rectangle the (unmirrored) frame occupies on the canvas, in canvas pixels; it may overhang under `cover`. */
export function fitRect(frame: Size, canvas: Size, fit: Fit): Rect {
  if (fit === 'stretch') return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const sx = canvas.width / frame.width;
  const sy = canvas.height / frame.height;
  const s = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const w = frame.width * s;
  const h = frame.height * s;
  return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
}

/** A frame size usable as a divisor, else the canvas's own (no frame yet: the identity placement). */
const usable = (frame: Size | undefined, canvas: Size): Size =>
  frame && frame.width > 0 && frame.height > 0 && Number.isFinite(frame.width) && Number.isFinite(frame.height) ? frame : canvas;

export interface FrameView {
  /** Where the unmirrored frame sits on the canvas, in canvas pixels (the backdrop's rectangle). */
  readonly rect: Rect;
  readonly mirror: boolean;
  /** Fractions (0..1) of the UNMIRRORED frame, to canvas pixels (a face mesh point). */
  unit(u: number, v: number): { x: number; y: number };
  /** Pixels of a frame of `size`, to canvas pixels (a hand or body keypoint). `size` is the SOURCE frame's own; it is required so a stale default cannot silently give plausible wrong pixels. */
  px(x: number, y: number, size: Size): { x: number; y: number };
  /** Fractions of the DISPLAYED (already mirrored) frame, to canvas pixels (pads, guides, mapped features). */
  shown(d: number, e: number): { x: number; y: number };
  /** The inverse of {@link shown}: a canvas point (a pointer) as displayed-frame fractions. */
  toShown(cx: number, cy: number): { x: number; y: number };
  /** The part of the displayed frame (as fractions) that is on the canvas: the whole of it unless `cover` crops. */
  visibleShown(): Rect;
}

/** Build the transform for one draw pass. `frame` is the camera frame's size, when known. */
export function makeFrameView(canvas: Size, frame: Size | undefined, { mirror = true, fit = 'stretch' }: ViewOptions = {}): FrameView {
  const f = usable(frame, canvas);
  const rect = fitRect(f, canvas, fit);
  const unit = (u: number, v: number) => ({
    x: mirror ? rect.x + (rect.w - u * rect.w) : rect.x + u * rect.w,
    y: rect.y + v * rect.h,
  });
  // A zero-size canvas has no area to divide by: the inverse and the visible part stay finite.
  const empty = !(rect.w > 0 && rect.h > 0);
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  return {
    rect,
    mirror,
    unit,
    px: (x, y, size) => unit(x / size.width, y / size.height),
    shown: (d, e) => ({ x: rect.x + d * rect.w, y: rect.y + e * rect.h }),
    toShown: (cx, cy) => (empty ? { x: 0, y: 0 } : { x: (cx - rect.x) / rect.w, y: (cy - rect.y) / rect.h }),
    visibleShown() {
      if (empty) return { x: 0, y: 0, w: 1, h: 1 };
      const x0 = clamp01((0 - rect.x) / rect.w);
      const x1 = clamp01((canvas.width - rect.x) / rect.w);
      const y0 = clamp01((0 - rect.y) / rect.h);
      const y1 = clamp01((canvas.height - rect.y) / rect.h);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
  };
}

/** Per-call form for a mapping node: a frame pixel to canvas pixels under `opts`. */
export function frameToDisplay(x: number, y: number, vw: number, vh: number, W: number, H: number, opts?: ViewOptions): { x: number; y: number } {
  return makeFrameView({ width: W, height: H }, { width: vw, height: vh }, opts).px(x, y, { width: vw, height: vh });
}

/** A frame pixel as fractions of the displayed frame (the pads' space), mirrored unless `mirror` is false. */
export function displayedUnit(xPx: number, yPx: number, size: Size, { mirror = true }: { mirror?: boolean } = {}): { x: number; y: number } {
  return { x: mirror ? 1 - xPx / size.width : xPx / size.width, y: yPx / size.height };
}

/** The canvas drawing surface `drawFrame` needs, structurally typed so the SDK takes no DOM dependency. */
export interface FrameSurface {
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

/**
 * Draw the camera image through `view`: mirrored when the view mirrors, placed in `view.rect`. With
 * `stretch` the calls are exactly the old backdrop's (`scale(-1,1)`, `translate(-W,0)`, `drawImage(v,0,0,W,H)`).
 * The caller owns save/restore and alpha.
 */
export function drawFrame(g: FrameSurface, image: CanvasImageSource, view: FrameView): void {
  const r = view.rect;
  if (view.mirror) {
    g.scale(-1, 1);
    g.translate(-(r.x + r.w), r.y);
  } else {
    g.translate(r.x, r.y);
  }
  g.drawImage(image, 0, 0, r.w, r.h);
}
