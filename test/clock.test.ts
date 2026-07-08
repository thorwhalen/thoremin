/**
 * Tests for the Clock abstraction (Stream Applier M-B): BatchClock determinism,
 * RealtimeClock time-mapping + speed multiplier, and an end-to-end check that
 * driving an Engine through each clock yields the expected ctx.dt stream (so
 * speed scales control-rate time for free).
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { BatchClock, RealtimeClock, Engine, defineNode, createRegistry, type Tap } from '../src/dag';

// A controllable stand-in for requestAnimationFrame: stores the next frame
// callback so a test can drive frames one at a time.
function fakeScheduler() {
  let pending: (() => void) | null = null;
  return {
    schedule: (cb: () => void) => {
      pending = cb;
    },
    /** Invoke up to n queued frames (stops early if the loop stops rescheduling). */
    flush(n: number) {
      for (let i = 0; i < n; i++) {
        const cb = pending;
        pending = null;
        if (!cb) return;
        cb();
      }
    },
    get pending() {
      return pending;
    },
  };
}

describe('BatchClock', () => {
  it('calls onTick exactly `ticks` times, always with no argument', async () => {
    const args: (number | undefined)[] = [];
    await new BatchClock(4).run((t) => args.push(t), () => false);
    expect(args).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('runs zero times for ticks=0', async () => {
    const spy = vi.fn();
    await new BatchClock(0).run(spy, () => false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops early when shouldStop becomes true', async () => {
    let n = 0;
    await new BatchClock(100).run(
      () => {
        n++;
      },
      () => n >= 3,
    );
    expect(n).toBe(3);
  });
});

describe('RealtimeClock', () => {
  it('feeds the engine wall-clock time (speed 1): first tick is the base, then real deltas', async () => {
    const sched = fakeScheduler();
    const times = [100, 100.016, 100.032, 100.05];
    let i = 0;
    const captured: number[] = [];
    const clock = new RealtimeClock({ now: () => times[Math.min(i++, times.length - 1)], schedule: sched.schedule });
    const done = clock.run((t) => captured.push(t as number), () => captured.length >= 4);
    sched.flush(10);
    await done;
    expect(captured).toEqual([100, 100.016, 100.032, 100.05]);
  });

  it('scales elapsed time by the speed multiplier (base held fixed)', async () => {
    const sched = fakeScheduler();
    const times = [100, 100.1, 100.2, 100.3];
    let i = 0;
    const captured: number[] = [];
    const clock = new RealtimeClock({
      speed: 2,
      now: () => times[Math.min(i++, times.length - 1)],
      schedule: sched.schedule,
    });
    const done = clock.run((t) => captured.push(t as number), () => captured.length >= 4);
    sched.flush(10);
    await done;
    // base = 100; t = base + (real - base) * 2  →  100, 100.2, 100.4, 100.6
    expect(captured[0]).toBeCloseTo(100, 10);
    expect(captured[1]).toBeCloseTo(100.2, 10);
    expect(captured[2]).toBeCloseTo(100.4, 10);
    expect(captured[3]).toBeCloseTo(100.6, 10);
  });

  it('resolves without ticking if shouldStop is already true', async () => {
    const sched = fakeScheduler();
    const spy = vi.fn();
    const done = new RealtimeClock({ now: () => 0, schedule: sched.schedule }).run(spy, () => true);
    sched.flush(5);
    await done;
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Clock → Engine integration (ctx.dt)', () => {
  // A probe node that emits ctx.dt every tick so a tap can capture the stream.
  const probe = defineNode({
    type: 'probe-dt',
    title: 'dt probe',
    description: 'Emits the current tick dt.',
    inputs: [],
    outputs: [{ name: 'dt', kind: 'number' }],
    params: z.object({}),
    make() {
      return { process: (_inputs, ctx) => ({ dt: ctx.dt }) };
    },
  });

  const spec = { nodes: [{ id: 'p', type: 'probe-dt' }], edges: [] };
  const registryWith = () => {
    const r = createRegistry();
    r.register(probe);
    return r;
  };
  const capture = (): { tap: Tap; dts: number[] } => {
    const dts: number[] = [];
    return { tap: { onValue: (key, value) => key === 'p.dt' && dts.push(value as number) }, dts };
  };

  it('BatchClock drives synthesized time: dt is 0 then nominalDt', async () => {
    const { tap, dts } = capture();
    const engine = new Engine(spec, registryWith(), { taps: [tap], nominalDt: 1 / 60 });
    await engine.init();
    await new BatchClock(4).run(() => engine.tick(), () => false);
    expect(dts[0]).toBe(0); // engine forces tick-0 dt = 0
    // Successive synthesized dts are nominalDt (within float tolerance — the
    // engine subtracts accumulated times, e.g. 2/60 - 1/60, not exactly 1/60).
    expect(dts).toHaveLength(4);
    for (const d of dts.slice(1)) expect(d).toBeCloseTo(1 / 60, 10);
  });

  it('RealtimeClock at speed 2 doubles ctx.dt vs the real frame interval', async () => {
    const sched = fakeScheduler();
    const step = 1 / 60; // real seconds per frame
    const times = [10, 10 + step, 10 + 2 * step, 10 + 3 * step];
    let i = 0;
    const { tap, dts } = capture();
    const engine = new Engine(spec, registryWith(), { taps: [tap] });
    await engine.init();
    const done = new RealtimeClock({
      speed: 2,
      now: () => times[Math.min(i++, times.length - 1)],
      schedule: sched.schedule,
    }).run((t) => engine.tick(t), () => dts.length >= 4);
    sched.flush(10);
    await done;
    expect(dts[0]).toBe(0); // tick-0 dt forced to 0
    // Each subsequent real frame is `step`; at speed 2 the engine sees 2*step.
    expect(dts[1]).toBeCloseTo(2 * step, 10);
    expect(dts[2]).toBeCloseTo(2 * step, 10);
    expect(dts[3]).toBeCloseTo(2 * step, 10);
  });

  it('batch and a perfectly-paced realtime(speed 1) yield an identical ctx.dt stream', async () => {
    // The seam M-B exists to protect: swap the clock, don't touch the engine.
    const nominalDt = 1 / 60;
    const N = 5;

    const batch = capture();
    const be = new Engine(spec, registryWith(), { taps: [batch.tap], nominalDt });
    await be.init();
    // (t) => engine.tick(t): BatchClock passes no arg, so t is undefined and the
    // engine synthesizes time — this also exercises the tick-forwarding path.
    await new BatchClock(N).run((t) => be.tick(t), () => false);

    const sched = fakeScheduler();
    // A flawless real clock ticking exactly nominalDt per frame reproduces the
    // batch times: base=0, t = k*nominalDt.
    const times = Array.from({ length: N }, (_, k) => k * nominalDt);
    let i = 0;
    const paced = capture();
    const pe = new Engine(spec, registryWith(), { taps: [paced.tap], nominalDt });
    await pe.init();
    const done = new RealtimeClock({
      speed: 1,
      now: () => times[Math.min(i++, times.length - 1)],
      schedule: sched.schedule,
    }).run((t) => pe.tick(t), () => paced.dts.length >= N);
    sched.flush(N + 2);
    await done;

    expect(batch.dts).toHaveLength(N);
    expect(paced.dts).toEqual(batch.dts);
  });
});
