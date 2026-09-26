/**
 * The frame pump (#226): frames are stamped with their CAPTURE time, strictly
 * increasing, and the pump drives inference from `requestVideoFrameCallback` when the
 * element has it and from `requestAnimationFrame` + `currentTime` polling when it
 * does not. Both paths are exercised here with fake schedulers; the live webcam
 * behaviour is on #146's human-verification list.
 */
import { describe, it, expect } from 'vitest';
import {
  createFramePump,
  frameTime,
  pickFrameStamp,
  stampToTiming,
  MAX_PLAUSIBLE_LAG_MS,
  MIN_STAMP_STEP_MS,
  type FrameStamp,
  type VideoFrameMetadataLike,
} from '@/nodes/sources/frame_pump';

describe('pickFrameStamp', () => {
  it('prefers the capture time and reports the lag to inference', () => {
    const s = pickFrameStamp(1050, { captureTime: 1000 }, -Infinity, 1040);
    expect(s).toEqual({ tMs: 1000, source: 'capture', lagMs: 50 });
  });

  it('falls back to the callback time, then to the clock', () => {
    expect(pickFrameStamp(1050, {}, -Infinity, 1040)).toEqual({ tMs: 1040, source: 'presentation', lagMs: 10 });
    expect(pickFrameStamp(1050, undefined, -Infinity)).toEqual({ tMs: 1050, source: 'clock', lagMs: 0 });
  });

  it('does not trust a capture time in another time base', () => {
    const far = pickFrameStamp(1050, { captureTime: 1050 - MAX_PLAUSIBLE_LAG_MS - 1 }, -Infinity, 1040);
    expect(far.source).toBe('presentation');
    const future = pickFrameStamp(1050, { captureTime: 1050 + MAX_PLAUSIBLE_LAG_MS + 1 }, -Infinity);
    expect(future.source).toBe('clock');
    expect(pickFrameStamp(1050, { captureTime: NaN }, -Infinity).source).toBe('clock');
  });

  it('is strictly increasing even when the camera repeats a timestamp', () => {
    const a = pickFrameStamp(1050, { captureTime: 1000 }, -Infinity);
    const b = pickFrameStamp(1083, { captureTime: 1000 }, a.tMs);
    expect(b.tMs).toBe(1000 + MIN_STAMP_STEP_MS);
    const c = pickFrameStamp(1083, { captureTime: 990 }, b.tMs);
    expect(c.tMs).toBeGreaterThan(b.tMs);
  });

  it('converts to the seconds the frame carries', () => {
    expect(stampToTiming({ tMs: 2500, source: 'capture', lagMs: 40 })).toEqual({ t: 2.5, lag: 0.04 });
  });
});

describe('frameTime', () => {
  it('uses the frame capture time when it is in the consumer time base, else the fallback', () => {
    expect(frameTime({ t: 10.02 }, 10.05)).toBe(10.02);
    expect(frameTime({ t: 3.0 }, 10.05)).toBe(10.05); // a replay or a scaled clock
    expect(frameTime({}, 10.05)).toBe(10.05);
    expect(frameTime(undefined, 10.05)).toBe(10.05);
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

describe('createFramePump', () => {
  it('drives inference from requestVideoFrameCallback and stamps the capture time', () => {
    let pending: ((now: number, meta: VideoFrameMetadataLike) => void) | null = null;
    let cancelled: number[] = [];
    const video: FakeVideo = {
      readyState: 4,
      videoWidth: 640,
      currentTime: 0,
      requestVideoFrameCallback: (cb) => {
        pending = cb;
        return 7;
      },
      cancelVideoFrameCallback: (h) => void cancelled.push(h),
    };
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(
      () => video as unknown as HTMLVideoElement,
      (stamp) => void got.push(stamp),
      { now: () => clock },
    );
    pump.start();
    expect(pump.mode).toBe('video-frame-callback');
    expect(pending).not.toBeNull();
    // Frame 1 captured at 960, the callback fires at 990, we run at 1000.
    clock = 1000;
    pending!(990, { captureTime: 960 });
    // Frame 2: captured 33.3 ms later; inference now at 1040.
    clock = 1040;
    pending!(1025, { captureTime: 993.3 });
    expect(got.map((s) => s.source)).toEqual(['capture', 'capture']);
    expect(got[0].tMs).toBe(960);
    expect(got[1].tMs).toBeCloseTo(993.3, 6);
    expect(got[0].lagMs).toBe(40);
    // A re-registration happened after each delivery.
    pump.stop();
    expect(cancelled).toEqual([7]);
    expect(pump.mode).toBe('idle');
    // Nothing after stop.
    const before = got.length;
    pending!(1100, { captureTime: 1090 });
    expect(got.length).toBe(before);
  });

  it('falls back to animation frames with currentTime polling and never re-delivers a frame', () => {
    const video: FakeVideo = { readyState: 4, videoWidth: 640, currentTime: 0 };
    let scheduled: (() => void) | null = null;
    let clock = 1000;
    const got: FrameStamp[] = [];
    const pump = createFramePump(
      () => video as unknown as HTMLVideoElement,
      (stamp) => void got.push(stamp),
      {
        now: () => clock,
        requestAnimationFrame: (cb) => {
          scheduled = cb;
          return 1;
        },
        cancelAnimationFrame: () => {},
      },
    );
    pump.start();
    expect(pump.mode).toBe('animation-frame');
    const tickRaf = () => {
      const cb = scheduled!;
      scheduled = null;
      cb();
    };
    // Two animation frames over one camera frame at currentTime 0.
    tickRaf();
    clock = 1016;
    tickRaf();
    expect(got.length).toBe(1);
    expect(got[0].source).toBe('clock');
    // The camera advances: one more delivery.
    video.currentTime = 0.0333;
    clock = 1033;
    tickRaf();
    expect(got.length).toBe(2);
    expect(got[1].tMs).toBe(1033);
    pump.stop();
  });

  it('offers a frame again when the consumer did not take it (no model yet)', () => {
    const video: FakeVideo = { readyState: 4, videoWidth: 640, currentTime: 0.1 };
    let scheduled: (() => void) | null = null;
    let ready = false;
    let delivered = 0;
    const pump = createFramePump(
      () => video as unknown as HTMLVideoElement,
      () => {
        if (!ready) return false;
        delivered++;
      },
      { now: () => 1000, requestAnimationFrame: (cb) => ((scheduled = cb), 1), cancelAnimationFrame: () => {} },
    );
    pump.start();
    scheduled!();
    scheduled!();
    expect(delivered).toBe(0);
    ready = true;
    scheduled!();
    expect(delivered).toBe(1);
    scheduled!();
    expect(delivered).toBe(1); // same currentTime: not a new frame
    pump.stop();
  });

  it('waits for a not-yet-ready element on either path', () => {
    const video: FakeVideo = { readyState: 0, videoWidth: 0, currentTime: 0 };
    let scheduled: (() => void) | null = null;
    let delivered = 0;
    const pump = createFramePump(() => video as unknown as HTMLVideoElement, () => void delivered++, {
      now: () => 1000,
      requestAnimationFrame: (cb) => ((scheduled = cb), 1),
      cancelAnimationFrame: () => {},
    });
    pump.start();
    scheduled!();
    expect(delivered).toBe(0);
    video.readyState = 4;
    video.videoWidth = 640;
    scheduled!();
    expect(delivered).toBe(1);
    pump.stop();
  });
});
