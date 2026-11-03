/**
 * The loopback timing take (#881), end to end without a browser: the page's runner and the
 * calibration session in `loopback` mode, the clicks it plays heard through the SDK's synthetic
 * loopback (each one reaching the input a known round trip after its scheduled time), the real
 * onset analyser run over that input quantum by quantum, the heard frames converted with the
 * input stage in force. The stage it sets is the round trip minus the output stage (the median of
 * what the browser reported over the take), whatever stage was in force; it refuses with no output
 * stage reported, and for a round trip too long to pair; a refused take keeps the stage there was.
 */
import { describe, expect, it } from 'vitest';
import { createCalibrationSession, LOOPBACK_BPM } from '@thoremin/games/calibrate';
import { ONSET_ANALYSERS } from '@thoremin/games/listen';
import { createAnalyserChain } from '@thoremin/sdk/audio/analysers';
import { RENDER_QUANTUM } from '@thoremin/sdk/audio/offline';
import { createSyntheticLoopback } from '@thoremin/sdk/audio/synthetic_taps';
import { inputStageFromLoopback, type InputStage } from '@thoremin/sdk/timing/input_stage';
import { setInputStage, storedInputStage } from '@thoremin/sdk-ui/audio/inputStage';
import type { LeaseEvent } from '@thoremin/sdk-ui/audio/hub';
import { createRunner } from '../../play/src/runner';
import { keepTake } from '../../play/src/timing_take';

const SR = 48_000;
const TICK_S = 1 / 60;
const START_S = 0.5;
/** Within this the stage measured is the stage the loopback was built with. */
const TOLERANCE_S = 0.003;
const OUT_S = 0.025;

interface TakeSetup {
  roundTrip: number;
  current: InputStage;
  /** The output stage the browser reports on each tick (a constant, or one per tick). */
  outputStage: number | null | ((tick: number) => number | null);
  heard?: boolean;
  bpm?: number;
}

/** One loopback take: what the session concluded. `heard: false` is a speaker the microphone cannot hear. */
function loopbackTake({ roundTrip, current, outputStage, heard = true, bpm }: TakeSetup) {
  let ticks = 0;
  const reported = typeof outputStage === 'function' ? outputStage : () => outputStage;
  const session = createCalibrationSession({ start: START_S, mode: 'loopback', ...(bpm ? { bpm } : {}), stages: { inputStage: () => current, outputStage: () => reported(ticks) } });
  const loop = createSyntheticLoopback({ sampleRate: SR, delayS: roundTrip, level: heard ? undefined : 0 });
  const chain = createAnalyserChain(ONSET_ANALYSERS, SR);
  let pending: LeaseEvent[] = [];
  let frame = 0;
  let now = 0;
  const runner = createRunner(session, {
    drain: () => {
      const out = pending;
      pending = [];
      return out;
    },
    now: () => now,
    sampleRate: () => SR,
    inputStage: () => current,
    micState: () => 'live',
    play: (cue) => loop.schedule(cue.t),
  });
  const output = new Float32Array(RENDER_QUANTUM);
  for (let view = runner.tick(); view?.phase !== 'results'; view = runner.tick()) {
    now += TICK_S;
    ticks++;
    // The audio thread: every quantum up to now, its events posted to the lease.
    for (; frame + RENDER_QUANTUM <= now * SR; frame += RENDER_QUANTUM) chain.process(loop.read(frame, frame + RENDER_QUANTUM), output, frame, (source, event) => pending.push({ source, event }));
    if (now > session.end + 1) throw new Error('the take never ended');
  }
  return { result: session.result()!, view: runner.tick()! };
}

const near = (x: number | undefined, want: number) => expect(Math.abs((x ?? NaN) - want)).toBeLessThan(TOLERANCE_S);

describe('the loopback timing take (#881)', () => {
  it('sets the round trip minus the output stage, from a stage of 0', () => {
    const { result, view } = loopbackTake({ roundTrip: 0.06, current: { seconds: 0, source: 'measured' }, outputStage: OUT_S });
    expect(result.refusal).toBeNull();
    expect(result.inputStage?.stage?.source).toBe('loopback');
    near(result.inputStage!.stage!.seconds, 0.035);
    expect(view.results!.summary).toMatch(/Input stage 3\d ms .*output stage 25 ms taken out/);
  });

  it('adds the residual to the stage in force, so the same device measures the same', () => {
    const { result } = loopbackTake({ roundTrip: 0.06, current: { seconds: 0.02, source: 'tap' }, outputStage: OUT_S });
    expect(result.offset).toBeCloseTo(0.04, 2);
    near(result.inputStage!.stage!.seconds, 0.035);
  });

  it('takes out the median output stage of the take, not one reading', () => {
    // The browser settling: unreported at first, a stray reading every so often.
    const settling = (tick: number) => (tick < 10 ? null : tick % 17 === 0 ? 0.2 : OUT_S);
    const { result } = loopbackTake({ roundTrip: 0.06, current: { seconds: 0, source: 'prior' }, outputStage: settling });
    expect(result.outputStage).toBe(OUT_S);
    near(result.inputStage!.stage!.seconds, 0.035);
  });

  it('refuses when the browser reports no output stage', () => {
    const { result, view } = loopbackTake({ roundTrip: 0.05, current: { seconds: 0.01, source: 'prior' }, outputStage: null });
    expect(result.inputStage?.stage).toBeNull();
    expect(result.refusal).toMatch(/reports no output stage/);
    expect(view.results!.summary).toMatch(/^Not usable: the browser reports no output stage/);
  });

  it('measures a slow output at its own tempo, and says when one is too slow to measure', () => {
    expect(LOOPBACK_BPM).toBeLessThan(100);
    const slow = loopbackTake({ roundTrip: 0.4, current: { seconds: 0, source: 'prior' }, outputStage: 0.37 });
    near(slow.result.inputStage!.stage!.seconds, 0.03);
    // At a tap take's tempo the same round trip passes half a period: each click pairs with the next.
    const wrapped = loopbackTake({ roundTrip: 0.4, current: { seconds: 0, source: 'prior' }, outputStage: 0.37, bpm: 100 });
    expect(wrapped.result.refusal).toMatch(/too slow to measure \(Bluetooth\?\)/);
  });

  it('a take the page keeps becomes the device stage; a refused one keeps the stage there was', () => {
    const before: InputStage = { seconds: 0.018, source: 'loopback' };
    setInputStage(before);
    const deps = { writeOffset: () => true, setInputStage, inputStage: () => before, now: () => new Date() };

    const silent = loopbackTake({ roundTrip: 0.06, current: before, outputStage: OUT_S, heard: false });
    expect(silent.result.refusal).toMatch(/no response/);
    expect(silent.view.results!.summary).toMatch(/^Not usable/);
    expect(keepTake('loopback', silent.result, deps)).toBe(silent.result.refusal);
    expect(storedInputStage()).toEqual(before);

    const good = loopbackTake({ roundTrip: 0.06, current: before, outputStage: OUT_S });
    expect(keepTake('loopback', good.result, deps)).toBeNull();
    expect(storedInputStage()?.source).toBe('loopback');
    near(storedInputStage()?.seconds, 0.035);
    setInputStage(null);
  });

  it('refuses a stage no device has', () => {
    const prior: InputStage = { seconds: 0, source: 'prior' };
    expect(inputStageFromLoopback({ residual: 0.01, current: prior, outputStage: 0.03 }).refusal).toMatch(/shorter than the output stage/);
    expect(inputStageFromLoopback({ residual: 2, current: prior, outputStage: 0 }).refusal).toMatch(/past/);
    expect(inputStageFromLoopback({ residual: -0.2, current: prior, outputStage: 0.02 }).refusal).toMatch(/Bluetooth/);
    expect(inputStageFromLoopback({ residual: NaN, current: prior, outputStage: null }).stage).toBeNull();
  });

  it('a tap take keeps the player offset with the stage it was measured under, never the device stage', () => {
    const written: { offset: number; stage?: number }[] = [];
    const r = { offset: 0.04, spread: 0.005, paired: 16, kept: 16, refusal: null };
    const deps = {
      writeOffset: (v: { offset: number; stage?: number }) => (written.push(v), true),
      setInputStage: () => {
        throw new Error('a tap take never sets the stage');
      },
      inputStage: (): InputStage => ({ seconds: 0.012, source: 'reported' }),
      now: () => new Date(),
    };
    expect(keepTake('tap', r, deps)).toBeNull();
    expect(written).toEqual([expect.objectContaining({ offset: 0.04, stage: 0.012 })]);
  });
});
