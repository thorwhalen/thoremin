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
 * needs, and it costs nothing to read. What the stamp IS: in Chrome on macOS and in
 * Safari it is the frame's ARRIVAL in the capture service, not the sensor's exposure
 * time (Chromium forwards the AVFoundation sample timestamp only behind a flag that is
 * off by default); Firefox hands over the camera pipeline's own timestamp. So the stamp
 * removes the browser-side jitter and the frame's position in the pipeline, not the
 * camera's exposure-to-arrival constant, which the strike test calibrates (#146 §A5.2).
 *
 * The shape, and why (revised by step 0 of the 2026-10-05 timing plan). The video frame
 * callback DRIVES delivery wherever it reports `presentedFrames`: a rise in that counter
 * is a new frame, whatever the element's clocks say, and the frame is handed to
 * inference from inside the callback with its own metadata. The earlier design let the
 * animation-frame loop drive (a change of `currentTime`) and used the callback only as a
 * side channel matched by `mediaTime`; measured in WebKit, that delivered every camera
 * frame TWICE and matched nothing (182 deliveries for 91 frames, every stamp `clock`):
 * WebKit's MediaStream player reports `currentTime` as a wall clock and `mediaTime` as
 * always 0, so the API had the stamp and the pump threw it away. The animation-frame
 * path is kept only where the callback is absent, has no `presentedFrames`, or has gone
 * silent for about two frame periods (a hidden tab; a browser that never fires it for
 * an element that is not rendered): there it polls `currentTime` and stamps at the
 * clock minus the lag the callbacks taught it (source `estimated`), else at the clock,
 * exactly the pre-#226 behaviour rather than a silent instrument. A frame the consumer
 * refuses (no model loaded yet) is offered again on the next animation frame.
 *
 * A callback that fires late for a frame the animation loop already delivered (the
 * first one after start, or after a silence) still teaches the pump the camera's lag.
 * When the counter rises by more than one, the frames in between were presented while
 * inference was busy and never processed: the stamp says how many (`skipped`), which is
 * the dropped-frame count the timing resource reports.
 *
 * Two counter cases that are not a rise, told apart by the sign. A counter that goes
 * BACKWARDS is a reset: a new `srcObject` on the same element restarts it from a small
 * number, and a counter never runs backwards within one source; the frame is new and
 * delivered with nothing skipped (a replaced element resets the pump's memory of the
 * counter the same way). A counter that stays EQUAL across callbacks is frozen: the
 * callbacks fire but count nothing (measured: one delivery in sixty camera frames from a
 * pump that trusted them). Such a callback refreshes neither the liveness clock nor the
 * period, so the silence rule engages on its own, and after
 * {@link MAX_VFC_CALLBACKS_WITHOUT_RISE} of them in a row the animation loop is handed
 * delivery outright. On that loop a wall-clock `currentTime` makes every animation frame
 * look new, so it delivers no closer than {@link RAF_SPACING_FRACTION} of the camera
 * period the callbacks taught it: one frame per camera frame, not per animation frame.
 * Before a period is learned (startup; a counter frozen from its first callback) a
 * registered callback that carries a counter, or has not fired yet, stands for a camera
 * at the default period; that assumption lapses once the callback has been silent for
 * {@link DEFAULT_SPACING_LAPSE_MS} (a hidden video on a browser that never fires it),
 * since it would otherwise cap a 60 fps camera at 30 on the pre-#226 path for ever.
 *
 * A second stamp producer sits behind the first (step 9 of the 2026-10-05 timing plan):
 * `@thoremin/sdk/timing/stamp_dejitter`, a gated causal de-jitter. Where the stamp is a
 * clock reading (`clock`, `estimated`) and a run of them shows the pipeline's jitter, it
 * replaces each with a least-squares line of stamp against frame index over the last
 * thirty, which recovers the camera's grid from the jittered readings (on the bench's
 * stamp-noise regime the prediction spread falls by about a quarter). It is a
 * pass-through, byte for byte, for a `capture` or `presentation` stamp — a de-jittered
 * capture stamp would undo #226 — and for a run that already sits on a grid (the
 * sample-and-hold stamps of a display-rate poll, a 1 ms-rounded capture time), so none
 * of the tests below that stamp from a regular clock see it. It is fitted on the clock
 * readings themselves, and the learned lag is subtracted again afterwards: the lag is a
 * slowly moving offset, not jitter, and while it converges it must not bend the line.
 * The source it reports is the input's: a smoothed clock reading is still a clock
 * reading.
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
import type { FrameTiming } from '@thoremin/sdk/nodes/domain';
import { createStampDejitter } from '@thoremin/sdk/timing/stamp_dejitter';

/** The subset of `VideoFrameCallbackMetadata` this module reads. */
export interface VideoFrameMetadataLike {
  /** For a local camera: when the frame was captured, `performance.now()` base. */
  captureTime?: number;
  /** When the frame was submitted for compositing, `performance.now()` base. */
  presentationTime?: number;
  /** The frame's presentation time in the media timeline (seconds; what
   *  `video.currentTime` reads while this frame is current). Always 0 in WebKit's
   *  MediaStream player. */
  mediaTime?: number;
  /** Frames presented so far: a rise is a new frame, whatever the clocks say. */
  presentedFrames?: number;
}

/** The element surface this module needs; declared here rather than relying on the
 *  DOM lib's version of `requestVideoFrameCallback`. */
export interface VideoFrameCallbackTarget {
  requestVideoFrameCallback?(cb: (now: number, metadata: VideoFrameMetadataLike) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
}

export type StampSource = NonNullable<FrameTiming['tSource']>;

/** The timestamp decision alone (what {@link pickFrameStamp} returns). */
export interface PickedStamp {
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

export interface FrameStamp extends PickedStamp {
  /** Camera frames presented since the previously delivered one that were not
   *  delivered (inference was busy); 0 when none or when the browser cannot say. */
  skipped: number;
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
/** The recent-lag estimate clamps any single lag to this (ms): a stalled frame must
 *  not drag every estimated stamp early. */
export const MAX_LAG_EW_MS = 200;
/** Gain of the exponentially weighted recent lag. */
export const LAG_EW_GAIN = 0.2;
/** The callback has gone silent when none has fired for this many of its own periods
 *  (and at least {@link MIN_VFC_SILENCE_MS}): the animation-frame path takes over. */
export const VFC_SILENCE_PERIODS = 2;
/** A floor on the silence, ms: one inference on the CPU delegate (about 42 ms) or a
 *  garbage-collection pause must not hand delivery to the animation loop, which on
 *  WebKit would mean duplicates. */
export const MIN_VFC_SILENCE_MS = 100;
/** The callback period assumed before one is measured, ms (a 30 fps camera). */
export const DEFAULT_FRAME_PERIOD_MS = 1000 / 30;
/** Gain of the exponentially weighted callback period. */
export const VFC_PERIOD_EW_GAIN = 0.2;
/** Callbacks in a row reporting the SAME `presentedFrames` after which the counter is
 *  taken to be frozen and the animation loop delivers: three is about the silence floor
 *  at a 30 fps callback, so a single stuck callback (a frame signalled twice) costs
 *  nothing and a stuck counter costs at most three frames. */
export const MAX_VFC_CALLBACKS_WITHOUT_RISE = 3;
/** The animation-frame path delivers no closer than this fraction of the learned camera
 *  period. A full period would wait out any animation frame that lands a hair early
 *  (floating point, vsync jitter) and so halve the rate; three quarters lets the first
 *  animation frame at or past the period through and none nearer. */
export const RAF_SPACING_FRACTION = 0.75;
/** How long (ms) a registered callback may stay silent before the animation loop stops
 *  assuming the default camera period and delivers every change of `currentTime`: the
 *  silence floor, the same patience the callback gets as a driver. */
export const DEFAULT_SPACING_LAPSE_MS = MIN_VFC_SILENCE_MS;

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
export function pickFrameStamp(nowMs: number, meta: VideoFrameMetadataLike | undefined, lastMs: number, estimatedLagMs = NaN): PickedStamp {
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
  return { t: stamp.tMs / 1000, tSource: stamp.source, tOrigin: originMs, lag: stamp.lagMs / 1000, skipped: stamp.skipped };
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

/** How long (ms) the callback may stay silent before the animation loop takes over,
 *  given its measured period (NaN before one is measured). */
export function vfcSilenceMs(periodMs: number): number {
  const period = Number.isFinite(periodMs) && periodMs > 0 ? periodMs : DEFAULT_FRAME_PERIOD_MS;
  return Math.max(MIN_VFC_SILENCE_MS, VFC_SILENCE_PERIODS * period);
}

export interface FramePumpOptions {
  /** Register the video frame callback when the element has it (default true). */
  useVideoFrameCallback?: boolean;
  /** Smooth runs of clock-derived stamps with the gated de-jitter (default true). A
   *  capture stamp is never smoothed either way. */
  dejitter?: boolean;
  /** Injectable for tests. */
  now?: () => number;
  requestAnimationFrame?: (cb: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

/** Which path is delivering frames right now. */
export type FramePumpDriver = 'vfc' | 'raf';

export interface FramePump {
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** Whether the video frame callback is registered on the element. */
  readonly metadataChannel: boolean;
  /** `vfc` while the callback reports `presentedFrames` and is not silent; `raf` otherwise. */
  readonly driver: FramePumpDriver;
}

/**
 * Pump frames from `getVideo()` into `onFrame`. The element is read through a getter
 * because two of the sources re-read it from the engine resources every tick. A frame
 * is delivered once per presented camera frame on a ready element (`readyState >= 2`,
 * a non-zero width): once per rise of `presentedFrames` where the video frame callback
 * reports it, once per change of `currentTime` where it does not. `onFrame` may return
 * `false` to say it did not consume the frame (no model loaded yet), in which case the
 * same frame is offered again on the next animation frame.
 */
export function createFramePump(
  getVideo: () => HTMLVideoElement | undefined,
  onFrame: (stamp: FrameStamp, video: HTMLVideoElement) => boolean | void,
  options: FramePumpOptions = {},
): FramePump {
  const useVfc = options.useVideoFrameCallback ?? true;
  const dejitter = (options.dejitter ?? true) ? createStampDejitter({ minStepMs: MIN_STAMP_STEP_MS }) : null;
  const now = options.now ?? (() => performance.now());
  const raf = options.requestAnimationFrame ?? ((cb) => requestAnimationFrame(cb));
  const caf = options.cancelAnimationFrame ?? ((h) => cancelAnimationFrame(h));

  let running = false;
  let rafId: number | null = null;
  let vfcId: number | null = null;
  let vfcVideo: (HTMLVideoElement & VideoFrameCallbackTarget) | null = null;
  /** The most recent presented frame's metadata (the side channel of the rAF path). */
  let latestMeta: VideoFrameMetadataLike | null = null;
  let lastVideoTime = -1;
  let lastMs = -Infinity;
  /** When the last frame was delivered (clock ms), for a callback that comes late. */
  let lastDeliveryMs = NaN;
  /** Exponentially weighted capture-to-delivery lag (ms); NaN until learned. */
  let lagEw = NaN;
  /** The clock at the last callback that carried `presentedFrames`; NaN until one. */
  let lastVfcMs = NaN;
  /** Exponentially weighted interval between such callbacks (ms). */
  let vfcPeriodEw = NaN;
  /** The `presentedFrames` of the last frame the callback path delivered or saw. */
  let lastPresented = NaN;
  /** Callbacks in a row that reported `lastPresented` again (a frozen counter). */
  let callbacksWithoutRise = 0;
  /** The clock at the callback's registration on this source, then at each callback: how
   *  recently it showed any sign of being wired at all (a frozen counter included). */
  let vfcAliveMs = NaN;
  /** Whether the last callback carried `presentedFrames`; null before any callback. */
  let vfcCounted: boolean | null = null;
  /** A callback-path frame the consumer refused, offered again on the next animation frame. */
  let pending: { meta: VideoFrameMetadataLike; skipped: number } | null = null;

  const ready = (v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0;
  const learnLag = (lagMs: number) => {
    const lag = Math.min(MAX_LAG_EW_MS, Math.max(0, lagMs));
    lagEw = Number.isFinite(lagEw) ? lagEw + LAG_EW_GAIN * (lag - lagEw) : lag;
  };
  const vfcDriving = (nowMs: number) => Number.isFinite(lastVfcMs) && nowMs - lastVfcMs <= vfcSilenceMs(vfcPeriodEw);
  /** How close two animation-frame deliveries may be (ms): a fraction of the camera
   *  period the callbacks taught; of the default period while a registered callback that
   *  carries a counter (or has not fired yet) has taught none and was heard from within
   *  the lapse; none at all where the callback is absent, reports no counter, or has gone
   *  quiet past the lapse (the pre-#226 path: every change of `currentTime` is a frame). */
  const rafSpacingMs = (nowMs: number) => {
    if (Number.isFinite(vfcPeriodEw)) return RAF_SPACING_FRACTION * vfcPeriodEw;
    const wired = vfcId !== null && vfcCounted !== false && nowMs - vfcAliveMs <= DEFAULT_SPACING_LAPSE_MS;
    return wired ? RAF_SPACING_FRACTION * DEFAULT_FRAME_PERIOD_MS : 0;
  };
  const rafMayDeliver = (nowMs: number) => !Number.isFinite(lastDeliveryMs) || nowMs - lastDeliveryMs >= rafSpacingMs(nowMs);

  /** Hand a frame to inference; false when the consumer refused it. */
  const deliver = (v: HTMLVideoElement, meta: VideoFrameMetadataLike | undefined, skipped: number): boolean => {
    const nowMs = now();
    // The learned lag describes the pipeline, not the channel: once known it is used
    // even after the callbacks go quiet (a hidden tab), so a return does not start
    // again from a clock stamp.
    const picked = pickFrameStamp(nowMs, meta, lastMs, lagEw);
    // The de-jitter is the second producer. It is fitted on the CLOCK READINGS of a run
    // of clock-derived stamps (the learned lag, which the picker subtracted, is put back
    // afterwards: a lag still converging would otherwise read as a bent line), and hands
    // back the reading moved onto the camera's grid, or the reading itself, byte for
    // byte. A capture or presentation stamp is never touched; it ends the run.
    let tMs = picked.tMs;
    if (dejitter) {
      const clockDerived = picked.source === 'clock' || picked.source === 'estimated';
      const smoothed = dejitter.push(clockDerived ? nowMs : picked.tMs, picked.source);
      if (smoothed.engaged) tMs = Math.max(smoothed.tMs - (nowMs - picked.tMs), lastMs + MIN_STAMP_STEP_MS);
    }
    const stamp: FrameStamp = { tMs, source: picked.source, lagMs: nowMs - tMs, skipped };
    if (onFrame(stamp, v) === false) {
      // Offered again later with a later clock reading: that is the same frame, not
      // the next one on the grid.
      dejitter?.retract();
      return false;
    }
    lastMs = stamp.tMs;
    lastVideoTime = v.currentTime;
    lastDeliveryMs = nowMs;
    if (stamp.source === 'capture') learnLag(stamp.lagMs);
    return true;
  };

  /** A callback for a frame the animation loop already delivered: learn the lag from it. */
  const learnFromLate = (meta: VideoFrameMetadataLike) => {
    if (metadataMatches(meta, lastVideoTime) && Number.isFinite(lastDeliveryMs) && typeof meta.captureTime === 'number') {
      const lag = lastDeliveryMs - meta.captureTime;
      if (lag >= -MAX_FUTURE_MS && lag <= MAX_PLAUSIBLE_LAG_MS) learnLag(lag);
    }
  };

  const unregisterVfc = () => {
    if (vfcId !== null && vfcVideo && typeof vfcVideo.cancelVideoFrameCallback === 'function') vfcVideo.cancelVideoFrameCallback(vfcId);
    vfcId = null;
    vfcVideo = null;
  };

  /** Forget everything that belongs to one source: the counter, the callback's liveness
   *  and period, the last frame seen and the spacing since it. The learned lag is kept
   *  (it describes the pipeline), and so is `lastMs` (stamps must keep increasing). */
  const forgetSource = () => {
    latestMeta = null;
    lastVideoTime = -1;
    lastDeliveryMs = NaN;
    lastVfcMs = NaN;
    vfcPeriodEw = NaN;
    lastPresented = NaN;
    callbacksWithoutRise = 0;
    vfcAliveMs = NaN;
    vfcCounted = null;
    pending = null;
    dejitter?.reset();
  };

  /** The callback: the driver where it reports `presentedFrames`, a side channel elsewhere. */
  const onVideoFrame = (v: HTMLVideoElement & VideoFrameCallbackTarget, meta: VideoFrameMetadataLike) => {
    latestMeta = meta;
    vfcAliveMs = now();
    const presented = typeof meta.presentedFrames === 'number' && Number.isFinite(meta.presentedFrames) ? meta.presentedFrames : NaN;
    vfcCounted = Number.isFinite(presented);
    if (!vfcCounted) {
      learnFromLate(meta);
      return;
    }
    const nowMs = vfcAliveMs;
    const rise = Number.isFinite(lastPresented) ? presented - lastPresented : 1;
    if (rise === 0) {
      // A frozen counter: the callback fired and counted nothing. It is not a sign of
      // life (the liveness clock and the period are left alone, so the silence rule
      // engages by itself), and after enough of them in a row delivery is handed to the
      // animation loop outright.
      if (++callbacksWithoutRise >= MAX_VFC_CALLBACKS_WITHOUT_RISE) lastVfcMs = NaN;
      return;
    }
    callbacksWithoutRise = 0;
    // Backwards is a reset (a new source on this element): the frame is new, whatever
    // the clocks say, and nothing was skipped.
    const reset = rise < 0;
    // The first callback, or the first after a silence: the animation loop may have
    // delivered this very frame already (its mediaTime then matches), and the frames
    // presented meanwhile were its to deliver, not skipped.
    const resumed = !vfcDriving(nowMs);
    if (!resumed && !reset) vfcPeriodEw = Number.isFinite(vfcPeriodEw) ? vfcPeriodEw + VFC_PERIOD_EW_GAIN * (nowMs - lastVfcMs - vfcPeriodEw) : nowMs - lastVfcMs;
    lastVfcMs = nowMs;
    if (resumed && !reset && metadataMatches(meta, lastVideoTime)) {
      learnFromLate(meta);
      lastPresented = presented;
      return;
    }
    const skipped = resumed || reset ? 0 : rise - 1;
    lastPresented = presented;
    pending = null;
    if (!ready(v) || !deliver(v, meta, skipped)) pending = { meta, skipped };
  };

  /** Keep the callback registered on the element the pump is looking at. */
  const ensureVfc = (v: HTMLVideoElement & VideoFrameCallbackTarget) => {
    if (!useVfc || typeof v.requestVideoFrameCallback !== 'function') return;
    if (vfcVideo !== v) {
      // A replaced element is a new source: its counter, its clock and its first frame
      // start over (the stamps stay monotonic: `lastMs` is kept).
      unregisterVfc();
      forgetSource();
    }
    if (vfcId !== null) return;
    vfcVideo = v;
    if (!Number.isFinite(vfcAliveMs)) vfcAliveMs = now();
    vfcId = v.requestVideoFrameCallback((_cbNow, meta) => {
      vfcId = null;
      if (!running || vfcVideo !== v) return;
      onVideoFrame(v, meta);
      ensureVfc(v);
    });
  };

  const tick = () => {
    rafId = null;
    if (!running) return;
    const v = getVideo() as (HTMLVideoElement & VideoFrameCallbackTarget) | undefined;
    if (v) {
      ensureVfc(v);
      if (ready(v)) {
        if (pending) {
          if (deliver(v, pending.meta, pending.skipped)) pending = null;
        } else if (!vfcDriving(now()) && v.currentTime !== lastVideoTime && rafMayDeliver(now())) {
          deliver(v, metadataMatches(latestMeta, v.currentTime) ? latestMeta! : undefined, 0);
        }
      }
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
    get driver() {
      return vfcDriving(now()) ? 'vfc' : 'raf';
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
      forgetSource();
    },
  };
}
