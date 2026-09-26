/**
 * The frame pump (#226): frames are stamped with their CAPTURE time, strictly
 * increasing, from the video frame callback's metadata when it describes the frame
 * the driver is looking at — held one animation frame for a callback that fires
 * late — and from the clock (minus the recent lag while the channel is live)
 * otherwise. The animation-frame loop stays the driver, so a browser that never fires
 * the callback for the hidden `<video>` degrades to the pre-#226 behaviour rather
 * than to silence. All paths are exercised here with fake schedulers; the live
 * webcam behaviour is on #146's list.
 */
import { describe, it, expect } from 'vitest';
import {
  createFramePump,
  metadataMatches,
  pickFrameStamp,
  stampToTiming,
  CHANNEL_LIVE_MS,
  MAX_FUTURE_MS,
  MAX_PLAUSIBLE_LAG_MS,
  MIN_STAMP_STEP_MS,
  type FrameStamp,
  type VideoFrameMetadataLike,
} from '@/nodes/sources/frame_pump';
import { frameTime, stripFrameTiming, type HandsFrame } from '@/nodes';

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
    expect(stampToTiming({ tMs: 2500, source: 'capture', lagMs: 40 }, 1700000000000)).toEqual({ t: 2.5, tSource: 'capture', tOrigin: 1700000000000, lag: 0.04 });
  });

  it('metadata describes the current frame only when mediaTime matches currentTime', () => {
    expect(metadataMatches({ mediaTime: 1.2 }, 1.2)).toBe(true);
    expect(metadataMatches({ mediaTime: 1.2 }, 1.2333)).toBe(false);
    expect(metadataMatches({}, 1.2)).toBe(false);
    expect(metadataMatches(null, 1.2)).toBe(false);
  });
});

describe('frameTime and stripFrameTiming', () => {
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

  it('a replay source strips the timing fields and leaves the rest', () => {
    const f: HandsFrame = { width: 1, height: 2, hands: [], t: 3, tSource: 'capture', tOrigin: 4, lag: 5 };
    expect(stripFrameTiming(f)).toEqual({ width: 1, height: 2, hands: [] });
    const plain: HandsFrame = { width: 1, height: 2, hands: [] };
    expect(stripFrameTiming(plain)).toBe(plain);
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

/** A fake element with a video frame callback the test fires by hand. */
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
    fire: (now: number, meta: VideoFrameMetadataLike) => cb!(now, meta),
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

    // Frame 1 (mediaTime 0, captured at 960) is presented; the callback fires (and
    // delivers the frame itself); the animation frame that follows sees nothing new.
    v.video.readyState = 4;
    clock = 990;
    v.fire(990, { mediaTime: 0, captureTime: 960, presentationTime: 985 });
    expect(got.length).toBe(1);
    expect(got[0]).toEqual({ tMs: 960, source: 'capture', lagMs: 30 });
    clock = 1000;
    s.tick();
    expect(got.length).toBe(1);
    expect(v.handle).toBe(2); // re-registered

    // Frame 2: the callback re-registered itself; same story.
    v.video.currentTime = 0.0333;
    clock = 1025;
    v.fire(1025, { mediaTime: 0.0333, captureTime: 993.3, presentationTime: 1020 });
    clock = 1040;
    s.tick();
    expect(got.length).toBe(2);
    expect(got[1].source).toBe('capture');
    expect(got[1].tMs).toBeCloseTo(993.3, 6);

    // Same frame on the next animation frame: no delivery.
    clock = 1056;
    s.tick();
    expect(got.length).toBe(2);

    pump.stop();
    expect(v.cancelled).toEqual([v.handle]);
    expect(pump.metadataChannel).toBe(false);
    expect(s.armed).toBe(false);
    // A late callback after stop changes nothing.
    v.fire(1100, { mediaTime: 0.1, captureTime: 1090 });
    expect(got.length).toBe(2);
  });

  it('holds a frame one animation frame for a callback that fires late, and still stamps it from capture', () => {
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
    s.tick(); // registers the channel
    v.video.readyState = 4;
    // Frame 1's callback arrives first: delivered from capture, the channel is live.
    clock = 1000;
    v.fire(1000, { mediaTime: 0, captureTime: 960 });
    expect(got.length).toBe(1);
    expect(got[0].source).toBe('capture');
    // Frame 2 is current before its callback fired: the driver HOLDS it ...
    v.video.currentTime = 0.0333;
    clock = 1033;
    s.tick();
    expect(got.length).toBe(1);
    // ... and the callback delivers it, from capture.
    clock = 1038;
    v.fire(1038, { mediaTime: 0.0333, captureTime: 993.3 });
    expect(got.length).toBe(2);
    expect(got[1].source).toBe('capture');
    expect(got[1].tMs).toBeCloseTo(993.3, 6);
    expect(got[1].lagMs).toBeCloseTo(44.7, 6);
    // Frame 3: the callback never comes. Held one animation frame, then stamped at
    // the clock minus the recent capture lag, and labelled as such.
    v.video.currentTime = 0.0667;
    clock = 1066;
    s.tick();
    expect(got.length).toBe(2);
    clock = 1083;
    s.tick();
    expect(got.length).toBe(3);
    expect(got[2].source).toBe('estimated');
    // The recent lag is an exponentially weighted mean over the capture-stamped frames
    // (40 ms, then 44.7 ms at a gain of 0.2).
    expect(got[2].tMs).toBeCloseTo(1083 - (40 + 0.2 * 4.7), 6);
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
    expect(got[1]).toEqual({ tMs: 1033, source: 'clock', lagMs: 0 });
    pump.stop();
  });

  it('a callback that never fires (hidden element) costs nothing: frames flow from the clock without a hold', () => {
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

  it('a channel that goes quiet stops holding frames after CHANNEL_LIVE_MS', () => {
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
    s.tick(); // registers the channel
    v.video.readyState = 4;
    v.fire(1000, { mediaTime: 0, captureTime: 970 });
    expect(got.length).toBe(1);
    // Long after the last callback: a new frame is not held.
    clock = 1000 + CHANNEL_LIVE_MS + 1;
    v.video.currentTime = 0.5;
    s.tick();
    expect(got.length).toBe(2);
    expect(got[1].source).toBe('clock');
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
