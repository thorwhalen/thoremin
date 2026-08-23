/**
 * Tests the live frame loop (`src/app/engineLoop.ts`) — the app's adoption of the
 * Clock seam (Stream Applier M-B/M-D).
 *
 * `useEngine` used to hand-roll its own `requestAnimationFrame` recursion, so the
 * shipped `RealtimeClock` was dead code in production and the loop's real
 * behaviour — the frame-drop guard especially — had no coverage at all. Pulling
 * the loop into its own module with an injectable clock makes all of it testable
 * in plain Node: no browser, no camera, no ML model.
 *
 * The invariant worth the most here is the frame-drop guard: one node throwing on
 * one frame must never stop the instrument. Before this, that `try/catch` lived
 * inside a closure inside an async IIFE inside a React effect, where nothing
 * could reach it.
 */
import { describe, it, expect, vi } from 'vitest';
import { BatchClock, RealtimeClock, type Clock } from '../src/dag';
import { runEngineLoop, type Tickable } from '@/app/engineLoop';

/** A controllable stand-in for requestAnimationFrame. */
function fakeScheduler() {
  let pending: (() => void) | null = null;
  return {
    schedule: (cb: () => void) => {
      pending = cb;
    },
    flush(n: number) {
      for (let i = 0; i < n; i++) {
        const cb = pending;
        pending = null;
        if (!cb) return;
        cb();
      }
    },
  };
}

/** Records the times the engine was ticked at. */
function recordingEngine(onTick?: (n: number) => void): Tickable & { times: (number | undefined)[] } {
  const times: (number | undefined)[] = [];
  return {
    times,
    tick(t) {
      times.push(t);
      onTick?.(times.length);
    },
  };
}

/** A realtime clock over a fixed list of wall-clock seconds. */
function pacedClock(times: number[], sched: ReturnType<typeof fakeScheduler>): Clock {
  let i = 0;
  return new RealtimeClock({ now: () => times[Math.min(i++, times.length - 1)], schedule: sched.schedule });
}

describe('runEngineLoop', () => {
  it('ticks the engine on the clock\'s time and reports in milliseconds', async () => {
    const sched = fakeScheduler();
    const engine = recordingEngine();
    const reported: number[] = [];
    const done = runEngineLoop(engine, [(ms) => void reported.push(ms)], () => engine.times.length >= 3, {
      clock: pacedClock([100, 100.5, 101], sched),
    });
    sched.flush(10);
    await done;

    expect(engine.times).toEqual([100, 100.5, 101]);
    // Reporters get milliseconds — the gesture dispatcher's hold/cooldown timing
    // and the face/MIDI report throttles are all in ms.
    expect(reported).toEqual([100_000, 100_500, 101_000]);
  });

  it('runs every reporter, in order, once per tick', async () => {
    const sched = fakeScheduler();
    const engine = recordingEngine();
    const order: string[] = [];
    const done = runEngineLoop(
      engine,
      [() => void order.push('face'), () => void order.push('midi'), () => void order.push('gesture')],
      () => engine.times.length >= 2,
      { clock: pacedClock([0, 1], sched) },
    );
    sched.flush(10);
    await done;
    expect(order).toEqual(['face', 'midi', 'gesture', 'face', 'midi', 'gesture']);
  });

  it('DROPS a frame whose tick throws and keeps the loop alive', async () => {
    const sched = fakeScheduler();
    let n = 0;
    const engine: Tickable = {
      tick() {
        n += 1;
        if (n === 2) throw new Error('degenerate value');
      },
    };
    const errors: unknown[] = [];
    const reported: number[] = [];
    const done = runEngineLoop(engine, [(ms) => void reported.push(ms)], () => n >= 4, {
      clock: pacedClock([0, 1, 2, 3], sched),
      onError: (e) => void errors.push(e),
    });
    sched.flush(10);
    await done;

    expect(n).toBe(4); // the loop kept going past the throw
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('degenerate value');
    // The throwing frame reported nothing; the other three did.
    expect(reported).toEqual([0, 2000, 3000]);
  });

  it('a throwing reporter costs its frame, not the session', async () => {
    const sched = fakeScheduler();
    const engine = recordingEngine();
    const errors: unknown[] = [];
    const late: number[] = [];
    const done = runEngineLoop(
      engine,
      [
        (ms) => {
          if (ms === 1000) throw new Error('report blew up');
        },
        (ms) => void late.push(ms),
      ],
      () => engine.times.length >= 3,
      { clock: pacedClock([0, 1, 2], sched), onError: (e) => void errors.push(e) },
    );
    sched.flush(10);
    await done;

    expect(engine.times).toHaveLength(3); // every frame still ticked
    expect(errors).toHaveLength(1);
    expect(late).toEqual([0, 2000]); // the second reporter was skipped only on the bad frame
  });

  it('stops as soon as the stop condition flips, without ticking again', async () => {
    const sched = fakeScheduler();
    const engine = recordingEngine();
    let disposed = false;
    const done = runEngineLoop(engine, [], () => disposed, { clock: pacedClock([0, 1, 2, 3, 4], sched) });
    sched.flush(2);
    expect(engine.times).toHaveLength(2);
    disposed = true; // what the effect cleanup does
    sched.flush(5); // an already-scheduled frame fires and must NOT tick
    await done;
    expect(engine.times).toHaveLength(2);
  });

  it('never ticks if it is already stopped when it starts', async () => {
    const sched = fakeScheduler();
    const engine = recordingEngine();
    const done = runEngineLoop(engine, [], () => true, { clock: pacedClock([0], sched) });
    sched.flush(5);
    await done;
    expect(engine.times).toEqual([]);
  });

  it('falls back to the wall clock when the clock omits the tick time', async () => {
    // BatchClock passes no argument (the engine synthesizes its own time), but the
    // reporters still need a real millisecond stamp rather than an invented one.
    const engine = recordingEngine();
    const reported: number[] = [];
    let fake = 5;
    await runEngineLoop(engine, [(ms) => void reported.push(ms)], () => engine.times.length >= 2, {
      clock: new BatchClock(2),
      now: () => fake++,
    });
    expect(engine.times).toEqual([5, 6]);
    expect(reported).toEqual([5000, 6000]);
  });

  it('defaults to a wall-clock RealtimeClock when no clock is given', async () => {
    // The production default: rAF-driven, speed 1. Drive it through a stubbed rAF.
    const frames: Array<() => void> = [];
    const raf = vi.fn((cb: FrameRequestCallback) => {
      frames.push(() => cb(0));
      return frames.length;
    });
    vi.stubGlobal('requestAnimationFrame', raf);
    try {
      const engine = recordingEngine();
      const done = runEngineLoop(engine, [], () => engine.times.length >= 2);
      for (let i = 0; i < 5 && frames.length; i++) frames.shift()!();
      await done;
      expect(engine.times).toHaveLength(2);
      expect(raf).toHaveBeenCalled();
      // Wall-clock times, in seconds, monotonically non-decreasing.
      expect(engine.times[1]!).toBeGreaterThanOrEqual(engine.times[0]!);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
