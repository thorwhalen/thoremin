/**
 * The motion segmenter and the gesture cue (#751, phase 1 of `docs/design/dynamic-gestures.md`):
 * a named gesture's repetitions cut out of a take as traces, over a scripted waving hand
 * (`helpers/wave_take.ts`: the articulated synthetic hand read by the live hand features).
 *
 * The acceptance line is the first two tests: five scripted waves yield five traces, stillness
 * yields none. Each of those also proves it was not vacuous (the waves were seen as motion, the
 * stillness was judged in warm units and was not dead still). The rest pin the edges a
 * segmenter gets wrong: a twitch, a short gap between waves, a sweep, cold units (from the
 * start, and mid-wave when the other hand comes into view), a hole in the stream, repeated
 * stamps, a take that starts mid-wave, and the path through a session and a runner.
 *
 * No recorded gesture take exists yet: a real-take set is the human-only prerequisite of #754.
 */
import { describe, it, expect } from 'vitest';
import { FEATURE_BY_ID } from '@thoremin/sdk/features/catalog';
import { createMotionSegmenter, SEGMENTER_DEFAULTS, type SegmenterOptions } from '@thoremin/sdk/enroll/gestures';
import { MOTION_DEFAULTS } from '@thoremin/sdk/enroll/motion';
import { createNoiseEstimator, type NoiseEstimator } from '@thoremin/sdk/enroll/noise';
import { createSession } from '@thoremin/sdk/enroll/session';
import { createRunner, cueCoverage, type RunnerEvent } from '@thoremin/sdk/enroll/runner';
import { CueSchema } from '@thoremin/sdk/enroll/cue';
import type { Trace } from '@thoremin/sdk/enroll/types';
import { waveTake, WAVE_SCRIPT, type WaveTake } from './helpers/wave_take';

/** A hand's raw image positions: what a wave moves. */
const positions = (side: 'right' | 'left') =>
  Object.keys(FEATURE_BY_ID).filter((id) => id.startsWith(`hand.${side}.`) && FEATURE_BY_ID[id].group === 'hand.position.raw');
const POSITION = positions('right');
const BOTH = [...POSITION, ...positions('left')];
const FRAME_MS = 1000 / WAVE_SCRIPT.fps;
const WINDOW = MOTION_DEFAULTS.speedWindowMs;

/**
 * Run a take through a fresh segmenter, feeding the noise estimate as the session does: a
 * frame between repetitions (no run open) is noise, a frame of a repetition is not. With
 * `feed: false` the estimator is whatever the caller passed, untouched.
 */
function segment(take: WaveTake, options: Partial<SegmenterOptions> = {}, { feed = true } = {}) {
  const noise: NoiseEstimator = options.noise ?? createNoiseEstimator();
  const seg = createMotionSegmenter({ gesture: 'wave', cue: 'wave-5', features: POSITION, ...options, noise });
  let peak = 0;
  let everInRun = false;
  const returned: Trace[] = [];
  for (const f of take.frames) {
    const t = seg.push(f.v, f.t);
    if (t) returned.push(t);
    if (feed && !seg.inRun()) noise.push(f.v, f.t);
    peak = Math.max(peak, seg.lastSpeed());
    everInRun ||= seg.inRun();
  }
  return { seg, noise, traces: seg.traces(), returned, peak, everInRun };
}

/** An estimator warmed on the take's frames before its first wave. */
function warmedOn(take: WaveTake): NoiseEstimator {
  const noise = createNoiseEstimator();
  for (const f of take.frames) if (f.t < take.waves[0].startMs) noise.push(f.v, f.t);
  return noise;
}

/** Whether a trace overlaps a span of the take. */
const overlaps = (trace: Trace, span: { startMs: number; endMs: number }) =>
  trace.samples[0].t <= span.endMs && trace.samples[trace.samples.length - 1].t >= span.startMs;

describe('the motion segmenter over a scripted waving hand', () => {
  it('five scripted waves yield five traces, each one wave', () => {
    const take = waveTake();
    const { traces, returned, peak, seg } = segment(take);
    expect(peak).toBeGreaterThan(SEGMENTER_DEFAULTS.startSigma);
    expect(seg.hasMoved()).toBe(true);
    expect(traces).toHaveLength(5);
    expect(returned).toEqual(traces);
    traces.forEach((trace, i) => {
      const wave = take.waves[i];
      expect(trace).toMatchObject({ id: `wave-5#${i + 1}`, gesture: 'wave', cue: 'wave-5' });
      const first = trace.samples[0].t;
      const last = trace.samples[trace.samples.length - 1].t;
      // It starts one window before the motion was seen: never earlier than a window before
      // the wave, and early in it (the Hann envelope is under a third of its height for the
      // first fifth, so that is where the motion is first seen). It ends on the last moving
      // frame, within a window of the wave's end.
      expect(first).toBeGreaterThanOrEqual(wave.startMs - WINDOW - FRAME_MS);
      expect(first).toBeLessThanOrEqual(wave.startMs + WAVE_SCRIPT.waveMs / 5);
      expect(Math.abs(last - wave.endMs)).toBeLessThanOrEqual(WINDOW + FRAME_MS);
      // Every frame, in order, with no hole, carrying the full live vector.
      for (let j = 1; j < trace.samples.length; j++) {
        expect(trace.samples[j].t).toBeGreaterThan(trace.samples[j - 1].t);
        expect(trace.samples[j].t - trace.samples[j - 1].t).toBeLessThan(2 * FRAME_MS);
      }
      expect(Object.keys(trace.samples[0].vector).length).toBeGreaterThan(POSITION.length);
    });
  });

  it('stillness yields none, judged in warm units on a hand that is not dead still', () => {
    const { traces, peak, noise, seg } = segment(waveTake({ waves: 0, restMs: 10000 }));
    expect(POSITION.every((id) => noise.isWarm(id))).toBe(true);
    expect(peak).toBeGreaterThan(2);
    expect(peak).toBeLessThanOrEqual(SEGMENTER_DEFAULTS.stopSigma);
    expect(traces).toEqual([]);
    expect(seg.hasMoved()).toBe(false);
  });

  it('a twitch is seen as motion and refused on duration', () => {
    const { traces, everInRun } = segment(waveTake({ waves: 1, waveMs: 150, cycles: 0.5 }));
    expect(everInRun).toBe(true);
    expect(traces).toEqual([]);
  });

  it('two waves with too short a gap are one repetition; with a real pause, two', () => {
    expect(segment(waveTake({ waves: 2, pauseMs: 100 })).traces).toHaveLength(1);
    expect(segment(waveTake({ waves: 2, pauseMs: 600 })).traces).toHaveLength(2);
  });

  it('a sweep longer than maxTraceMs is not a repetition, and the wave after it still is', () => {
    const sweep = waveTake({ waves: 1, waveMs: 5000, cycles: 10 });
    const after = waveTake({ waves: 1, restMs: 1000, seed: 2 });
    const offset = sweep.frames[sweep.frames.length - 1].t + FRAME_MS;
    const take: WaveTake = {
      frames: [...sweep.frames, ...after.frames.map((f) => ({ v: f.v, t: f.t + offset }))],
      waves: [...sweep.waves, ...after.waves.map((w) => ({ startMs: w.startMs + offset, endMs: w.endMs + offset }))],
    };
    const { traces, everInRun } = segment(take);
    expect(everInRun).toBe(true);
    expect(traces).toHaveLength(1);
    expect(overlaps(traces[0], take.waves[1])).toBe(true);
    expect(overlaps(traces[0], take.waves[0])).toBe(false);
  });

  it('cuts nothing while the units stay cold', () => {
    // An injected estimator nobody feeds never warms: every frame is cold.
    expect(segment(waveTake(), { noise: createNoiseEstimator() }, { feed: false }).traces).toEqual([]);
  });

  it('a hand coming into view mid-wave interrupts that wave, and the waves after are cut', () => {
    // Long, wide waves, entered near their peak, so the run cut short is long enough to be a
    // trace if it were kept (a segmenter that let a cold frame through would close it).
    const script = { waveMs: 2600, cycles: 5, amplitude: 0.5 };
    const plain = waveTake(script);
    const entering = plain.waves[2].startMs + 900;
    const take = waveTake({ ...script, leftHandFromMs: entering });
    const { traces } = segment(take, { features: BOTH });
    expect(traces).toHaveLength(4);
    expect(traces.some((t) => overlaps(t, take.waves[2]))).toBe(false);
    expect(overlaps(traces[2], take.waves[3])).toBe(true);
  });

  it('a hole in the stream mid-wave interrupts that wave: no trace has a hole, and no tail is cut', () => {
    // The hole falls while the run is open, and the hand keeps waving after it for longer
    // than `minTraceMs`: a segmenter that glued across the hole would keep five traces, one
    // that stayed armed through it would cut the tail as a fifth.
    const take = waveTake({ waveMs: 1400, cycles: 3 });
    const hole = { startMs: take.waves[1].startMs + 400, endMs: take.waves[1].startMs + 650 };
    const holed = { ...take, frames: take.frames.filter((f) => f.t < hole.startMs || f.t > hole.endMs) };
    const { traces } = segment(holed);
    expect(traces).toHaveLength(4);
    expect(traces.some((t) => overlaps(t, take.waves[1]))).toBe(false);
  });

  it('a repeated stamp is the same frame read twice, not a frame', () => {
    const take = waveTake();
    const twice = { ...take, frames: take.frames.flatMap((f) => [f, f]) };
    // The segmenter alone: units warmed once on the rest, not re-fed (the estimator's own
    // handling of a repeated stamp is a separate matter).
    const once = segment(take, { noise: warmedOn(take) }, { feed: false }).traces;
    expect(once).toHaveLength(5);
    expect(segment(twice, { noise: warmedOn(take) }, { feed: false }).traces).toEqual(once);
  });

  it('a take that starts mid-wave, seeded from mid-wave, yields no half wave', () => {
    const take = waveTake();
    const mid = take.waves[0].startMs + 500;
    const k = take.frames.findIndex((f) => f.t >= mid);
    const rest = { ...take, frames: take.frames.slice(k) };
    const { traces } = segment(rest, { noise: warmedOn(take), seed: take.frames[k - 1] });
    expect(traces).toHaveLength(4);
    expect(traces[0].samples[0].t).toBeGreaterThan(take.waves[0].endMs);
  });

  it('is deterministic, resets to nothing, and ignores ids absent from the frame', () => {
    const take = waveTake({ seed: 7 });
    const a = segment(take, { features: BOTH });
    expect(a.traces).toHaveLength(5);
    expect(segment(take, { features: [...POSITION, 'hand.left.wrist.x'] }).traces).toEqual(a.traces);
    a.seg.reset();
    expect(a.seg.traces()).toEqual([]);
    expect(a.seg.hasMoved()).toBe(false);
    for (const f of take.frames) a.seg.push(f.v, f.t);
    expect(a.seg.traces()).toEqual(a.traces);
  });
});

// ---- Through a session and a runner ---------------------------------------------

const REST = CueSchema.parse({
  id: 'rest',
  name: 'Rest',
  instruction: 'Hold your hand up, relaxed.',
  collects: { groups: ['hand.position.raw'] },
  produces: 'baseline',
  sufficiency: { kind: 'frames', minFrames: 30 },
});
const WAVE = CueSchema.parse({
  id: 'wave-5',
  name: 'Wave',
  instruction: 'Wave five times; pause between.',
  collects: { groups: ['hand.position.raw'] },
  produces: 'gesture',
  gesture: 'wave',
  sufficiency: { kind: 'repetitions' },
});

describe('a gesture cue through the session', () => {
  /** A rest cue up to shortly before the first wave, then the wave cue over the rest. */
  function take(t: WaveTake) {
    const session = createSession();
    const before = t.frames.filter((f) => f.t < t.waves[0].startMs - 300);
    session.beginCue(REST);
    for (const f of before) session.push(f.v, f.t);
    session.endCue();
    const sigmaBefore = session.sigma('hand.right.wrist.x');
    session.beginCue(WAVE);
    for (const f of t.frames.slice(before.length)) session.push(f.v, f.t);
    const moved = session.moved();
    session.endCue();
    return { session, sigmaBefore, moved };
  }

  it('cuts the traces, keeps them per cue, and folds no repetition into the noise or the vocabulary', () => {
    const { session, sigmaBefore, moved } = take(waveTake());
    expect(moved).toBe(true);
    const traces = session.tracesFor(WAVE.id);
    expect(traces).toHaveLength(5);
    expect(traces.every((t) => t.gesture === 'wave' && t.cue === WAVE.id)).toBe(true);
    expect(session.traces()).toEqual(traces);
    expect(session.points()).toEqual([]);
    expect(session.ready()).toBe(false);
    // Five waves at 30-60 sigma folded into the jitter would multiply it; the rests between
    // them leave it where the rest cue put it.
    expect(session.sigma('hand.right.wrist.x') / sigmaBefore).toBeLessThan(1.5);

    // Re-running the cue starts its take over.
    session.beginCue(WAVE);
    expect(session.tracesFor(WAVE.id)).toEqual([]);
  });

  it('the other hand coming into view during the cue warms between repetitions, and the waves are cut', () => {
    const t = waveTake({ leftHandFromMs: WAVE_SCRIPT.restMs - 100 });
    const { session } = take(t);
    expect(session.noise().isWarm('hand.left.wrist.x')).toBe(true);
    // The left hand is cold through the first wave; every wave after it is cut.
    expect(session.tracesFor(WAVE.id).length).toBeGreaterThanOrEqual(4);
  });
});

describe('a gesture cue through the runner', () => {
  /** A rest cue, then the wave cue; returns the wave cue's start and end, and its last coverage. */
  function run(take: WaveTake) {
    const events: RunnerEvent[] = [];
    const runner = createRunner({ cues: [REST, WAVE], session: createSession() });
    runner.subscribe((e) => events.push(e));
    runner.start(0);
    let coverage = 0;
    for (const f of take.frames) {
      runner.push(f.v, f.t);
      const s = runner.state();
      if (s.cue?.id === WAVE.id && s.status === 'running') coverage = s.coverage;
    }
    const last = take.frames[take.frames.length - 1].t;
    for (let t = last; t < last + 40000 && runner.state().status !== 'done'; t += 250) runner.tick(t);
    const start = events.find((e) => e.type === 'cue-start' && e.cue.id === WAVE.id);
    const end = events.find((e) => e.type === 'cue-end' && e.cue.id === WAVE.id);
    return { start, end, coverage };
  }

  it('ends the cue as enough on the fifth repetition', () => {
    const take = waveTake({ restMs: 4000 });
    const { start, end, coverage } = run(take);
    expect(start && start.t).toBeLessThan(take.waves[0].startMs);
    expect(end).toMatchObject({ type: 'cue-end', outcome: 'enough', samples: 5 });
    expect(end!.t).toBeGreaterThan(take.waves[4].endMs);
    expect(coverage).toBe(1);
    expect(cueCoverage(WAVE, 4)).toBeCloseTo(4 / 5);
  });

  it('gives up on a player who never moves, saying it saw no movement', () => {
    const { end } = run(waveTake({ waves: 0, restMs: 40000 }));
    expect(end).toMatchObject({ type: 'cue-end', outcome: 'cannot', samples: 0 });
    expect(end && end.type === 'cue-end' && end.why).toBe('I did not see you move for that one.');
  });
});
