/**
 * The frame pump's lifecycle edges from the sprint review (#391 item 4): a stop then a
 * start must leave exactly ONE video-frame callback chain, whether the browser can cancel
 * the old callback or not (#393 lower, #319: a stale video-frame callback can start a
 * second callback chain); and a frame the consumer refuses is retracted from the de-jitter,
 * so the run it fits holds one stamp per delivered frame.
 *
 * The de-jitter module is wrapped (not replaced) so the test can see the pump's instance.
 */
import { describe, it, expect, vi } from 'vitest';
import type { StampDejitter } from '@thoremin/sdk/timing/stamp_dejitter';

const dejitters = vi.hoisted(() => [] as { instance: StampDejitter; retract: ReturnType<typeof vi.fn> }[]);
vi.mock('@thoremin/sdk/timing/stamp_dejitter', async (importOriginal) => {
  const real = await importOriginal<typeof import('@thoremin/sdk/timing/stamp_dejitter')>();
  return {
    ...real,
    createStampDejitter: (...args: Parameters<typeof real.createStampDejitter>) => {
      const instance = real.createStampDejitter(...args);
      const retract = vi.fn(instance.retract);
      const wrapped: StampDejitter = { ...instance, retract };
      dejitters.push({ instance: wrapped, retract });
      return wrapped;
    },
  };
});

import { createFramePump, type FrameStamp, type VideoFrameMetadataLike } from '@/nodes/sources/frame_pump';

type VfcCallback = (now: number, meta: VideoFrameMetadataLike) => void;

/** A fake element whose registered callbacks are all kept (a real one fires every
 *  outstanding callback at the next presented frame), with or without a way to cancel. */
function vfcVideo(options: { cancel: boolean }) {
  const outstanding = new Map<number, VfcCallback>();
  let handle = 0;
  const video = {
    readyState: 4,
    videoWidth: 640,
    currentTime: 0,
    requestVideoFrameCallback(cb: VfcCallback) {
      outstanding.set(++handle, cb);
      return handle;
    },
    ...(options.cancel ? { cancelVideoFrameCallback: (h: number) => void outstanding.delete(h) } : {}),
  };
  return {
    video,
    outstanding,
    /** Present a frame: every outstanding callback fires once. */
    present(now: number, meta: VideoFrameMetadataLike) {
      const due = [...outstanding.entries()];
      outstanding.clear();
      for (const [, cb] of due) cb(now, meta);
    },
  };
}

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
  };
}

const PERIOD = 1000 / 30;

/** Present `n` frames on `fake` from frame number `from`, each followed by an animation
 *  frame; returns the clock after the last. */
function presentFrames(fake: ReturnType<typeof vfcVideo>, s: ReturnType<typeof scheduler>, clock: { ms: number }, from: number, n: number) {
  for (let i = 0; i < n; i++) {
    clock.ms += PERIOD;
    fake.video.currentTime = (from + i) / 30;
    fake.present(clock.ms, { presentedFrames: from + i, captureTime: clock.ms - 20, mediaTime: fake.video.currentTime });
    s.tick();
  }
}

describe('createFramePump: stop then start leaves one callback chain', () => {
  it('where the browser can cancel: the old callback is cancelled, and each frame is delivered once', () => {
    const fake = vfcVideo({ cancel: true });
    const s = scheduler();
    const clock = { ms: 1000 };
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => fake.video as unknown as HTMLVideoElement, (st) => void got.push(st), { now: () => clock.ms, requestAnimationFrame: s.raf, cancelAnimationFrame: s.caf });
    pump.start();
    s.tick();
    expect(fake.outstanding.size).toBe(1);
    pump.stop();
    expect(fake.outstanding.size).toBe(0);
    pump.start();
    s.tick();
    expect(fake.outstanding.size).toBe(1);
    got.length = 0; // the start ticks delivered the frame already on screen
    presentFrames(fake, s, clock, 1, 6);
    expect(fake.outstanding.size).toBe(1);
    expect(got.length).toBe(6);
    expect(got.every((g) => g.source === 'capture')).toBe(true);
  });

  it('without cancelVideoFrameCallback, on the same element: the stale callback does not start a second chain (#393 lower: #319 stale video-frame callback)', () => {
    const fake = vfcVideo({ cancel: false });
    const s = scheduler();
    const clock = { ms: 1000 };
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => fake.video as unknown as HTMLVideoElement, (st) => void got.push(st), { now: () => clock.ms, requestAnimationFrame: s.raf, cancelAnimationFrame: s.caf });
    pump.start();
    s.tick();
    pump.stop(); // the browser cannot cancel: the first callback stays registered
    pump.start();
    s.tick();
    got.length = 0; // the start ticks delivered the frame already on screen
    presentFrames(fake, s, clock, 1, 6);
    expect(fake.outstanding.size).toBe(1);
    expect(got.length).toBe(6);
  });

  it('without cancelVideoFrameCallback, on a new element: the old element\'s callback does not clear the new handle (#393 lower: #319 stale video-frame callback)', () => {
    const first = vfcVideo({ cancel: false });
    const second = vfcVideo({ cancel: false });
    let current = first;
    const s = scheduler();
    const clock = { ms: 1000 };
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => current.video as unknown as HTMLVideoElement, (st) => void got.push(st), { now: () => clock.ms, requestAnimationFrame: s.raf, cancelAnimationFrame: s.caf });
    pump.start();
    s.tick();
    pump.stop();
    current = second;
    pump.start();
    s.tick();
    expect(second.outstanding.size).toBe(1);
    // The old element presents a frame: its stale callback fires into the restarted pump.
    first.present(clock.ms + 5, { presentedFrames: 1, captureTime: clock.ms - 15, mediaTime: 0 });
    s.tick();
    expect(second.outstanding.size).toBe(1);
    got.length = 0;
    presentFrames(second, s, clock, 1, 4);
    expect(second.outstanding.size).toBe(1);
    expect(got.length).toBe(4);
  });
  it('without cancelVideoFrameCallback, element A then B then A in one run: A\'s first callback does not clear the new A chain\'s handle (#393 lower: #319 stale video-frame callback)', () => {
    const a = vfcVideo({ cancel: false });
    const b = vfcVideo({ cancel: false });
    let current = a;
    const s = scheduler();
    const clock = { ms: 1000 };
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => current.video as unknown as HTMLVideoElement, (st) => void got.push(st), { now: () => clock.ms, requestAnimationFrame: s.raf, cancelAnimationFrame: s.caf });
    pump.start();
    s.tick(); // registers on A
    current = b;
    s.tick(); // replaces A by B: A's callback cannot be cancelled
    current = a;
    s.tick(); // A again: a new registration beside the stale one
    expect(a.outstanding.size).toBe(2);
    got.length = 0;
    presentFrames(a, s, clock, 1, 6);
    expect(a.outstanding.size).toBe(1);
    expect(got.length).toBe(6);
    // B's stale callback fires too, into a pump that has moved on.
    b.present(clock.ms + 5, { presentedFrames: 1, captureTime: clock.ms - 15, mediaTime: 0 });
    s.tick();
    expect(a.outstanding.size).toBe(1);
  });
});

describe('createFramePump: a refused frame and the de-jitter', () => {
  it('with dejitter on, a refused frame calls retract(), and the run holds one stamp per delivered frame', () => {
    dejitters.length = 0;
    const video = { readyState: 4, videoWidth: 640, currentTime: 0 };
    const s = scheduler();
    let clock = 1000;
    const delivered: FrameStamp[] = [];
    let refusals = 0;
    // Refuse every fifth frame once (the model was not ready): it is offered again on the
    // next animation frame with a later clock reading.
    let offers = 0;
    const pump = createFramePump(
      () => video as unknown as HTMLVideoElement,
      (st) => {
        offers++;
        if (offers % 5 === 0) {
          refusals++;
          return false;
        }
        delivered.push(st);
        return true;
      },
      { now: () => clock, requestAnimationFrame: s.raf, cancelAnimationFrame: s.caf, dejitter: true },
    );
    expect(dejitters.length).toBe(1);
    const { instance, retract } = dejitters[0];
    pump.start();
    for (let frame = 1; delivered.length < 20; ) {
      if (delivered.length + refusals >= offers) {
        // Present the next frame; a refused one keeps the same currentTime.
        video.currentTime = frame++ / 30;
      }
      clock += PERIOD / 2 + (frame % 3); // a jittered animation-frame clock
      s.tick();
    }
    expect(refusals).toBeGreaterThan(0);
    expect(retract).toHaveBeenCalledTimes(refusals);
    expect(instance.state().frames).toBe(delivered.length);
    for (let i = 1; i < delivered.length; i++) expect(delivered[i].tMs).toBeGreaterThan(delivered[i - 1].tMs);
  });

  it('with dejitter off, there is no de-jitter to retract from', () => {
    dejitters.length = 0;
    createFramePump(() => undefined, () => true, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, dejitter: false });
    expect(dejitters.length).toBe(0);
  });
});
