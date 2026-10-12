/**
 * The `timing` resource's tracker (step 0 of the timing plan) replayed over the real
 * recorded `conducting_44` hands stream (30 fps, 405 ticks) as a tap: a known capture
 * lag, a 60 Hz tick over the 30 fps frames (each frame seen on two ticks and counted
 * once), a Chromium-shaped and a WebKit-shaped audio context, an audio epoch bump that
 * forgets the smoothed pair, and the lead budget as the age's p95 plus the output stage.
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { TimingTracker, timingFrom, ABSENT_TIMING, TIMING_RESOURCE_KEY, MIN_FRAMES_FOR_RATE, UNSTAMPED_SOURCE } from '@thoremin/sdk/timing/tracker';
import { OUTPUT_STAGE_PRIOR_S, type OutputStageAudioLike } from '@thoremin/sdk/timing/output_stage';
import { loadRecords } from '../helpers/fixtures';

const FPS = 30;
const TICK_HZ = 60;
const records = loadRecords('conducting_44', 'src.hands');
const origin = performance.timeOrigin;

/** The fixture's frames as a live camera would stamp them: captured `lag` seconds before
 *  the tick that first sees them, on this document's time base. */
function stampedFrames(lag: number, source: 'capture' | 'clock' = 'capture', skippedEvery = 0): (HandsFrame & { tick: number })[] {
  return records.map((r, i) => ({
    ...(r.value as HandsFrame),
    t: r.t - lag,
    tSource: source,
    tOrigin: origin,
    lag,
    skipped: skippedEvery > 0 && i % skippedEvery === 0 ? 1 : 0,
    tick: r.tick,
  }));
}

interface FakeAudio extends OutputStageAudioLike {
  state: string;
  currentTime: number;
  sampleRate: number;
  baseLatency: number;
  outputLatency: number;
  /** Where the pair says a context time written now is heard, seconds from now. */
  pairS: number;
}

function audio(over: Partial<FakeAudio> = {}): FakeAudio {
  const a: FakeAudio = {
    state: 'running',
    currentTime: 0,
    sampleRate: 48000,
    baseLatency: 0.0058,
    outputLatency: 0.032,
    pairS: 0.0329,
    getOutputTimestamp() {
      return { contextTime: this.currentTime, performanceTime: clockMs + this.pairS * 1000 };
    },
    ...over,
  };
  return a;
}
let clockMs = 0;

/** Tick the tracker at 60 Hz over the 30 fps frames, like the live Applier. */
function run(frames: (HandsFrame & { tick: number })[], ac: FakeAudio | undefined, options: { bumpAtTick?: number; lagAfterBump?: number } = {}) {
  const tracker = new TimingTracker({ now: () => clockMs, audio: () => ac });
  const ticks = frames.length * (TICK_HZ / FPS);
  for (let tick = 0; tick < ticks; tick++) {
    const time = tick / TICK_HZ;
    clockMs = time * 1000;
    if (ac) ac.currentTime = time;
    if (options.bumpAtTick === tick) {
      tracker.bumpEpoch();
      if (ac && options.lagAfterBump !== undefined) ac.pairS = options.lagAfterBump;
    }
    const frame = frames[Math.floor(tick / (TICK_HZ / FPS))];
    const ctx: NodeContext = { tick, time, dt: tick ? 1 / TICK_HZ : 0, resources: { timeScale: 1 } };
    tracker.onValue('cam.hands', frame, ctx);
    tracker.onValue('merge.params', 1, ctx);
  }
  return tracker;
}

describe('TimingTracker over the conducting_44 fixture', () => {
  it('counts each camera frame once under a 60 Hz tick, measures the delivered rate and the stamp mix', () => {
    const t = run(stampedFrames(0.027), audio());
    const r = t.reading();
    expect(r.frames).toBe(records.length);
    expect(r.stampSources).toEqual({ capture: 90 });
    expect(r.dominantSource).toBe('capture');
    expect(r.deliveredFps).toBeCloseTo(FPS, 0);
    expect(r.framePeriod).toBeCloseTo(1 / FPS, 3);
    expect(r.skippedFrames).toBe(0);
    expect(r.camera).toBeNull();
  });

  it('the frame age is the capture lag plus the wait for the tick that sees it (0 here), mean and p95', () => {
    const lag = 0.027;
    const r = run(stampedFrames(lag), audio()).reading();
    expect(r.frameAge.mean).toBeCloseTo(lag, 3);
    expect(r.frameAge.p95).toBeCloseTo(lag, 3);
    // The lead budget is the age's p95 plus the output stage.
    expect(r.leadBudget).toBeCloseTo(lag + r.outputStage.value, 6);
  });

  it('skipped frames accumulate from the frames\' own counts', () => {
    const r = run(stampedFrames(0.027, 'capture', 10), audio()).reading();
    expect(r.skippedFrames).toBe(Math.ceil(records.length / 10));
  });

  it('a stamp that was not used (another document: a replay) and no stamp at all (a synthetic source) both count as none, never as capture', () => {
    const replayed = stampedFrames(0.027).map((f) => ({ ...f, tOrigin: origin - 60000 }));
    const r = run(replayed, audio()).reading();
    expect(r.stampSources).toEqual({ [UNSTAMPED_SOURCE]: 90 });
    expect(r.dominantSource).toBe(UNSTAMPED_SOURCE);
    expect(r.deliveredFps).toBeNaN();
    expect(r.frameAge.mean).toBeNaN();
    const bare = records.map((rec) => ({ ...(rec.value as HandsFrame), tick: rec.tick }));
    const b = run(bare, audio()).reading();
    expect(b.stampSources).toEqual({ [UNSTAMPED_SOURCE]: 90 });
    expect(b.frames).toBe(records.length);
  });

  it('clock stamps are the dominant source and yield no delivered rate (the stamp is not a capture time)', () => {
    const r = run(stampedFrames(0, 'clock'), audio()).reading();
    expect(r.dominantSource).toBe('clock');
    expect(r.deliveredFps).toBeNaN();
    expect(r.frameAge.mean).toBeCloseTo(0, 6);
  });

  it('Chromium: the output stage is the smoothed pair and outputLatency, measured', () => {
    const r = run(stampedFrames(0.027), audio()).reading();
    expect(r.outputStage.source).toBe('measured');
    expect(r.outputStage.value).toBeCloseTo(0.0329, 4);
    expect(r.scheduleToSpeaker).toBeCloseTo(0.0329, 4);
    expect(r.audio.outputLatencyKnown).toBe(true);
  });

  it('WebKit: a pre-latency pair is replaced by outputLatency; before the first tap the stage is the prior, flagged', () => {
    const webkit = audio({ outputLatency: 0.016, baseLatency: 0.0029, pairS: 0.001 });
    const r = run(stampedFrames(0.027), webkit).reading();
    expect(r.outputStage).toEqual({ value: 0.016, source: 'measured' });
    const suspended = audio({ state: 'suspended', outputLatency: 0, pairS: 0.001 });
    const s = run(stampedFrames(0.027), suspended).reading();
    expect(s.outputStage).toEqual({ value: OUTPUT_STAGE_PRIOR_S, source: 'prior' });
    expect(s.audio.outputLatencyKnown).toBe(false);
    expect(s.scheduleToSpeaker).toBeNaN();
  });

  it('an epoch bump forgets the smoothed pair, so a route change (AirPods) is not averaged with the old output', () => {
    // The pair jumps from 33 to 150 ms at tick 400 (a Bluetooth connect); the stage must
    // follow at once, not creep up over the smoothing window.
    const ac = audio();
    const t = run(stampedFrames(0.027), ac, { bumpAtTick: 400, lagAfterBump: 0.15 });
    const r = t.reading();
    expect(r.audioEpoch).toBe(1);
    expect(r.scheduleToSpeaker).toBeGreaterThan(0.14);
    expect(r.outputStage.value).toBeGreaterThan(0.14);
    // A sample-rate mismatch bumps it too.
    ac.sampleRate = 44100;
    t.onValue('merge.params', 1, { tick: 100000, time: 2000, dt: 1 / 60, resources: {} });
    expect(t.reading().audioEpoch).toBe(2);
  });

  it('the camera settings are what the host reports; a strike calibration becomes the stage', () => {
    const t = run(stampedFrames(0.027), audio());
    t.setCamera({ frameRate: 30, width: 1280, height: 720 });
    expect(t.reading().camera).toEqual({ frameRate: 30, width: 1280, height: 720 });
    t.setStrike(0.041);
    expect(t.reading().outputStage).toEqual({ value: 0.041, source: 'strike' });
  });

  it('needs a handful of capture-stamped frames before it states a delivered rate', () => {
    const t = run(stampedFrames(0.027).slice(0, MIN_FRAMES_FOR_RATE - 1), audio());
    expect(t.reading().deliveredFps).toBeNaN();
  });
});

describe('timingFrom', () => {
  it('reads the installed reader, else the absent reading (the prior, never 0)', () => {
    const reading = { outputStage: { value: 0.03, source: 'measured' as const }, audioEpoch: 2, leadBudget: 0.06 };
    expect(timingFrom({ [TIMING_RESOURCE_KEY]: () => reading })).toBe(reading);
    expect(timingFrom({ [TIMING_RESOURCE_KEY]: reading })).toBe(reading);
    expect(timingFrom({})).toBe(ABSENT_TIMING);
    expect(timingFrom({ [TIMING_RESOURCE_KEY]: 'nonsense' })).toBe(ABSENT_TIMING);
    expect(ABSENT_TIMING.outputStage).toEqual({ value: OUTPUT_STAGE_PRIOR_S, source: 'prior' });
    expect(ABSENT_TIMING.outputStage.value).toBeGreaterThan(0);
  });
});
