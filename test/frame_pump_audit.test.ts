/**
 * Adversarial audit of the frame pump (2026-10-20 review lane): the animation-frame loop
 * is the only driver where the browser has no video frame callback, and it must survive a
 * listener that throws, or the camera stops for good with `running` still true.
 */
import { describe, expect, it } from 'vitest';
import { createFramePump } from '@thoremin/sdk/sources/frame_pump';

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

describe('the animation-frame loop under a throwing listener', () => {
  it('re-arms itself after a listener throws, so the next frame is still delivered', () => {
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480, currentTime: 0 } as unknown as HTMLVideoElement;
    const s = scheduler();
    let clock = 1000;
    const got: number[] = [];
    let throwOnce = true;
    const pump = createFramePump(
      () => video,
      (stamp) => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error('a listener bug');
        }
        got.push(stamp.tMs);
      },
      { now: () => clock, requestAnimationFrame: s.raf, cancelAnimationFrame: s.caf, useVideoFrameCallback: false },
    );
    pump.start();
    (video as { currentTime: number }).currentTime = 0.033;
    expect(() => s.tick()).toThrow('a listener bug');
    expect(pump.running).toBe(true);
    expect(s.armed).toBe(true); // the loop lives on
    clock = 1040;
    (video as { currentTime: number }).currentTime = 0.066;
    s.tick();
    expect(got).toHaveLength(1);
    pump.stop();
  });
});
