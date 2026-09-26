/**
 * The frame pump (#226): frames are stamped with their CAPTURE time, strictly
 * increasing, from the video frame callback's metadata when it describes the frame
 * the driver is looking at, and from the clock otherwise — the animation-frame loop
 * stays the driver, so a browser that never fires the callback for the hidden
 * `<video>` degrades to the pre-#226 behaviour rather than to silence. Both are
 * exercised here with fake schedulers; the live webcam behaviour is on #146's list.
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
  type FrameStamp,
  type VideoFrameMetadataLike,
} from '@/nodes/sources/frame_pump';
import { frameTime } from '@/nodes';

describe('pickFrameStamp', () => {
  it('prefers the capture time and reports the lag to inference', () => {
    expect(pickFrameStamp(1050, { captureTime: 1000, presentationTime: 1030 }, -Infinity)).toEqual({ tMs: 1000, source: 'capture', lagMs: 50 });
  });

  it('falls back to the presentation time, then to the clock', () => {
    expect(pickFrameStamp(1050, { presentationTime: 1030 }, -Infinity)).toEqual({ tMs: 1030, source: 'presentation', lagMs: 20 });
    expect(pickFrameStamp(1050, {}, -Infinity)).toEqual({ tMs: 1050, source: 'clock', lagMs: 0 });
    expect(pickFrameStamp(1050, undefined, -Infinity)).toEqual({ tMs: 1050, source: 'clock', lagMs: 0 });
  });

  it('does not trust a capture time that is too old, in the future, or not a number', () => {
    expect(pickFrameStamp(1050, { captureTime: 1050 - MAX_PLAUSIBLE_LAG_MS - 1, presentationTime: 1040 }, -Infinity).source).toBe('presentation');
    expect(pickFrameStamp(1050, { captureTime: 1050 + MAX_FUTURE_MS + 1 }, -Infinity).source).toBe('clock');
    expect(pickFrameStamp(1050, { captureTime: 1050 + MAX_FUTURE_MS - 1 }, -Infinity).source).toBe('capture');
    expect(pickFrameStamp(1050, { captureTime: NaN }, -Infinity).source).toBe('clock');
  });

  it('is strictly increasing by at least a millisecond, even when the camera repeats a timestamp', () => {
    const a = pickFrameStamp(1050, { captureTime: 1000 }, -Infinity);
    const b = pickFrameStamp(1083, { captureTime: 1000 }, a.tMs);
    expect(b.tMs).toBe(1000 + MIN_STAMP_STEP_MS);
    const c = pickFrameStamp(1083, { captureTime: 1000.4 }, b.tMs);
    expect(c.tMs).toBe(b.tMs + MIN_STAMP_STEP_MS);
    const d = pickFrameStamp(1116, { captureTime: 1033.3 }, c.tMs);
    expect(d.tMs).toBeCloseTo(1033.3, 6);
  });

  it('converts to the seconds the frame carries, with the source', () => {
    expect(stampToTiming({ tMs: 2500, source: 'capture', lagMs: 40 })).toEqual({ t: 2.5, tSource: 'capture', lag: 0.04 });
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
  it('uses the stamp only in real time at speed 1, and only when it is a real stamp', () => {
    expect(frameTime({ t: 10.02, tSource: 'capture' }, rt(10.05))).toBe(10.02);
    expect(frameTime({ t: 10.02, tSource: 'clock' }, rt(10.05))).toBe(10.02);
    expect(frameTime({ t: 10.02 }, rt(10.05))).toBe(10.05); // no source: not a stamp
    expect(frameTime({ t: 10.02, tSource: 'capture' }, { time: 10.05, resources: {} })).toBe(10.05); // batch clock
    expect(frameTime({ t: 10.02, tSource: 'capture' }, { time: 10.05, resources: { timeScale: 0.5 } })).toBe(10.05);
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

describe('createFramePump', () => {
  it('stamps a frame from the video frame callback metadata that matches it, else from the clock', () => {
    let vfc: ((now: number, meta: VideoFrameMetadataLike) => void) | null = null;
    const cancelled: number[] = [];
    let handle = 0;
    const video: FakeVideo = {
      readyState: 4,
      videoWidth: 640,
      currentTime: 0,
      requestVideoFrameCallback: (cb) => {
        vfc = cb;
        return ++handle;
      },
      cancelVideoFrameCallback: (h) => void cancelled.push(h),
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
    video.readyState = 0; // the stream is not attached yet: the first tick only registers
    s.tick();
    expect(pump.metadataChannel).toBe(true);
    expect(got.length).toBe(0);

    // The compositor presents frame 1 (mediaTime 0, captured at 960), then the
    // driver's next animation frame sees currentTime 0: stamped from capture.
    video.readyState = 4;
    vfc!(990, { mediaTime: 0, captureTime: 960, presentationTime: 985 });
    clock = 1000;
    s.tick();
    expect(got.length).toBe(1);
    expect(got[0]).toEqual({ tMs: 960, source: 'capture', lagMs: 40 });
    // The callback re-registered itself.
    expect(handle).toBe(2);

    // Frame 2 likewise, 33.3 ms later.
    video.currentTime = 0.0333;
    vfc!(1025, { mediaTime: 0.0333, captureTime: 993.3, presentationTime: 1020 });
    clock = 1040;
    s.tick();
    expect(got[1].source).toBe('capture');
    expect(got[1].tMs).toBeCloseTo(993.3, 6);
    expect(got[1].lagMs).toBeCloseTo(46.7, 6);

    // Frame 3 arrives with stale metadata (the callback did not fire for it): clock.
    video.currentTime = 0.0667;
    clock = 1073;
    s.tick();
    expect(got[2]).toEqual({ tMs: 1073, source: 'clock', lagMs: 0 });

    // Frame 4 is capture-stamped again, but its capture time (1060) is behind the
    // clock stamp that preceded it: the stamp is pushed forward to stay increasing.
    // A one-frame transient, only ever after a clock-stamped frame.
    video.currentTime = 0.1;
    vfc!(1092, { mediaTime: 0.1, captureTime: 1060 });
    clock = 1106;
    s.tick();
    expect(got[3].source).toBe('capture');
    expect(got[3].tMs).toBe(1073 + MIN_STAMP_STEP_MS);

    // Same frame on the next animation frame: no delivery.
    clock = 1122;
    s.tick();
    expect(got.length).toBe(4);

    pump.stop();
    expect(cancelled).toEqual([handle]);
    expect(pump.metadataChannel).toBe(false);
    expect(s.armed).toBe(false);
    // A late callback after stop changes nothing.
    vfc!(1140, { mediaTime: 0.133, captureTime: 1126 });
    expect(got.length).toBe(4);
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

  it('a callback that never fires (hidden element) costs nothing: frames still flow from the clock', () => {
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
    // The element is replaced: the old registration is cancelled, the new one made.
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
