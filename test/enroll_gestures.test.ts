/**
 * The motion segmenter and the gesture cue (#751, phase 1 of `docs/design/dynamic-gestures.md`):
 * a named gesture's repetitions cut out of a take as traces, over a scripted waving hand
 * (`helpers/wave_take.ts`: the articulated synthetic hand read by the live hand features).
 *
 * The acceptance line is the first two tests: five scripted waves yield five traces, stillness
 * yields none. Each of those also proves it was not vacuous (the waves were seen as motion, the
 * stillness was judged in warm units and was not dead still). The rest pin the edges a
 * segmenter gets wrong: a twitch, a short gap, a sweep, cold units, a take that starts
 * mid-wave, and the path through a session and a runner.
 *
 * No recorded gesture take exists yet: a real-take set is the human-only prerequisite of #754.
 */
import { describe, it, expect } from 'vitest';
import { FEATURE_BY_ID } from '@thoremin/sdk/features/catalog';
import { createMotionSegmenter, SEGMENTER_DEFAULTS, type SegmenterOptions } from '@thoremin/sdk/enroll/gestures';
import { MOTION_DEFAULTS } from '@thoremin/sdk/enroll/motion';
import { createNoiseEstimator } from '@thoremin/sdk/enroll/noise';
import { createSession } from '@thoremin/sdk/enroll/session';
import { createRunner, cueCoverage, type RunnerEvent } from '@thoremin/sdk/enroll/runner';
import { CueSchema } from '@thoremin/sdk/enroll/cue';
import type { Trace } from '@thoremin/sdk/enroll/types';
import { waveTake, WAVE_SCRIPT, type WaveTake } from './helpers/wave_take';

/** The right hand's raw image positions: what a wave moves. */
const POSITION = Object.keys(FEATURE_BY_ID).filter((id) => id.startsWith('hand.right.') && FEATURE_BY_ID[id].group === 'hand.position.raw');
const FRAME_MS = 1000 / WAVE_SCRIPT.fps;
const WINDOW = MOTION_DEFAULTS.speedWindowMs;

/** Run a take through a fresh segmenter; report what it cut and what it saw. */
function segment(take: WaveTake, options: Partial<SegmenterOptions> = {}) {
  const seg = createMotionSegmenter({ gesture: 'wave', features: POSITION, ...options });
  let peak = 0;
  let everMoving = false;
  const returned: Trace[] = [];
  for (const f of take.frames) {
    const t = seg.push(f.v, f.t);
    if (t) returned.push(t);
    peak = Math.max(peak, seg.lastSpeed());
    everMoving ||= seg.isMoving();
  }
  return { seg, traces: seg.traces(), returned, peak, everMoving };
}

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
      expect(trace.gesture).toBe('wave');
      expect(trace.cue).toBe('wave');
      const first = trace.samples[0].t;
      const last = trace.samples[trace.samples.length - 1].t;
      // It starts one window before the motion was seen: never earlier than a window before
      // the wave, and early in it (the Hann envelope is under a third of its height for the
      // first fifth, so that is where the motion is first seen). It ends on the last moving
      // frame, within a window of the wave's end.
      expect(first).toBeGreaterThanOrEqual(wave.startMs - WINDOW - FRAME_MS);
      expect(first).toBeLessThanOrEqual(wave.startMs + WAVE_SCRIPT.waveMs / 5);
      expect(Math.abs(last - wave.endMs)).toBeLessThanOrEqual(WINDOW + FRAME_MS);
      // Every frame, in order, carrying the full live vector.
      for (let j = 1; j < trace.samples.length; j++) expect(trace.samples[j].t).toBeGreaterThan(trace.samples[j - 1].t);
      expect(Object.keys(trace.samples[0].vector).length).toBeGreaterThan(POSITION.length);
    });
  });

  it('stillness yields none, judged in warm units on a hand that is not dead still', () => {
    const take = waveTake({ waves: 0, restMs: 10000 });
    const noise = createNoiseEstimator();
    const seg = createMotionSegmenter({ gesture: 'wave', features: POSITION, noise });
    let peak = 0;
    for (const f of take.frames) {
      noise.push(f.v, f.t);
      seg.push(f.v, f.t);
      peak = Math.max(peak, seg.lastSpeed());
    }
    expect(POSITION.every((id) => noise.isWarm(id))).toBe(true);
    expect(peak).toBeGreaterThan(2);
    expect(peak).toBeLessThanOrEqual(SEGMENTER_DEFAULTS.stopSigma);
    expect(seg.traces()).toEqual([]);
    expect(seg.hasMoved()).toBe(false);
  });

  it('a twitch is seen as motion and refused on duration', () => {
    const { traces, everMoving } = segment(waveTake({ waves: 1, waveMs: 150, cycles: 0.5 }));
    expect(everMoving).toBe(true);
    expect(traces).toEqual([]);
  });

  it('two waves with too short a gap are one repetition; with a real pause, two', () => {
    expect(segment(waveTake({ waves: 2, pauseMs: 100 })).traces).toHaveLength(1);
    expect(segment(waveTake({ waves: 2, pauseMs: 600 })).traces).toHaveLength(2);
  });

  it('a wave longer than maxTraceMs is sweeping about, not a repetition', () => {
    const sweep = waveTake({ waves: 1, waveMs: 5000, cycles: 10 });
    const { traces, everMoving } = segment(sweep);
    expect(everMoving).toBe(true);
    expect(traces).toEqual([]);
    // A wave after the sweep is still cut: following the long run to its end loses nothing.
    expect(segment(waveTake({ waves: 2, waveMs: 1000 }), { maxTraceMs: 3000 }).traces).toHaveLength(2);
  });

  it('cuts nothing while the units are cold, and the same waves once they are warm', () => {
    const take = waveTake();
    // An injected estimator nobody feeds never warms: every frame is cold.
    expect(segment(take, { noise: createNoiseEstimator() }).traces).toEqual([]);
    const warm = createNoiseEstimator();
    for (const f of take.frames) if (f.t < take.waves[0].startMs) warm.push(f.v, f.t);
    expect(segment(take, { noise: warm }).traces).toHaveLength(5);
  });

  it('a take that starts mid-wave, seeded from mid-wave, yields no half wave', () => {
    const take = waveTake();
    const warm = createNoiseEstimator();
    for (const f of take.frames) if (f.t < take.waves[0].startMs) warm.push(f.v, f.t);
    const mid = take.waves[0].startMs + 500;
    const k = take.frames.findIndex((f) => f.t >= mid);
    const rest = { ...take, frames: take.frames.slice(k) };
    const { traces } = segment(rest, { noise: warm, seed: take.frames[k - 1] });
    expect(traces).toHaveLength(4);
    expect(traces[0].samples[0].t).toBeGreaterThan(take.waves[0].endMs);
  });

  it('is deterministic, resets to nothing, and ignores ids absent from the frame', () => {
    const take = waveTake({ seed: 7 });
    const a = segment(take, { features: [...POSITION, 'hand.left.wrist.x', 'hand.left.wrist.y'] });
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
  it('cuts the traces, keeps them per cue, and never feeds them to the noise or the vocabulary', () => {
    const take = waveTake();
    const session = createSession();
    const before = take.frames.filter((f) => f.t < take.waves[0].startMs - 300);
    const after = take.frames.slice(before.length);
    session.beginCue(REST);
    for (const f of before) session.push(f.v, f.t);
    session.endCue();
    session.beginCue(WAVE);
    const noiseFrames = session.noise().snapshot().frames;
    for (const f of after) session.push(f.v, f.t);
    expect(session.moved()).toBe(true);
    session.endCue();

    const traces = session.tracesFor(WAVE.id);
    expect(traces).toHaveLength(5);
    expect(traces.every((t) => t.gesture === 'wave' && t.cue === WAVE.id)).toBe(true);
    expect(session.traces()).toEqual(traces);
    expect(session.points()).toEqual([]);
    expect(session.ready()).toBe(false);
    expect(session.noise().snapshot().frames).toBe(noiseFrames);

    // Re-running the cue starts its take over.
    session.beginCue(WAVE);
    expect(session.tracesFor(WAVE.id)).toEqual([]);
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
