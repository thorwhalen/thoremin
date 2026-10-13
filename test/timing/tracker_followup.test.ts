/**
 * The timing tracker's edge cases from the sprint review (#391 item 4, #393): a
 * clock-stamped frame's age must carry the capture lag the stamp leaves out (the air drum
 * adds it; the status line and the lead budget did not: #393 item 4); the cached reading
 * must follow an audio change that arrives without a usable output pair (#393, the
 * tracker's reading cache); and `captureTimeAvailable` says no only after enough honoured
 * frames without a capture stamp.
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import type { FrameTiming } from '@thoremin/sdk/nodes/domain';
import { TimingTracker, CAPTURE_LAG_PRIOR_S, CAPTURE_TIME_VERDICT_FRAMES } from '@thoremin/sdk/timing/tracker';
import { OUTPUT_STAGE_PRIOR_S, type OutputStageAudioLike } from '@thoremin/sdk/timing/output_stage';

const FPS = 30;
const origin = performance.timeOrigin;

/** Feed `n` frames, one per tick, each stamped `stampLag` seconds before the tick by
 *  `source`; returns the next tick number. */
function feed(tracker: TimingTracker, n: number, source: NonNullable<FrameTiming['tSource']>, options: { stampLag?: number; frameLag?: number; from?: number } = {}): number {
  const from = options.from ?? 0;
  for (let i = 0; i < n; i++) {
    const tick = from + i;
    const time = 1 + tick / FPS;
    const ctx: NodeContext = { tick, time, dt: 1 / FPS, resources: { timeScale: 1 } };
    const frame: FrameTiming = { t: time - (options.stampLag ?? 0), tSource: source, tOrigin: origin, lag: options.frameLag ?? 0, skipped: 0 };
    tracker.onValue('cam.hands', frame, ctx);
  }
  return from + n;
}

describe('TimingTracker: the capture lag in a clock-stamped frame\'s age', () => {
  it('a clock stamp is read when the frame was delivered, so its age adds the capture lag (the prior until one is measured) (#393 item 4)', () => {
    const tracker = new TimingTracker({ now: () => 0 });
    // Clock stamps taken at the tick: the stamp itself says the frame is 0 s old.
    feed(tracker, 40, 'clock');
    const r = tracker.reading();
    expect(r.captureLag).toEqual({ value: CAPTURE_LAG_PRIOR_S, source: 'prior' });
    expect(r.frameAge.mean).toBeCloseTo(CAPTURE_LAG_PRIOR_S, 6);
    expect(r.frameAge.p95).toBeCloseTo(CAPTURE_LAG_PRIOR_S, 6);
    expect(r.leadBudget).toBeCloseTo(CAPTURE_LAG_PRIOR_S + OUTPUT_STAGE_PRIOR_S, 6);
  });

  it('once capture stamps have taught a lag, a later clock-stamped frame adds the measured lag (#393 item 4)', () => {
    const tracker = new TimingTracker({ now: () => 0 });
    const next = feed(tracker, 30, 'capture', { stampLag: 0.02, frameLag: 0.02 });
    expect(tracker.reading().captureLag.source).toBe('measured');
    feed(tracker, 200, 'clock', { from: next });
    const r = tracker.reading();
    expect(r.captureLag.value).toBeCloseTo(0.02, 6);
    expect(r.frameAge.mean).toBeCloseTo(0.02, 3);
  });

  it('a capture stamp already carries the lag: its age is the stamp\'s distance from the tick, nothing added', () => {
    const tracker = new TimingTracker({ now: () => 0 });
    feed(tracker, 40, 'capture', { stampLag: 0.025, frameLag: 0.025 });
    const r = tracker.reading();
    expect(r.frameAge.mean).toBeCloseTo(0.025, 6);
    expect(r.frameAge.p95).toBeCloseTo(0.025, 6);
  });
});

describe('TimingTracker: the reading follows the audio without a usable pair', () => {
  /** A context with no output timestamp pair (no `getOutputTimestamp`): only the
   *  reported latencies and state can change the reading. */
  function pairless(over: Partial<{ state: string; outputLatency: number; baseLatency: number }> = {}) {
    return { state: 'running', currentTime: 0, sampleRate: 48000, baseLatency: 0.005, outputLatency: 0.032, ...over } satisfies OutputStageAudioLike;
  }
  /** One tick with no frame: the tracker samples the audio and nothing else changes. */
  function tickOnly(tracker: TimingTracker, tick: number) {
    tracker.onValue('merge.params', 1, { tick, time: tick / 60, dt: 1 / 60, resources: { timeScale: 1 } });
  }

  it('reads outputLatency on the first tick', () => {
    const ac = pairless();
    const tracker = new TimingTracker({ now: () => 0, audio: () => ac });
    tickOnly(tracker, 0);
    expect(tracker.reading().outputStage).toEqual({ value: 0.032, source: 'measured' });
  });

  it('an outputLatency change (an AirPods route, no pair) updates the reading on the next tick (#393 lower: the tracker\'s reading cache)', () => {
    const ac = pairless();
    const tracker = new TimingTracker({ now: () => 0, audio: () => ac });
    tickOnly(tracker, 0);
    expect(tracker.reading().outputStage.value).toBeCloseTo(0.032, 9);
    ac.outputLatency = 0.15;
    tickOnly(tracker, 1);
    const r = tracker.reading();
    expect(r.audio.outputLatency).toBeCloseTo(0.15, 9);
    expect(r.outputStage).toEqual({ value: 0.15, source: 'measured' });
  });

  it('a state change (running to suspended, no pair) updates the reading on the next tick (#393 lower: the tracker\'s reading cache)', () => {
    const ac = pairless();
    const tracker = new TimingTracker({ now: () => 0, audio: () => ac });
    tickOnly(tracker, 0);
    expect(tracker.reading().audio.state).toBe('running');
    ac.state = 'suspended';
    tickOnly(tracker, 1);
    const r = tracker.reading();
    expect(r.audio.state).toBe('suspended');
    expect(r.outputStage.source).toBe('prior');
  });

  it('a baseLatency change (no pair) updates the reading on the next tick (#393 lower: the tracker\'s reading cache)', () => {
    const ac = pairless();
    const tracker = new TimingTracker({ now: () => 0, audio: () => ac });
    tickOnly(tracker, 0);
    expect(tracker.reading().audio.baseLatency).toBeCloseTo(0.005, 9);
    ac.baseLatency = 0.01;
    tickOnly(tracker, 1);
    expect(tracker.reading().audio.baseLatency).toBeCloseTo(0.01, 9);
  });
});

describe('TimingTracker: captureTimeAvailable', () => {
  it('is null until CAPTURE_TIME_VERDICT_FRAMES honoured frames without a capture stamp, then false', () => {
    const tracker = new TimingTracker({ now: () => 0 });
    expect(tracker.reading().captureTimeAvailable).toBeNull();
    const next = feed(tracker, CAPTURE_TIME_VERDICT_FRAMES - 1, 'clock');
    expect(tracker.reading().captureTimeAvailable).toBeNull();
    feed(tracker, 1, 'clock', { from: next });
    expect(tracker.reading().captureTimeAvailable).toBe(false);
  });

  it('turns true at the first capture stamp, even after a false verdict', () => {
    const tracker = new TimingTracker({ now: () => 0 });
    const next = feed(tracker, CAPTURE_TIME_VERDICT_FRAMES, 'estimated');
    expect(tracker.reading().captureTimeAvailable).toBe(false);
    feed(tracker, 1, 'capture', { from: next, stampLag: 0.02, frameLag: 0.02 });
    expect(tracker.reading().captureTimeAvailable).toBe(true);
  });

  it('frames whose stamp was not honoured (another document: a replay) never reach a verdict', () => {
    const tracker = new TimingTracker({ now: () => 0 });
    for (let tick = 0; tick < CAPTURE_TIME_VERDICT_FRAMES * 2; tick++) {
      const time = 1 + tick / FPS;
      tracker.onValue('cam.hands', { t: time - 0.01, tSource: 'clock', tOrigin: origin - 60000 } satisfies FrameTiming, { tick, time, dt: 1 / FPS, resources: { timeScale: 1 } });
    }
    expect(tracker.reading().captureTimeAvailable).toBeNull();
  });
});
