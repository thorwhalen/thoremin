/**
 * The frame pump (#226): where the video frame callback reports `presentedFrames` it
 * DRIVES delivery (one frame per rise of the counter, stamped from its own metadata:
 * step 0 of the timing plan, the WebKit-shaped cases below); elsewhere the
 * animation-frame loop delivers every new frame at once (never held, never dropped)
 * and stamps it from the callback's metadata when that already describes the frame,
 * else from the clock minus the recent lag the callbacks taught it (even late ones),
 * else from the clock. A browser that never fires the callback for the hidden `<video>`
 * degrades to the pre-#226 behaviour rather than to silence. All paths are exercised
 * here with fake schedulers; the live webcam behaviour is on #146's list.
 */
import { describe, it, expect } from 'vitest';
import {
  createFramePump,
  metadataMatches,
  pickFrameStamp,
  stampToTiming,
  MAX_FUTURE_MS,
  MAX_PLAUSIBLE_LAG_MS,
  MIN_STAMP_STEP_MS,
  MIN_VFC_SILENCE_MS,
  MAX_VFC_CALLBACKS_WITHOUT_RISE,
  DEFAULT_SPACING_LAPSE_MS,
  vfcSilenceMs,
  type FrameStamp,
  type VideoFrameMetadataLike,
} from '@/nodes/sources/frame_pump';
import { frameTime } from '@/nodes';

describe('pickFrameStamp', () => {
  it('prefers the capture time and reports the lag to inference', () => {
    expect(pickFrameStamp(1050, { captureTime: 1000, presentationTime: 1030 }, -Infinity)).toEqual({ tMs: 1000, source: 'capture', lagMs: 50 });
  });

  it('falls back to the presentation time, then to the estimated lag, then to the clock', () => {
    expect(pickFrameStamp(1050, { presentationTime: 1030 }, -Infinity)).toEqual({ tMs: 1030, source: 'presentation', lagMs: 20 });
    expect(pickFrameStamp(1050, {}, -Infinity, 40)).toEqual({ tMs: 1010, source: 'estimated', lagMs: 40 });
    expect(pickFrameStamp(1050, undefined, -Infinity)).toEqual({ tMs: 1050, source: 'clock', lagMs: 0 });
    expect(pickFrameStamp(1050, undefined, -Infinity, NaN)).toEqual({ tMs: 1050, source: 'clock', lagMs: 0 });
  });

  it('does not trust a capture time that is too old, in the future, or not a number', () => {
    expect(pickFrameStamp(1050, { captureTime: 1050 - MAX_PLAUSIBLE_LAG_MS - 1, presentationTime: 1040 }, -Infinity).source).toBe('presentation');
    expect(pickFrameStamp(1050, { captureTime: 1050 + MAX_FUTURE_MS + 1 }, -Infinity).source).toBe('clock');
    expect(pickFrameStamp(1050, { captureTime: 1050 + MAX_FUTURE_MS - 1 }, -Infinity).source).toBe('capture');
    expect(pickFrameStamp(1050, { captureTime: NaN }, -Infinity).source).toBe('clock');
  });

  it('is strictly increasing by at least a millisecond, and says so when it had to invent the step', () => {
    const a = pickFrameStamp(1050, { captureTime: 1000 }, -Infinity);
    const b = pickFrameStamp(1083, { captureTime: 1000 }, a.tMs);
    expect(b).toEqual({ tMs: 1000 + MIN_STAMP_STEP_MS, source: 'estimated', lagMs: 83 - MIN_STAMP_STEP_MS });
    const c = pickFrameStamp(1116, { captureTime: 1033.3 }, b.tMs);
    expect(c.source).toBe('capture');
    expect(c.tMs).toBeCloseTo(1033.3, 6);
    // A clock stamp that is pushed forward stays a clock stamp.
    expect(pickFrameStamp(1000, undefined, 1000).source).toBe('clock');
  });

  it('converts to the seconds the frame carries, with the source and the time origin', () => {
    expect(stampToTiming({ tMs: 2500, source: 'capture', lagMs: 40, skipped: 1 }, 1700000000000)).toEqual({ t: 2.5, tSource: 'capture', tOrigin: 1700000000000, lag: 0.04, skipped: 1 });
  });

  it('metadata describes the current frame only when mediaTime matches currentTime', () => {
    expect(metadataMatches({ mediaTime: 1.2 }, 1.2)).toBe(true);
    expect(metadataMatches({ mediaTime: 1.2 }, 1.2333)).toBe(false);
    expect(metadataMatches({}, 1.2)).toBe(false);
    expect(metadataMatches(null, 1.2)).toBe(false);
  });
});

describe('frameTime', () => {
  const rt = (time: number) => ({ time, resources: { timeScale: 1 } });
  const origin = performance.timeOrigin;
  it('uses the stamp only in real time at speed 1, from this document, and only when it is a real stamp', () => {
    expect(frameTime({ t: 10.02, tSource: 'capture', tOrigin: origin }, rt(10.05))).toBe(10.02);
    expect(frameTime({ t: 10.02, tSource: 'estimated', tOrigin: origin }, rt(10.05))).toBe(10.02);
    expect(frameTime({ t: 10.02, tSource: 'clock', tOrigin: origin }, rt(10.05))).toBe(10.02);
    expect(frameTime({ t: 10.02, tOrigin: origin }, rt(10.05))).toBe(10.05); // no source: not a stamp
    expect(frameTime({ t: 10.02, tSource: 'capture' }, rt(10.05))).toBe(10.05); // no origin: not this document
    expect(frameTime({ t: 10.02, tSource: 'capture', tOrigin: origin - 60000 }, rt(10.05))).toBe(10.05); // a recording
    expect(frameTime({ t: 10.02, tSource: 'capture', tOrigin: origin }, { time: 10.05, resources: {} })).toBe(10.05); // batch clock
    expect(frameTime({ t: 10.02, tSource: 'capture', tOrigin: origin }, { time: 10.05, resources: { timeScale: 0.5 } })).toBe(10.05);
    expect(frameTime({}, rt(10.05))).toBe(10.05);
    expect(frameTime(undefined, rt(10.05))).toBe(10.05);
  });
});

/** A fake <video>: enough surface for the pump. */
interface FakeVideo {
  readyState: number;
  videoWidth: number;
  currentTime: number;
  requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMetadataLike) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
}

/** A fake animation-frame scheduler: `tick()` runs the pending callback. */
function scheduler() {
  let pending: (() => void) | null = null;
  return {
    raf: (cb: () => void) => {
      pending = cb;
      return 1;
    },
    caf: () => {
      pending = null;
    },
    tick() {
      const cb = pending;
      pending = null;
      cb?.();
    },
    get armed() {
      return pending !== null;
    },
  };
}

/** A fake element with a video frame callback the test fires by hand. Like the real
 *  one, a registered callback fires ONCE: `fire` forgets it before calling it, so a pump
 *  that forgets to re-register is caught (the next `fire` throws). */
function vfcVideo() {
  let cb: ((now: number, meta: VideoFrameMetadataLike) => void) | null = null;
  const cancelled: number[] = [];
  let handle = 0;
  const video: FakeVideo = {
    readyState: 4,
    videoWidth: 640,
    currentTime: 0,
    requestVideoFrameCallback: (f) => {
      cb = f;
      return ++handle;
    },
    cancelVideoFrameCallback: (h) => void cancelled.push(h),
  };
  return {
    video,
    fire: (now: number, meta: VideoFrameMetadataLike) => {
      const f = cb;
      cb = null;
      if (!f) throw new Error('no video frame callback registered');
      f(now, meta);
    },
    cancelled,
    get handle() {
      return handle;
    },
  };
}

describe('createFramePump', () => {
  it('stamps from the metadata that matches the frame (callback before the animation frame)', () => {
    const v = vfcVideo();
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => v.video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    v.video.readyState = 0; // the stream is not attached yet: the first tick only registers
    s.tick();
    expect(pump.metadataChannel).toBe(true);
    expect(got.length).toBe(0);

    // Frame 1 (mediaTime 0, captured at 960) is presented; its callback fires, then
    // the animation frame delivers it from capture.
    v.video.readyState = 4;
    v.fire(990, { mediaTime: 0, captureTime: 960, presentationTime: 985 });
    clock = 1000;
    s.tick();
    expect(got.length).toBe(1);
    expect(got[0]).toEqual({ tMs: 960, source: 'capture', lagMs: 40, skipped: 0 });
    expect(v.handle).toBe(2); // the callback re-registered itself

    // Frame 2 likewise, 33.3 ms later.
    v.video.currentTime = 0.0333;
    v.fire(1025, { mediaTime: 0.0333, captureTime: 993.3, presentationTime: 1020 });
    clock = 1040;
    s.tick();
    expect(got[1].source).toBe('capture');
    expect(got[1].tMs).toBeCloseTo(993.3, 6);
    expect(got[1].lagMs).toBeCloseTo(46.7, 6);

    // Frame 3: its metadata has not arrived. Stamped at the clock minus the recent
    // lag (an exponentially weighted mean: 40, then 46.7 at a gain of 0.2), at once.
    v.video.currentTime = 0.0667;
    clock = 1073;
    s.tick();
    expect(got[2].source).toBe('estimated');
    expect(got[2].tMs).toBeCloseTo(1073 - (40 + 0.2 * 6.7), 6);

    // Same frame on the next animation frame: no delivery.
    clock = 1089;
    s.tick();
    expect(got.length).toBe(3);

    pump.stop();
    expect(v.cancelled).toEqual([v.handle]);
    expect(pump.metadataChannel).toBe(false);
    expect(s.armed).toBe(false);
    // A late callback after stop changes nothing.
    v.fire(1100, { mediaTime: 0.1, captureTime: 1090 });
    expect(got.length).toBe(3);
  });

  it('learns the lag from callbacks that fire late, so every frame is estimated rather than clock-stamped', () => {
    // Every callback arrives one animation frame after its frame was delivered: no
    // frame ever matches at delivery, but the lag they report (capture to delivery)
    // stamps the following frames to within the lag's jitter.
    const v = vfcVideo();
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => v.video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    const period = 1000 / 30;
    for (let i = 0; i < 30; i++) {
      v.video.currentTime = i / 30;
      clock = 1000 + i * period;
      s.tick(); // delivers frame i at once
      expect(got.length).toBe(i + 1);
      // The callback for frame i comes one animation frame later, saying it was
      // captured 42 ms before its delivery.
      clock += period / 2;
      v.fire(clock, { mediaTime: i / 30, captureTime: 1000 + i * period - 42 });
    }
    expect(got[0].source).toBe('clock');
    expect(got.slice(1).every((g) => g.source === 'estimated')).toBe(true);
    // Frame 1 is the transition: its estimate lands behind the clock-stamped frame 0
    // and is pushed forward to stay increasing. From frame 2 on, the estimated stamps
    // sit where the capture times were.
    expect(got[1].tMs).toBe(got[0].tMs + MIN_STAMP_STEP_MS);
    for (let i = 2; i < 30; i++) expect(got[i].tMs).toBeCloseTo(1000 + i * period - 42, 3);
    expect(got[5].lagMs).toBeCloseTo(42, 6);
    pump.stop();
  });

  it('a camera at the animation rate with late callbacks still delivers every frame', () => {
    const v = vfcVideo();
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => v.video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    const period = 1000 / 60;
    for (let i = 0; i < 120; i++) {
      v.video.currentTime = i / 60;
      clock = 1000 + i * period;
      s.tick();
      v.fire(clock + 1, { mediaTime: (i - 1) / 60, captureTime: clock - period - 40 }); // for the PREVIOUS frame
    }
    expect(got.length).toBe(120);
    pump.stop();
  });

  it('works without the video frame callback at all (the pre-#226 path)', () => {
    const video: FakeVideo = { readyState: 4, videoWidth: 640, currentTime: 0 };
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    expect(pump.metadataChannel).toBe(false);
    s.tick();
    clock = 1016;
    s.tick();
    expect(got.length).toBe(1);
    video.currentTime = 0.0333;
    clock = 1033;
    s.tick();
    expect(got.length).toBe(2);
    expect(got[1]).toEqual({ tMs: 1033, source: 'clock', lagMs: 0, skipped: 0 });
    pump.stop();
  });

  it('a callback that never fires (hidden element) costs nothing: frames flow from the clock', () => {
    const video: FakeVideo = {
      readyState: 4,
      videoWidth: 640,
      currentTime: 0,
      requestVideoFrameCallback: () => 1, // registered, never called
      cancelVideoFrameCallback: () => {},
    };
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    for (let i = 0; i < 5; i++) {
      video.currentTime = i / 30;
      clock = 1000 + (i * 1000) / 30;
      s.tick();
    }
    expect(got.length).toBe(5);
    expect(got.every((g) => g.source === 'clock')).toBe(true);
    pump.stop();
  });

  it('a channel that fires but never matches costs nothing and teaches nothing: clock stamps', () => {
    const v = vfcVideo();
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => v.video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    v.video.readyState = 0;
    s.tick();
    v.video.readyState = 4;
    for (let i = 0; i < 5; i++) {
      v.video.currentTime = i / 30;
      clock = 1000 + (i * 1000) / 30;
      v.fire(clock, { mediaTime: i / 30 + 0.01, captureTime: clock - 30 }); // mediaTime never matches
      s.tick();
      expect(got.length).toBe(i + 1);
    }
    expect(got.every((g) => g.source === 'clock')).toBe(true);
    pump.stop();
  });

  it('a channel that goes quiet (a hidden tab) keeps estimating from the lag it learned', () => {
    const v = vfcVideo();
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => v.video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    v.video.readyState = 0;
    s.tick();
    v.video.readyState = 4;
    v.fire(1000, { mediaTime: 0, captureTime: 970 });
    s.tick();
    expect(got.length).toBe(1);
    expect(got[0].source).toBe('capture');
    clock = 1000 + 2000;
    v.video.currentTime = 0.5;
    s.tick();
    expect(got.length).toBe(2);
    expect(got[1].source).toBe('estimated');
    expect(got[1].tMs).toBe(clock - 30);
    pump.stop();
  });

  it('offers a frame again when the consumer did not take it (no model yet)', () => {
    const video: FakeVideo = { readyState: 4, videoWidth: 640, currentTime: 0.1 };
    const s = scheduler();
    let ready = false;
    let delivered = 0;
    const pump = createFramePump(
      () => video as unknown as HTMLVideoElement,
      () => {
        if (!ready) return false;
        delivered++;
      },
      { now: () => 1000, requestAnimationFrame: s.raf, cancelAnimationFrame: s.caf },
    );
    pump.start();
    s.tick();
    s.tick();
    expect(delivered).toBe(0);
    ready = true;
    s.tick();
    expect(delivered).toBe(1);
    s.tick();
    expect(delivered).toBe(1); // same currentTime: not a new frame
    pump.stop();
  });

  it('waits for a not-yet-ready element, and re-registers the side channel on a replaced element', () => {
    const cancelled: string[] = [];
    const mk = (name: string): FakeVideo => ({
      readyState: 0,
      videoWidth: 0,
      currentTime: 0,
      requestVideoFrameCallback: () => 1,
      cancelVideoFrameCallback: () => void cancelled.push(name),
    });
    let video = mk('a');
    const s = scheduler();
    let delivered = 0;
    const pump = createFramePump(() => video as unknown as HTMLVideoElement, () => void delivered++, {
      now: () => 1000,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    s.tick();
    expect(delivered).toBe(0);
    video.readyState = 4;
    video.videoWidth = 640;
    s.tick();
    expect(delivered).toBe(1);
    video = mk('b');
    video.readyState = 4;
    video.videoWidth = 640;
    video.currentTime = 0.5;
    s.tick();
    expect(cancelled).toEqual(['a']);
    expect(pump.metadataChannel).toBe(true);
    expect(delivered).toBe(2);
    pump.stop();
    expect(cancelled).toEqual(['a', 'b']);
  });
});

/**
 * WebKit's MediaStream player, as measured in Playwright's WebKit (the Safari red-team
 * of the timing plan): `currentTime` is a wall clock that changes on EVERY animation
 * frame, `mediaTime` is always 0, `captureTime` and `presentationTime` are integer
 * milliseconds, and `presentedFrames` rises by one per camera frame. The old pump
 * delivered every camera frame twice (182 for 91) and matched nothing (all `clock`).
 */
describe('createFramePump on WebKit-shaped metadata', () => {
  const RAF_MS = 1000 / 60;
  const CAM_MS = 1000 / 30;

  function webkitRun(opts: { frames: number; callbackEvery?: number; skipCallbacksFrom?: number; freezeCounterFrom?: number }) {
    const v = vfcVideo();
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => v.video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    v.video.readyState = 0; // the stream is not attached yet: the first tick only registers
    s.tick();
    v.video.readyState = 4;
    let presented = 0;
    for (let i = 0; i < opts.frames * 2; i++) {
      clock = 1000 + i * RAF_MS;
      v.video.currentTime = 0.5 + (clock - 1000) / 1000; // the wall clock since the stream started, not the frame
      if (i % 2 === 0) {
        presented++;
        const every = opts.callbackEvery ?? 1;
        const silent = opts.skipCallbacksFrom !== undefined && presented >= opts.skipCallbacksFrom;
        // A frozen counter: the callbacks keep firing per camera frame but count nothing.
        const counted = opts.freezeCounterFrom !== undefined ? Math.min(presented, opts.freezeCounterFrom - 1) : presented;
        if (presented % every === 0 && !silent) v.fire(clock, { mediaTime: 0, captureTime: Math.round(clock - 12), presentationTime: Math.round(clock - 2), presentedFrames: counted });
      }
      s.tick();
    }
    return { got, pump, v, s, setClock: (ms: number) => void (clock = ms), presented: () => presented };
  }

  it('delivers one frame per camera frame, not per animation frame, stamped from the capture time', () => {
    const { got, pump } = webkitRun({ frames: 60 });
    expect(got).toHaveLength(60);
    expect(got.every((g) => g.source === 'capture')).toBe(true);
    // WebKit rounds the capture time to the millisecond: the lag reads 12 +- 0.5.
    expect(got.every((g) => Math.abs(g.lagMs - 12) <= 0.5)).toBe(true);
    expect(got.every((g) => g.skipped === 0)).toBe(true);
    // Consecutive stamps are one camera period apart (to the rounding), never the animation period.
    for (let i = 1; i < got.length; i++) expect(Math.abs(got[i].tMs - got[i - 1].tMs - CAM_MS)).toBeLessThan(1);
    expect(pump.driver).toBe('vfc');
    pump.stop();
  });

  it('a rise of more than one says how many camera frames inference was too busy for', () => {
    // The callback fires for every other camera frame (inference blocked the thread).
    // Until its first callback the animation loop delivers from the clock: ONE frame,
    // not one per animation frame, although this element's `currentTime` moves on every
    // one of them (the registered-but-silent callback spaces the loop at the default period).
    const { got, pump } = webkitRun({ frames: 40, callbackEvery: 2 });
    const captured = got.filter((g) => g.source === 'capture');
    expect(got.length - captured.length).toBe(1);
    expect(captured).toHaveLength(20);
    expect(captured[0].skipped).toBe(0);
    expect(captured.slice(1).every((g) => g.skipped === 1)).toBe(true);
    pump.stop();
  });

  it('falls back to the animation loop when the callback goes silent, and hands back when it returns', () => {
    const { got, pump, v, s, setClock } = webkitRun({ frames: 30, skipCallbacksFrom: 16 });
    // 15 frames from the callback; then silence for 15 camera frames (500 ms): after the
    // silence threshold the animation loop takes over on this wall-clock element, with
    // estimated stamps from the learned lag.
    const fromCallback = got.filter((g) => g.source === 'capture');
    expect(fromCallback).toHaveLength(15);
    const fallback = got.filter((g) => g.source === 'estimated');
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback.every((g) => Math.abs(g.lagMs - 12) <= 0.5)).toBe(true);
    // One delivery per CAMERA frame on this wall-clock element, not per animation frame:
    // the loop ran 25 animation frames after the silence threshold and delivered on
    // every other one (it used to deliver 15 frames for about 10 camera frames).
    expect(fallback.length).toBeGreaterThanOrEqual(12);
    expect(fallback.length).toBeLessThanOrEqual(13);
    for (let i = 1; i < fallback.length; i++) expect(fallback[i].tMs - fallback[i - 1].tMs).toBeGreaterThanOrEqual(0.75 * CAM_MS - 0.01);
    expect(pump.driver).toBe('raf');
    // The silence is at least the floor, and about two periods of a 30 fps callback.
    expect(vfcSilenceMs(NaN)).toBe(MIN_VFC_SILENCE_MS);
    expect(vfcSilenceMs(CAM_MS)).toBe(MIN_VFC_SILENCE_MS);
    expect(vfcSilenceMs(80)).toBe(160);
    // The callback returns: the first one after a silence is not charged with skipped
    // frames (the loop delivered them), and from then on it drives again.
    const before = got.length;
    const clock = 1000 + 60 * RAF_MS + 10;
    setClock(clock);
    v.fire(clock, { mediaTime: 0, captureTime: clock - 12, presentationTime: clock - 2, presentedFrames: 31 });
    expect(got).toHaveLength(before + 1);
    expect(got[got.length - 1].skipped).toBe(0);
    expect(got[got.length - 1].source).toBe('capture');
    setClock(clock + RAF_MS);
    v.video.currentTime += RAF_MS / 1000; // the wall clock moved on
    s.tick();
    expect(got).toHaveLength(before + 1); // the loop no longer delivers on the wall clock
    expect(pump.driver).toBe('vfc');
    pump.stop();
  });

  it('a frozen counter (callbacks that count nothing) hands delivery to the animation loop, and a rise takes it back', () => {
    // From camera frame 16 the callback keeps firing once per camera frame with
    // `presentedFrames` stuck at 15. The pump used to read every callback as a sign of
    // life and deliver one frame in sixty; now a callback without a rise is not life.
    const { got, pump, v, s, setClock } = webkitRun({ frames: 40, freezeCounterFrom: 16 });
    const fromCallback = got.filter((g) => g.source === 'capture');
    expect(fromCallback).toHaveLength(15);
    expect(pump.driver).toBe('raf');
    const fallback = got.filter((g) => g.source === 'estimated');
    // 25 frozen camera frames; the hand-over costs MAX_VFC_CALLBACKS_WITHOUT_RISE of them
    // and the loop then delivers once per camera frame, give or take one.
    expect(fallback.length).toBeGreaterThanOrEqual(25 - MAX_VFC_CALLBACKS_WITHOUT_RISE - 1);
    expect(fallback.length).toBeLessThanOrEqual(25 - MAX_VFC_CALLBACKS_WITHOUT_RISE + 1);
    // The counter counts again: that frame is delivered from the callback, nothing
    // skipped, and the callback drives from then on.
    const before = got.length;
    const clock = 1000 + 80 * RAF_MS + 10;
    setClock(clock);
    v.fire(clock, { mediaTime: 0, captureTime: clock - 12, presentationTime: clock - 2, presentedFrames: 16 });
    expect(got).toHaveLength(before + 1);
    expect(got[got.length - 1]).toMatchObject({ source: 'capture', skipped: 0 });
    expect(pump.driver).toBe('vfc');
    setClock(clock + RAF_MS);
    v.video.currentTime += RAF_MS / 1000;
    s.tick();
    expect(got).toHaveLength(before + 1);
    pump.stop();
  });

  it('a counter frozen from its first callback still yields at most one delivery per camera frame', () => {
    // `presentedFrames` never rises (0 on every callback). No period is ever learned,
    // so the loop can only assume a camera at the default period: it used to assume
    // nothing once the callback had spoken and delivered on every animation frame (114
    // for 60 camera frames).
    const { got, pump } = webkitRun({ frames: 60, freezeCounterFrom: 1 });
    expect(got.length).toBeLessThanOrEqual(60);
    expect(got.length).toBeGreaterThanOrEqual(60 - MAX_VFC_CALLBACKS_WITHOUT_RISE - 1);
    expect(got.filter((g) => g.source === 'capture')).toHaveLength(1);
    for (let i = 2; i < got.length; i++) expect(got[i].tMs - got[i - 1].tMs).toBeGreaterThanOrEqual(0.75 * CAM_MS - 0.01);
    expect(pump.driver).toBe('raf');
    pump.stop();
  });

  it('a registered callback that never fires stops spacing the loop after the silence floor: a 60 fps camera delivers 60', () => {
    // A hidden video on a browser that never fires the callback for it, with no counter
    // ever seen: the default-period spacing used to hold for ever and capped a 60 fps
    // camera at 30 (59 delivered for 120).
    const video: FakeVideo = { readyState: 4, videoWidth: 640, currentTime: 0, requestVideoFrameCallback: () => 1, cancelVideoFrameCallback: () => {} };
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    for (let i = 0; i < 120; i++) {
      video.currentTime = i / 60;
      clock = 1000 + i * RAF_MS;
      s.tick();
    }
    // Only the frames within the lapse after registration are spaced at the default period.
    expect(got.length).toBeGreaterThanOrEqual(120 - Math.ceil(DEFAULT_SPACING_LAPSE_MS / RAF_MS) / 2 - 1);
    expect(got.length).toBeLessThanOrEqual(120);
    expect(got.every((g) => g.source === 'clock')).toBe(true);
    pump.stop();
  });

  it('a counter that runs backwards is a new source on the element: delivered at once, nothing skipped', () => {
    // A new `srcObject` restarts `presentedFrames` from 1. The pump used to wait until
    // the new count passed the old one (20 frames of silence here).
    const { got, pump, v, setClock } = webkitRun({ frames: 20 });
    expect(got).toHaveLength(20);
    const before = got.length;
    for (let n = 1; n <= 3; n++) {
      const clock = 1000 + (40 + 2 * n) * RAF_MS;
      setClock(clock);
      v.video.currentTime += CAM_MS / 1000;
      v.fire(clock, { mediaTime: 0, captureTime: Math.round(clock - 12), presentationTime: Math.round(clock - 2), presentedFrames: n });
      expect(got).toHaveLength(before + n);
    }
    expect(got[before]).toMatchObject({ source: 'capture', skipped: 0 });
    expect(got[before + 1].skipped).toBe(0);
    expect(got[before + 2].skipped).toBe(0);
    expect(pump.driver).toBe('vfc');
    pump.stop();
  });

  it('a replaced element starts its counter afresh: its first frame is delivered, not compared with the old count', () => {
    const a = vfcVideo();
    const b = vfcVideo();
    let current = a;
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => current.video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    a.video.readyState = 0; // the stream is not attached yet: the first tick only registers
    s.tick();
    a.video.readyState = 4;
    for (let n = 1; n <= 100; n++) {
      clock = 1000 + n * CAM_MS;
      a.fire(clock, { mediaTime: 0, captureTime: clock - 12, presentedFrames: n });
    }
    expect(got).toHaveLength(100);
    current = b;
    b.video.readyState = 0;
    clock += CAM_MS;
    s.tick(); // the pump notices the new element and registers on it
    expect(a.cancelled).toHaveLength(1);
    b.video.readyState = 4;
    clock += CAM_MS;
    b.fire(clock, { mediaTime: 0, captureTime: clock - 12, presentedFrames: 1 });
    expect(got).toHaveLength(101);
    expect(got[100]).toMatchObject({ source: 'capture', skipped: 0 });
    expect(got[100].tMs).toBeGreaterThan(got[99].tMs);
    pump.stop();
  });

  it('a frame refused by the consumer (no model yet) is offered again, once', () => {
    const v = vfcVideo();
    const s = scheduler();
    let clock = 1000;
    let ready = false;
    const got: FrameStamp[] = [];
    const pump = createFramePump(
      () => v.video as unknown as HTMLVideoElement,
      (stamp) => {
        if (!ready) return false;
        got.push(stamp);
      },
      { now: () => clock, requestAnimationFrame: s.raf, cancelAnimationFrame: s.caf },
    );
    pump.start();
    s.tick();
    v.fire(1000, { mediaTime: 0, captureTime: 988, presentedFrames: 1 });
    s.tick();
    expect(got).toHaveLength(0);
    ready = true;
    clock = 1016;
    s.tick();
    expect(got).toHaveLength(1);
    expect(got[0].tMs).toBe(988);
    clock = 1032;
    s.tick();
    expect(got).toHaveLength(1);
    pump.stop();
  });

  it('on Chromium the callback for a frame the loop already delivered teaches the lag; the next one drives', () => {
    // Before the first callback the loop delivers from the clock (currentTime changed);
    // the callback then arrives for that same frame (mediaTime matches): not a second
    // delivery, but a lag lesson. Every later callback delivers its frame itself.
    const v = vfcVideo();
    const s = scheduler();
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => v.video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: s.raf,
      cancelAnimationFrame: s.caf,
    });
    pump.start();
    v.video.currentTime = 0.1;
    s.tick(); // delivered from the clock
    expect(got).toHaveLength(1);
    expect(got[0].source).toBe('clock');
    v.fire(1005, { mediaTime: 0.1, captureTime: 960, presentedFrames: 4 });
    expect(got).toHaveLength(1);
    clock = 1033;
    v.video.currentTime = 0.1333;
    v.fire(clock, { mediaTime: 0.1333, captureTime: 1010, presentedFrames: 5 });
    expect(got).toHaveLength(2);
    expect(got[1]).toEqual({ tMs: 1010, source: 'capture', lagMs: 23, skipped: 0 });
    s.tick();
    expect(got).toHaveLength(2);
    pump.stop();
  });
});
