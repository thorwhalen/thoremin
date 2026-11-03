/**
 * The loopback timing take (#881), end to end without a browser: the page's runner and the
 * calibration session in `loopback` mode, the clicks it plays heard through the SDK's synthetic
 * loopback (each one reaching the input a known round trip after its scheduled time), the real
 * onset analyser run over that input quantum by quantum, the heard frames converted with the
 * input stage in force. The stage it sets is the round trip minus the output stage, whatever stage
 * was in force; a refused take keeps the stage there was.
 */
import { describe, expect, it } from 'vitest';
import { createCalibrationSession } from '@thoremin/games/calibrate';
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

/** One loopback take: what the session concluded. `heard: false` is a speaker the microphone cannot hear. */
function loopbackTake({ roundTrip, current, outputStage, heard = true }: { roundTrip: number; current: InputStage; outputStage: number | null; heard?: boolean }) {
  const session = createCalibrationSession({ start: START_S, mode: 'loopback', stages: { inputStage: () => current, outputStage: () => outputStage } });
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
    // The audio thread: every quantum up to now, its events posted to the lease.
    for (; frame + RENDER_QUANTUM <= now * SR; frame += RENDER_QUANTUM) chain.process(loop.read(frame, frame + RENDER_QUANTUM), output, frame, (source, event) => pending.push({ source, event }));
    if (now > session.end + 1) throw new Error('the take never ended');
  }
  return { result: session.result()!, view: runner.tick()! };
}

describe('the loopback timing take (#881)', () => {
  it('sets the round trip minus the output stage, from a stage of 0', () => {
    const { result, view } = loopbackTake({ roundTrip: 0.06, current: { seconds: 0, source: 'measured' }, outputStage: 0.025 });
    expect(result.refusal).toBeNull();
    expect(result.inputStage?.stage?.source).toBe('loopback');
    expect(result.inputStage!.stage!.seconds).toBeCloseTo(0.035, 2);
    expect(Math.abs(result.inputStage!.stage!.seconds - 0.035)).toBeLessThan(TOLERANCE_S);
    expect(view.results!.summary).toMatch(/Input stage 3\d ms .*output stage 25 ms taken out/);
  });

  it('adds the residual to the stage in force, so the same device measures the same', () => {
    const { result } = loopbackTake({ roundTrip: 0.06, current: { seconds: 0.02, source: 'tap' }, outputStage: 0.025 });
    expect(result.offset).toBeCloseTo(0.04, 2);
    expect(Math.abs(result.inputStage!.stage!.seconds - 0.035)).toBeLessThan(TOLERANCE_S);
  });

  it('says so when the browser reports no output stage, and takes nothing out', () => {
    const { result, view } = loopbackTake({ roundTrip: 0.05, current: { seconds: 0.01, source: 'prior' }, outputStage: null });
    expect(Math.abs(result.inputStage!.stage!.seconds - 0.05)).toBeLessThan(TOLERANCE_S);
    expect(view.results!.summary).toMatch(/output stage not reported/);
  });

  it('a take the page keeps becomes the device stage; a refused one keeps the stage there was', () => {
    const before: InputStage = { seconds: 0.018, source: 'loopback' };
    setInputStage(before);
    const deps = { writeOffset: () => true, setInputStage, now: () => new Date() };

    const silent = loopbackTake({ roundTrip: 0.06, current: before, outputStage: 0.025, heard: false });
    expect(silent.result.refusal).toMatch(/no response/);
    expect(silent.view.results!.summary).toMatch(/^Not usable/);
    expect(keepTake('loopback', silent.result, deps)).toBe(silent.result.refusal);
    expect(storedInputStage()).toEqual(before);

    const good = loopbackTake({ roundTrip: 0.06, current: before, outputStage: 0.025 });
    expect(keepTake('loopback', good.result, deps)).toBeNull();
    expect(storedInputStage()?.source).toBe('loopback');
    expect(Math.abs(storedInputStage()!.seconds - 0.035)).toBeLessThan(TOLERANCE_S);
    setInputStage(null);
  });

  it('refuses a stage no device has: a round trip shorter than the reported output stage', () => {
    expect(inputStageFromLoopback({ residual: 0.01, current: { seconds: 0, source: 'prior' }, outputStage: 0.03 }).refusal).toMatch(/shorter than the output stage/);
    expect(inputStageFromLoopback({ residual: 2, current: { seconds: 0, source: 'prior' }, outputStage: null }).refusal).toMatch(/past/);
    expect(inputStageFromLoopback({ residual: NaN, current: { seconds: 0, source: 'prior' }, outputStage: null }).stage).toBeNull();
  });

  it('a tap take still keeps the player offset, not the device stage', () => {
    const written: number[] = [];
    const r = { offset: 0.04, spread: 0.005, paired: 16, kept: 16, refusal: null };
    expect(keepTake('tap', r, { writeOffset: (v) => (written.push(v.offset), true), setInputStage: () => { throw new Error('a tap take never sets the stage'); }, now: () => new Date() })).toBeNull();
    expect(written).toEqual([0.04]);
  });
});
