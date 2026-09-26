import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@/dag';
import { LatencyProbe, type AudioLike } from '@/latency/probe';

/**
 * A scripted run: a 30 fps camera, a 60 Hz tick, a known capture lag and inference
 * time, and a fake AudioContext whose output timestamp says the speaker is 25 ms
 * behind `currentTime`. The probe must recover each stage from what the tap sees.
 */
describe('latency probe', () => {
  const FRAME_MS = 1000 / 30;
  const TICK_MS = 1000 / 60;
  const LAG_MS = 40; // capture -> delivery
  const INFER_MS = 9; // delivery -> tick (inference on the main thread)
  const COMPUTE_MS = 1.5; // tick compute
  const SPEAKER_MS = 25;

  function run(ticks: number) {
    let clock = 0;
    const audio: AudioLike = {
      state: 'running',
      sampleRate: 48000,
      baseLatency: 0.005,
      outputLatency: 0.02,
      get currentTime() {
        return clock / 1000;
      },
      getOutputTimestamp: () => ({ contextTime: clock / 1000, performanceTime: clock + SPEAKER_MS }),
    };
    const probe = new LatencyProbe({ now: () => clock, audio: () => audio });
    const seen: number[] = [];
    probe.onFrame((f) => seen.push(f.frame.t!));
    let frame = { width: 640, height: 480, hands: [] as never[], t: NaN, tSource: 'capture' as const, lag: LAG_MS / 1000 };
    for (let tick = 0; tick < ticks; tick++) {
      const tickMs = 1000 + tick * TICK_MS;
      // A new frame is delivered every other tick, inference finishing INFER_MS before the tick.
      if (tick % 2 === 0) frame = { ...frame, t: (tickMs - INFER_MS - LAG_MS) / 1000 };
      const ctx: NodeContext = { tick, time: tickMs / 1000, dt: tick ? TICK_MS / 1000 : 0, resources: {} };
      clock = tickMs;
      probe.onValue('cam.hands', frame, ctx);
      probe.onValue('merge.params', 1, ctx);
      clock = tickMs + COMPUTE_MS;
      probe.endTick(); // the host's first Applier sink
      probe.endTick(); // a second call for the same tick is ignored
    }
    return { probe, seen };
  }

  it('recovers every stage it can see', () => {
    const { probe, seen } = run(61);
    const s = probe.snapshot();
    expect(seen).toHaveLength(31); // each camera frame reported once, not once per tick
    expect(s.frames).toBe(31);
    expect(s.stampSources).toEqual({ capture: 31 });
    expect(s.stages.framePeriod.mean).toBeCloseTo(FRAME_MS, 6);
    expect(s.stages.captureToDelivery.mean).toBeCloseTo(LAG_MS, 6);
    expect(s.stages.deliveryToTick.mean).toBeCloseTo(INFER_MS, 6);
    expect(s.stages.captureToTick.mean).toBeCloseTo(LAG_MS + INFER_MS, 6);
    expect(s.stages.tickPeriod.mean).toBeCloseTo(TICK_MS, 6);
    expect(s.stages.tickCompute.mean).toBeCloseTo(COMPUTE_MS, 6);
    expect(s.stages.scheduleToSpeaker.mean).toBeCloseTo(SPEAKER_MS, 6);
    expect(s.audio).toEqual({ state: 'running', sampleRate: 48000, baseLatencyMs: 5, outputLatencyMs: 20 });
  });

  it('does not count a clock-stamped frame as a capture measurement', () => {
    const probe = new LatencyProbe({ now: () => 0 });
    const ctx = (tick: number): NodeContext => ({ tick, time: tick / 60, dt: 1 / 60, resources: {} });
    probe.onValue('cam.hands', { width: 1, height: 1, hands: [], t: 0.001, tSource: 'clock', lag: 0 }, ctx(1));
    probe.onValue('cam.hands', { width: 1, height: 1, hands: [], t: 0.034, tSource: 'clock', lag: 0 }, ctx(2));
    const s = probe.snapshot();
    expect(s.stages.captureToDelivery.n).toBe(0);
    expect(s.stages.captureToTick.n).toBe(0);
    expect(s.stages.framePeriod.n).toBe(1);
    expect(s.stampSources).toEqual({ clock: 2 });
    probe.reset();
    expect(probe.snapshot().frames).toBe(0);
  });
});
