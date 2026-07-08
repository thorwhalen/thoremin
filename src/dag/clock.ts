/**
 * Clock — the execution-mode seam for driving an {@link Engine}, the one place
 * pacing lives (Stream Applier milestone M-B; see docs/design/stream-applier.md).
 *
 * A `Clock` decides *when* the engine advances a tick; it is orthogonal to
 * *where* the data comes from (sources) and *what* we do with the outputs (taps
 * for recording, sinks for view/hear). The engine's `tick(time?)` already
 * accepts either an explicit wall-clock time or none (synthesizing
 * `tickIndex * nominalDt`), so swapping the clock swaps batch-vs-paced without
 * touching the engine.
 *
 *   - {@link BatchClock}    — as fast as possible, deterministic (tests, offline
 *                             recording). Calls `onTick()` with NO argument so
 *                             the engine synthesizes its own time.
 *   - {@link RealtimeClock} — wall-clock paced, with a speed multiplier
 *                             (real-time playback, accelerated/slowed scrub).
 *
 * A future `Applier` (M-D) will own building the engine, wiring sources/sinks
 * and picking a clock; for now `runHeadless` uses `BatchClock` and the live
 * `useEngine` rAF loop is refit onto `RealtimeClock` when the Applier lands
 * (deferred here because that surface has no headless test — see the design doc).
 */

/** Drives an engine tick callback until a stop condition is met. */
export interface Clock {
  /**
   * Run the loop. `onTick` advances the engine one step (optionally at an
   * explicit time in seconds); `shouldStop` is polled before each tick and the
   * returned promise resolves once it is true (or the batch count is reached).
   */
  run(onTick: (time?: number) => void, shouldStop: () => boolean): Promise<void>;
}

/**
 * As-fast-as-possible, deterministic clock: runs exactly `ticks` times (or until
 * `shouldStop`), calling `onTick()` with **no argument** so the engine
 * synthesizes `tickIndex * nominalDt`. Keeping the call argument-free is load
 * bearing — the recorded-fixture goldens depend on that synthesized time.
 */
export class BatchClock implements Clock {
  constructor(private readonly ticks: number) {}

  async run(onTick: (time?: number) => void, shouldStop: () => boolean): Promise<void> {
    for (let i = 0; i < this.ticks && !shouldStop(); i++) onTick();
  }
}

/** Options for {@link RealtimeClock}. */
export interface RealtimeClockOptions {
  /** Playback speed multiplier: 1 = real time, 2 = twice as fast, 0.5 = half. */
  speed?: number;
  /** Wall-clock reader in **seconds**. Injectable for tests; default `performance.now()/1000`. */
  now?: () => number;
  /** Frame scheduler. Injectable for tests/Node; default `requestAnimationFrame`. */
  schedule?: (cb: () => void) => void;
}

/**
 * Wall-clock-paced clock with a speed multiplier. On each scheduled frame it
 * feeds the engine `base + (now - base) * speed`, where `base` is seeded to the
 * first frame's time — so engine time starts at that wall-clock value and
 * advances at `speed×` (and the first frame's delta is 0, matching the engine's
 * own tick-0 `dt === 0`). Control-rate `dt` therefore scales for free; audio is
 * *not* a time-multiply (see the design doc's boundary B) and is handled
 * separately.
 */
export class RealtimeClock implements Clock {
  private readonly speed: number;
  private readonly now: () => number;
  private readonly schedule: (cb: () => void) => void;

  constructor(opts: RealtimeClockOptions = {}) {
    this.speed = opts.speed ?? 1;
    this.now = opts.now ?? (() => performance.now() / 1000);
    // Referenced lazily inside run(), so importing this module in Node (where
    // requestAnimationFrame is absent but only BatchClock is used) is safe.
    this.schedule = opts.schedule ?? ((cb) => void requestAnimationFrame(cb));
  }

  run(onTick: (time?: number) => void, shouldStop: () => boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      let base: number | null = null;
      const frame = () => {
        if (shouldStop()) {
          resolve();
          return;
        }
        const real = this.now();
        if (base === null) base = real; // first paced frame: (real - base) === 0
        onTick(base + (real - base) * this.speed);
        this.schedule(frame);
      };
      this.schedule(frame);
    });
  }
}
