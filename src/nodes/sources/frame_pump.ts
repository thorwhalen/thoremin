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
 * The shape, and why. The animation-frame loop stays the DRIVER: it polls
 * `currentTime` and runs inference on every new frame at once, exactly as before, so
 * no frame is ever held or dropped and a browser that never fires the video frame
 * callback for an element that is not rendered (the app's `<video>` is
 * `display: none`) degrades to exactly the pre-#226 behaviour instead of a silent
 * instrument. The video frame callback is a SIDE CHANNEL that records each presented
 * frame's metadata. When the driver sees a new frame whose `currentTime` matches the
 * recorded `mediaTime`, the frame is stamped from that metadata (`captureTime`, else
 * `presentationTime`). When the callback runs late — after the driver has already
 * delivered the frame, which the spec allows by one vsync — the metadata still
 * teaches the pump the camera's lag (capture to delivery), and every frame whose own
 * metadata has not arrived is stamped at the clock minus that recent lag (source
 * `estimated`): a few milliseconds of jitter instead of a whole lag of bias. With no
 * lag learned yet, the stamp is the clock.
 *
 * {@link pickFrameStamp} is the pure decision and is unit-tested. A stamp says which
 * source it came from (`FrameTiming.tSource`), is strictly increasing by at least a
 * millisecond (MediaPipe's `detectForVideo` requires increasing timestamps and works
 * in whole milliseconds), carries the measured capture-to-inference lag (the first
 * term of the latency budget #227 wants measured) and the time base's origin
 * (`performance.timeOrigin`), which is how a consumer tells a live stamp from one in
 * a replayed recording. The sources put all of it on the frame, so the recorder
 * keeps it. A capture time in the future, or more than a second old, is not trusted.
 */
import type { FrameTiming } from '../domain';

/** The subset of `VideoFrameCallbackMetadata` this module reads. */
export interface VideoFrameMetadataLike {
  /** For a local camera: when the frame was captured, `performance.now()` base. */
  captureTime?: number;
  /** When the frame was submitted for compositing, `performance.now()` base. */
  presentationTime?: number;
  /** The frame's presentation time in the media timeline (seconds; what
   *  `video.currentTime` reads while this frame is current). */
  mediaTime?: number;
}

/** The element surface this module needs; declared here rather than relying on the
 *  DOM lib's version of `requestVideoFrameCallback`. */
export interface VideoFrameCallbackTarget {
  requestVideoFrameCallback?(cb: (now: number, metadata: VideoFrameMetadataLike) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
}

export type StampSource = NonNullable<FrameTiming['tSource']>;

export interface FrameStamp {
  /** The frame's timestamp in milliseconds, `performance.now()` base; at least
   *  {@link MIN_STAMP_STEP_MS} greater than the previous frame's. */
  tMs: number;
  /** Where the stamp came from: the camera (`capture`), the compositor
   *  (`presentation`), the clock minus the recent capture lag (`estimated`: the
   *  metadata for this one frame was missed, or the stamp had to be pushed forward
   *  to stay increasing) or the wall clock at the moment the pump noticed the frame
   *  (`clock`, the pre-#226 behaviour). */
  source: StampSource;
  /** Milliseconds from the stamp to the moment the frame was handed to inference. */
  lagMs: number;
}

/** A timestamp older than this is in another time base, or garbage. */
export const MAX_PLAUSIBLE_LAG_MS = 1000;
/** A timestamp may lead the clock by at most this (clock skew between the compositor
 *  thread and the main thread); beyond it, it is not trusted. */
export const MAX_FUTURE_MS = 5;
/** The smallest step between two stamps. MediaPipe works in whole milliseconds. */
export const MIN_STAMP_STEP_MS = 1;
/** `mediaTime` must match `currentTime` this closely (seconds) for the metadata to
 *  describe the frame the driver is looking at. */
export const MEDIA_TIME_TOLERANCE_S = 0.002;
/** The recent-lag estimate ignores any single lag above this (ms): a stalled frame
 *  must not drag every estimated stamp early. */
export const MAX_LAG_EW_MS = 200;
/** Gain of the exponentially weighted recent lag. */
export const LAG_EW_GAIN = 0.2;

const plausible = (candidate: number | undefined, nowMs: number): candidate is number =>
  typeof candidate === 'number' &&
  Number.isFinite(candidate) &&
  nowMs - candidate <= MAX_PLAUSIBLE_LAG_MS &&
  candidate - nowMs <= MAX_FUTURE_MS;

/**
 * Choose a frame's timestamp. `nowMs` is the clock at the moment the frame is being
 * handed to inference; `meta` the video frame callback's metadata for THIS frame
 * (absent when none matched); `lastMs` the previous stamp (`-Infinity` for the
 * first); `estimatedLagMs` the recent capture lag when the channel is live but this
 * frame's metadata was missed (NaN otherwise). Pure.
 */
export function pickFrameStamp(nowMs: number, meta: VideoFrameMetadataLike | undefined, lastMs: number, estimatedLagMs = NaN): FrameStamp {
  let tMs: number;
  let source: StampSource;
  if (plausible(meta?.captureTime, nowMs)) {
    tMs = meta!.captureTime!;
    source = 'capture';
  } else if (plausible(meta?.presentationTime, nowMs)) {
    tMs = meta!.presentationTime!;
    source = 'presentation';
  } else if (Number.isFinite(estimatedLagMs) && estimatedLagMs >= 0) {
    tMs = nowMs - estimatedLagMs;
    source = 'estimated';
  } else {
    tMs = nowMs;
    source = 'clock';
  }
  if (!(tMs >= lastMs + MIN_STAMP_STEP_MS)) {
    tMs = lastMs + MIN_STAMP_STEP_MS;
    if (source !== 'clock') source = 'estimated';
  }
  return { tMs, source, lagMs: nowMs - tMs };
}

/** The timing fields a source spreads onto a frame from a {@link FrameStamp}. */
export function stampToTiming(stamp: FrameStamp, originMs: number = timeOrigin()): Required<FrameTiming> {
  return { t: stamp.tMs / 1000, tSource: stamp.source, tOrigin: originMs, lag: stamp.lagMs / 1000 };
}

/** This document's `performance.timeOrigin` (ms since the epoch); NaN where absent. */
export function timeOrigin(): number {
  const o = typeof performance !== 'undefined' ? performance.timeOrigin : NaN;
  return typeof o === 'number' ? o : NaN;
}

/** Does this metadata describe the frame the element currently shows? */
export function metadataMatches(meta: VideoFrameMetadataLike | null, currentTime: number): boolean {
  return !!meta && typeof meta.mediaTime === 'number' && Math.abs(meta.mediaTime - currentTime) <= MEDIA_TIME_TOLERANCE_S;
}

export interface FramePumpOptions {
  /** Register the video frame callback side channel when the element has it (default
   *  true). */
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
  /** Whether the video frame callback side channel is registered on the element. */
  readonly metadataChannel: boolean;
}

/**
 * Pump frames from `getVideo()` into `onFrame`. The element is read through a getter
 * because two of the sources re-read it from the engine resources every tick. A frame
 * is delivered once per change of `currentTime` on a ready element (`readyState >= 2`,
 * a non-zero width). `onFrame` may return `false` to say it did not consume the frame
 * (no model loaded yet), in which case the same frame is offered again on the next
 * animation frame.
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
  let rafId: number | null = null;
  let vfcId: number | null = null;
  let vfcVideo: (HTMLVideoElement & VideoFrameCallbackTarget) | null = null;
  /** The most recent presented frame's metadata (the side channel). */
  let latestMeta: VideoFrameMetadataLike | null = null;
  let lastVideoTime = -1;
  let lastMs = -Infinity;
  /** When the last frame was delivered (clock ms), for a callback that comes late. */
  let lastDeliveryMs = NaN;
  /** Exponentially weighted capture-to-delivery lag (ms); NaN until learned. */
  let lagEw = NaN;

  const ready = (v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0;
  const learnLag = (lagMs: number) => {
    const lag = Math.min(MAX_LAG_EW_MS, Math.max(0, lagMs));
    lagEw = Number.isFinite(lagEw) ? lagEw + LAG_EW_GAIN * (lag - lagEw) : lag;
  };

  const deliver = (v: HTMLVideoElement, meta: VideoFrameMetadataLike | undefined) => {
    const nowMs = now();
    // The learned lag describes the pipeline, not the channel: once known it is used
    // even after the callbacks go quiet (a hidden tab), so a return does not start
    // again from a clock stamp.
    const stamp = pickFrameStamp(nowMs, meta, lastMs, lagEw);
    if (onFrame(stamp, v) === false) return;
    lastMs = stamp.tMs;
    lastVideoTime = v.currentTime;
    lastDeliveryMs = nowMs;
    if (stamp.source === 'capture') learnLag(stamp.lagMs);
  };

  const unregisterVfc = () => {
    if (vfcId !== null && vfcVideo && typeof vfcVideo.cancelVideoFrameCallback === 'function') vfcVideo.cancelVideoFrameCallback(vfcId);
    vfcId = null;
    vfcVideo = null;
  };

  /** Keep the side channel registered on the element the driver is looking at. */
  const ensureVfc = (v: HTMLVideoElement & VideoFrameCallbackTarget) => {
    if (!useVfc || typeof v.requestVideoFrameCallback !== 'function') return;
    if (vfcVideo !== v) unregisterVfc();
    if (vfcId !== null) return;
    vfcVideo = v;
    vfcId = v.requestVideoFrameCallback((_cbNow, meta) => {
      vfcId = null;
      if (!running || vfcVideo !== v) return;
      latestMeta = meta;
      // Late for a frame the driver already delivered: still learn the lag from it.
      if (metadataMatches(meta, lastVideoTime) && Number.isFinite(lastDeliveryMs) && typeof meta.captureTime === 'number') {
        const lag = lastDeliveryMs - meta.captureTime;
        if (lag >= -MAX_FUTURE_MS && lag <= MAX_PLAUSIBLE_LAG_MS) learnLag(lag);
      }
      ensureVfc(v);
    });
  };

  const tick = () => {
    rafId = null;
    if (!running) return;
    const v = getVideo() as (HTMLVideoElement & VideoFrameCallbackTarget) | undefined;
    if (v) {
      ensureVfc(v);
      if (ready(v) && v.currentTime !== lastVideoTime) deliver(v, metadataMatches(latestMeta, v.currentTime) ? latestMeta! : undefined);
    }
    rafId = raf(tick);
  };

  return {
    get running() {
      return running;
    },
    get metadataChannel() {
      return vfcId !== null;
    },
    start() {
      if (running) return;
      running = true;
      rafId = raf(tick);
    },
    stop() {
      running = false;
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }
      unregisterVfc();
      latestMeta = null;
      lastVideoTime = -1;
      lastDeliveryMs = NaN;
    },
  };
}
