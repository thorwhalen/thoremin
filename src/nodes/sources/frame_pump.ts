/**
 * The frame pump — drives per-frame inference from the shared `<video>` and stamps
 * every frame with the time it was CAPTURED, not the time inference happened to run
 * (#226).
 *
 * Why it matters. The three webcam sources used to notice a new frame from inside a
 * `requestAnimationFrame` loop (`video.currentTime` changed) and stamp it with
 * `performance.now()` at that moment. Between the camera's exposure and that
 * animation frame there are one to two frame periods of unknown and *variable*
 * offset, and every timing estimate downstream — the ictus parabolic fit, the impact
 * predictor, the body pulse — inherits that jitter; no interpolation can remove it
 * (`docs/research/intent-and-subframe-timing.md` §2, §5.1). The
 * `requestVideoFrameCallback` API fires once per presented video frame and, for a
 * `getUserMedia` source, carries `captureTime`: the camera's own capture timestamp
 * in the `performance.now()` time base. That is the number a sub-frame estimator
 * needs, and it costs nothing to read.
 *
 * So: {@link createFramePump} uses `requestVideoFrameCallback` when the element has
 * it and falls back to the old `requestAnimationFrame` + `currentTime` polling where
 * it does not (Firefox), and {@link pickFrameStamp} — pure, so it is unit-tested —
 * decides what the frame's timestamp is: the capture time when it is present and
 * plausible, else the callback's presentation time, else the clock, always strictly
 * increasing (MediaPipe's `detectForVideo` requires it). The stamp also carries the
 * measured capture-to-inference lag, which is the first term of the latency budget
 * #227 wants measured; the sources put it on the frame, so the recorder keeps it.
 *
 * Time base: `captureTime` is a `DOMHighResTimeStamp` in the same base as
 * `performance.now()`, which is also the base of the engine's `RealtimeClock` at
 * speed 1 — so a consumer may use the frame's capture time directly as its sample
 * time (see {@link frameTime}). A capture time that is implausibly far from the
 * clock (another base, or garbage) is not trusted.
 */

/** The subset of `VideoFrameCallbackMetadata` this module reads. */
export interface VideoFrameMetadataLike {
  /** For a local camera: when the frame was captured, `performance.now()` base. */
  captureTime?: number;
  /** When the frame was submitted for compositing. */
  presentationTime?: number;
  /** The frame's presentation time in the media timeline (seconds). */
  mediaTime?: number;
}

/** The element surface this module needs; declared here rather than relying on the
 *  DOM lib's version of `requestVideoFrameCallback`. */
export interface VideoFrameCallbackTarget {
  requestVideoFrameCallback?(cb: (now: number, metadata: VideoFrameMetadataLike) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
}

export interface FrameStamp {
  /** The frame's timestamp in milliseconds, `performance.now()` base. Strictly greater
   *  than the previous frame's. */
  tMs: number;
  /** Where the stamp came from: the camera (`capture`), the video frame callback's own
   *  timestamp (`presentation`) or the wall clock at the moment the pump noticed the
   *  frame (`clock`, the pre-#226 behaviour). */
  source: 'capture' | 'presentation' | 'clock';
  /** Milliseconds from the stamp to the moment the frame was handed to inference. */
  lagMs: number;
}

/** A timestamp further than this from the clock is in another time base, or garbage. */
export const MAX_PLAUSIBLE_LAG_MS = 1000;
/** The smallest step between two stamps (MediaPipe wants strictly increasing times). */
export const MIN_STAMP_STEP_MS = 0.001;

const plausible = (candidate: number | undefined, nowMs: number): candidate is number =>
  typeof candidate === 'number' &&
  Number.isFinite(candidate) &&
  nowMs - candidate >= -MAX_PLAUSIBLE_LAG_MS &&
  nowMs - candidate <= MAX_PLAUSIBLE_LAG_MS;

/**
 * Choose a frame's timestamp. `nowMs` is the clock at the moment the frame is being
 * handed to inference; `meta` the video frame callback's metadata (absent on the
 * animation-frame path); `lastMs` the previous stamp (`-Infinity` for the first);
 * `callbackNowMs` the callback's own `now` argument. Pure.
 */
export function pickFrameStamp(
  nowMs: number,
  meta: VideoFrameMetadataLike | undefined,
  lastMs: number,
  callbackNowMs?: number,
): FrameStamp {
  let tMs: number;
  let source: FrameStamp['source'];
  if (plausible(meta?.captureTime, nowMs)) {
    tMs = meta!.captureTime!;
    source = 'capture';
  } else if (plausible(callbackNowMs, nowMs)) {
    tMs = callbackNowMs;
    source = 'presentation';
  } else {
    tMs = nowMs;
    source = 'clock';
  }
  if (!(tMs > lastMs)) tMs = lastMs + MIN_STAMP_STEP_MS;
  return { tMs, source, lagMs: nowMs - tMs };
}

/** What a frame carries once a source has stamped it (optional on every frame type,
 *  so fixtures and synthetic sources that predate #226 still validate). */
export interface FrameTiming {
  /** Capture time in SECONDS, `performance.now()/1000` base (the engine's realtime
   *  base). Absent on replayed and synthetic frames. */
  t?: number;
  /** Seconds from capture to inference: the measured first term of the latency budget. */
  lag?: number;
}

/** A capture time further than this from the consumer's own time is in another base
 *  (a scaled clock, a replay) and is ignored. */
export const MAX_CAPTURE_SKEW_S = 0.25;

/**
 * The sample time a consumer should use for a frame: its capture time when the frame
 * carries one in the consumer's own time base, else the consumer's time (`ctx.time`).
 */
export function frameTime(frame: FrameTiming | undefined, fallback: number): number {
  const t = frame?.t;
  if (typeof t === 'number' && Number.isFinite(t) && Math.abs(t - fallback) <= MAX_CAPTURE_SKEW_S) return t;
  return fallback;
}

/** Seconds and stamp fields from a {@link FrameStamp}, to spread onto a frame. */
export function stampToTiming(stamp: FrameStamp): Required<FrameTiming> {
  return { t: stamp.tMs / 1000, lag: stamp.lagMs / 1000 };
}

export interface FramePumpOptions {
  /** Use `requestVideoFrameCallback` when the element has it (default true). */
  useVideoFrameCallback?: boolean;
  /** Injectable for tests. */
  now?: () => number;
  requestAnimationFrame?: (cb: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

export interface FramePump {
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** Which path is driving frames: set after the first schedule. */
  readonly mode: 'video-frame-callback' | 'animation-frame' | 'idle';
}

/**
 * Pump frames from `getVideo()` into `onFrame`. The element is read through a getter
 * because two of the sources re-read it from the engine resources every tick. A frame
 * is delivered once the element is ready (`readyState >= 2`, a non-zero width); on the
 * animation-frame path only when `currentTime` changed. `onFrame` may return `false`
 * to say it did not consume the frame (no model loaded yet), in which case the same
 * frame is offered again on the next animation frame.
 */
export function createFramePump(
  getVideo: () => HTMLVideoElement | undefined,
  onFrame: (stamp: FrameStamp, video: HTMLVideoElement) => boolean | void,
  options: FramePumpOptions = {},
): FramePump {
  const useVfc = options.useVideoFrameCallback ?? true;
  const now = options.now ?? (() => performance.now());
  const raf = options.requestAnimationFrame ?? ((cb) => requestAnimationFrame(cb));
  const caf = options.cancelAnimationFrame ?? ((h) => cancelAnimationFrame(h));

  let running = false;
  let mode: FramePump['mode'] = 'idle';
  let rafId: number | null = null;
  let vfcId: number | null = null;
  let vfcVideo: (HTMLVideoElement & VideoFrameCallbackTarget) | null = null;
  let lastVideoTime = -1;
  let lastMs = -Infinity;

  const ready = (v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0;

  const deliver = (v: HTMLVideoElement, stamp: FrameStamp) => {
    if (onFrame(stamp, v) === false) return;
    lastMs = stamp.tMs;
    lastVideoTime = v.currentTime;
  };

  const schedule = () => {
    if (!running) return;
    const v = getVideo() as (HTMLVideoElement & VideoFrameCallbackTarget) | undefined;
    if (v && useVfc && typeof v.requestVideoFrameCallback === 'function') {
      mode = 'video-frame-callback';
      vfcVideo = v;
      vfcId = v.requestVideoFrameCallback((cbNow, meta) => {
        vfcId = null;
        if (!running) return;
        if (ready(v)) deliver(v, pickFrameStamp(now(), meta, lastMs, cbNow));
        schedule();
      });
      return;
    }
    mode = 'animation-frame';
    rafId = raf(() => {
      rafId = null;
      if (!running) return;
      const cur = getVideo();
      if (cur && ready(cur) && cur.currentTime !== lastVideoTime) deliver(cur, pickFrameStamp(now(), undefined, lastMs));
      schedule();
    });
  };

  return {
    get running() {
      return running;
    },
    get mode() {
      return mode;
    },
    start() {
      if (running) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      mode = 'idle';
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }
      if (vfcId !== null && vfcVideo && typeof vfcVideo.cancelVideoFrameCallback === 'function') {
        vfcVideo.cancelVideoFrameCallback(vfcId);
      }
      vfcId = null;
      vfcVideo = null;
      lastVideoTime = -1;
    },
  };
}
