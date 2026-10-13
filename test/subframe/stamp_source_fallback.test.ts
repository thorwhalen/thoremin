/**
 * The predictor reads the stamp source (#318, timing plan step 9's rest).
 *
 * - Acceptance: with a timing resource whose dominant stamps are `estimated` and noisy
 *   (a slow machine's 30 ms), the air drum predicts nothing, sounds every stroke at its
 *   frame-snapped onset (the deepest sample's own time, when the camera has shown it),
 *   and says so in its status; with capture stamps it predicts as before.
 * - The standing has hysteresis, and an unknown noise keeps the standing it has.
 * - A `clock` stamp is moved back by the capture lag; an `estimated` one is not.
 * - The tracker measures the capture lag, the clock-derived stamps' noise, and whether
 *   the first stamp was a capture time; the host's runtime checks reach the status line.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayNode, type NodeContext } from '@thoremin/dag';
import type { HandsFrame } from '@/nodes';
import { airDrumNode, subframeStanding, deepestSampleTime, SUBFRAME_MAX_STAMP_NOISE_S, SUBFRAME_DWELL_FRAMES, type DrumHit, type AirDrumStatus } from '@thoremin/ext-air/nodes/air_drum';
import { describeSubframe } from '@thoremin/ext-air/app/airDrumStatus';
import { TimingTracker, stampNoise, CAPTURE_LAG_PRIOR_S, MIN_FRAMES_FOR_NOISE } from '@thoremin/sdk/timing/tracker';
import { describeTiming } from '@/app/timing/describe';
import { measureTimerResolution } from '@/app/timing/resource';
import { FIXTURES } from '../helpers/fixtures';
import { knownOutputStage } from '../helpers/timing';

function loadFrames(name: string) {
  const dir = join(FIXTURES, name);
  const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as { spec: { fps: number }; objects: { name: string; impact_keypoint: string }[]; events: { t_impact: number }[] };
  const obj = truth.objects[0];
  const frames: HandsFrame[] = [];
  for (const line of readFileSync(join(dir, 'keypoints.ndjson'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as { value: { width: number; height: number; keypoints: { object: string; name: string; x: number; y: number }[] } };
    const p = rec.value.keypoints.find((k) => k.object === obj.name && k.name === obj.impact_keypoint)!;
    frames.push({ width: rec.value.width, height: rec.value.height, hands: [{ handedness: 'Left', keypoints: Array.from({ length: 21 }, () => ({ x: p.x, y: p.y })) }] });
  }
  return { truth, frames };
}

const { truth, frames } = loadFrames('subframe_stick_surface_30');
const FPS = truth.spec.fps;

async function play(resources: Record<string, unknown>) {
  const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.03 }));
  const outs = await replayNode(h, { hands: frames }, { dt: 1 / FPS, resources });
  const hits = outs.flatMap((o, i) => (o.hits as DrumHit[]).map((hit) => ({ ...hit, tick: i })));
  return { hits, status: outs[outs.length - 1].status as AirDrumStatus };
}

describe('the air drum falls back to the frame-snapped onset when the stamps cannot carry a fit (#318)', () => {
  it('acceptance: dominant `estimated`, a large lag and 30 ms of stamp noise → no prediction, frame-snapped hits, said in the status', async () => {
    const noisy = knownOutputStage(0, 'measured', { dominantSource: 'estimated', stampNoise: 0.03, captureLag: { value: 0.06, source: 'measured' } });
    const { hits, status } = await play(noisy);
    expect(hits.length).toBe(truth.events.length);
    for (const hit of hits) {
      expect(hit.predicted === false || hit.lead <= 0).toBe(true);
      // Sounded when the camera showed it (the decision tick), never ahead of the impact.
      expect(hit.t).toBeCloseTo(hit.tick / FPS, 9);
      // The onset is a sample's own time: on the frame grid, not between frames.
      expect(Math.abs(hit.impactT * FPS - Math.round(hit.impactT * FPS))).toBeLessThan(1e-6);
      // Within a frame of the true impact (the frame-snapped detector's error).
      const e = truth.events.reduce((b, x) => (Math.abs(x.t_impact - hit.impactT) < Math.abs(b.t_impact - hit.impactT) ? x : b));
      expect(Math.abs(hit.impactT - e.t_impact)).toBeLessThanOrEqual(1 / FPS + 1e-9);
      // A full hit, not a ghost.
      expect(hit.velocity).toBeGreaterThan(0);
    }
    expect(status.subframe).toBe('off-stamps');
    expect(status.stampNoise).toBeCloseTo(0.03, 9);
    expect(describeSubframe(status)).toMatch(/Prediction off: .*30 ms of jitter/);
  });

  it('with capture stamps (or quiet clock stamps) it predicts as before', async () => {
    for (const over of [{ dominantSource: 'capture' }, { dominantSource: 'estimated', stampNoise: 0.001 }]) {
      const { hits, status } = await play(knownOutputStage(0, 'measured', over));
      expect(status.subframe).toBe('on');
      expect(describeSubframe(status)).toBeNull();
      expect(hits.slice(1).every((h) => h.predicted)).toBe(true);
    }
  });

  it('the standing has hysteresis; unknown noise or no frames keeps the standing', () => {
    expect(subframeStanding('on', 'estimated', SUBFRAME_MAX_STAMP_NOISE_S + 0.001)).toBe('off-stamps');
    expect(subframeStanding('off-stamps', 'estimated', 0.0035)).toBe('off-stamps'); // between the bounds
    expect(subframeStanding('on', 'estimated', 0.0035)).toBe('on');
    expect(subframeStanding('off-stamps', 'estimated', 0.002)).toBe('on');
    expect(subframeStanding('off-stamps', 'clock', NaN)).toBe('off-stamps');
    expect(subframeStanding('off-stamps', 'capture', 0.05)).toBe('on'); // capture stamps are truthful
    expect(subframeStanding('off-stamps', null, NaN)).toBe('off-stamps');
  });

  it('the frame-snapped onset is the deepest sample near the confirmation', () => {
    const recent = [0, 1, 2, 3, 4].map((i) => ({ t: i / 30, x: 0, y: [0.1, 0.3, 0.5, 0.45, 0.2][i] }));
    expect(deepestSampleTime(recent, 2.4 / 30)).toBeCloseTo(2 / 30, 12);
    expect(deepestSampleTime([], 0.5)).toBe(0.5);
    // A fast roll: the previous stroke was deeper, but it is not this stroke's bottom.
    const roll = [0.9, 0.5, 0.2, 0.4, 0.6, 0.55, 0.3].map((y, i) => ({ t: i / 30, x: 0, y }));
    expect(deepestSampleTime(roll, 4.3 / 30)).toBeCloseTo(4 / 30, 12);
  });

  it('a standing that flips mid-run neither loses a stroke nor plays one twice', async () => {
    const quiet = { ...knownOutputStage(0, 'measured', { dominantSource: 'estimated', stampNoise: 0.0005 }).timing() };
    const noisy = { ...quiet, stampNoise: 0.03 };
    for (const period of [20, 23, 31, 47]) {
      let tick = 0;
      // Alternate every `period` frames (past the dwell), so strokes straddle the flips.
      const resources = { timing: () => (Math.floor(tick++ / period) % 2 ? noisy : quiet) };
      const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.03 }));
      const outs = await replayNode(h, { hands: frames }, { dt: 1 / FPS, resources });
      const hits = outs.flatMap((o) => o.hits as DrumHit[]);
      expect(hits.length, `period ${period}`).toBe(truth.events.length);
      for (const e of truth.events) expect(hits.filter((h) => Math.abs(h.impactT - e.t_impact) < 0.06).length, `period ${period}, impact ${e.t_impact}`).toBe(1);
    }
  });

  it('a standing is taken only after the dwell: a few noisy frames change nothing', async () => {
    const quiet = knownOutputStage(0, 'measured', { dominantSource: 'estimated', stampNoise: 0.0005 }).timing();
    const noisy = { ...quiet, stampNoise: 0.03 };
    let tick = 0;
    // Noisy for a few frames short of the dwell, every 60 frames.
    const resources = { timing: () => (tick++ % 60 < SUBFRAME_DWELL_FRAMES - 2 ? noisy : quiet) };
    const { hits, status } = await play(resources);
    expect(status.subframe).toBe('on');
    expect(hits.slice(1).every((h) => h.predicted)).toBe(true);
  });
});

describe('a clock stamp is moved back by the capture lag, as the pump moves an estimated one', () => {
  const origin = performance.timeOrigin;
  /** The surface clip stamped as a browser would (honoured: real time, this document),
   *  every stamp `shift` seconds from the frame's tick. */
  const stamped = (tSource: 'clock' | 'estimated', shift: number) => frames.map((f, i) => ({ ...f, t: i / FPS + shift, tSource, tOrigin: origin }));
  async function impacts(tSource: 'clock' | 'estimated', shift: number, lag: number) {
    const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.03 }));
    const resources = { ...knownOutputStage(0, 'measured', { dominantSource: tSource, stampNoise: 0.0005, captureLag: { value: lag, source: 'measured' } }), timeScale: 1 };
    const outs = await replayNode(h, { hands: stamped(tSource, shift) }, { dt: 1 / FPS, resources });
    return outs.flatMap((o) => (o.hits as DrumHit[]).map((h) => [h.impactT, h.lead]));
  }
  it('a clock stamp at the tick with a 50 ms lag plays exactly as the pump\'s estimated stamp 50 ms back', async () => {
    const estimated = await impacts('estimated', -0.05, 0.05); // the pump already subtracted it
    const clock = await impacts('clock', 0, 0.05);
    const clockNoLag = await impacts('clock', 0, 0);
    expect(estimated.length).toBeGreaterThan(5);
    expect(clock.length).toBe(estimated.length);
    clock.forEach(([t, lead], i) => {
      expect(t).toBeCloseTo(estimated[i][0], 9);
      expect(lead).toBeCloseTo(estimated[i][1], 9);
    });
    // Without the lag the clock stamp would claim the impacts 50 ms later than they were.
    expect(clockNoLag.some(([t], i) => Math.abs(t - clock[i]?.[0]) > 0.01)).toBe(true);
  });
});

describe('the tracker: capture lag, stamp noise, the first stamp, the runtime checks', () => {
  const ctx = (tick: number, time: number) => ({ tick, time, resources: { timeScale: 1 } }) as unknown as NodeContext;
  const origin = performance.timeOrigin;
  function feed(tracker: TimingTracker, stamps: { t: number; tSource: 'capture' | 'estimated' | 'clock'; lag?: number }[]) {
    stamps.forEach((s, i) => tracker.onValue('cam.hands', { width: 1, height: 1, hands: [], t: s.t, tSource: s.tSource, tOrigin: origin, lag: s.lag }, ctx(i, s.t + 0.02)));
  }

  it('learns the capture lag from capture stamps, else reports the stated prior', () => {
    const prior = new TimingTracker({ now: () => 0 });
    feed(prior, Array.from({ length: 10 }, (_, i) => ({ t: 1 + i / 30, tSource: 'clock' as const })));
    expect(prior.reading().captureLag).toEqual({ value: CAPTURE_LAG_PRIOR_S, source: 'prior' });
    expect(prior.reading().captureTimeAvailable).toBe(null); // not enough frames to say no
    feed(prior, Array.from({ length: 30 }, (_, i) => ({ t: 2 + i / 30, tSource: 'clock' as const })));
    expect(prior.reading().captureTimeAvailable).toBe(false);
    const measured = new TimingTracker({ now: () => 0 });
    feed(measured, Array.from({ length: 10 }, (_, i) => ({ t: 1 + i / 30, tSource: 'capture' as const, lag: 0.012 })));
    expect(measured.reading().captureLag.source).toBe('measured');
    expect(measured.reading().captureLag.value).toBeCloseTo(0.012, 9);
    expect(measured.reading().captureTimeAvailable).toBe(true);
    // The pump's first frame comes through the animation-frame path (a clock stamp)
    // before the first video-frame callback: that must not read as "no captureTime".
    const late = new TimingTracker({ now: () => 0 });
    feed(late, [{ t: 1, tSource: 'clock' }, ...Array.from({ length: 40 }, (_, i) => ({ t: 1.1 + i / 30, tSource: 'capture' as const, lag: 0.01 }))]);
    expect(late.reading().captureTimeAvailable).toBe(true);
    expect(describeTiming(late.reading()).line).not.toMatch(/captureTime/);
  });

  it('measures the noise of clock-derived stamps, not of capture stamps', () => {
    let seed = 3;
    const gauss = () => {
      const u = ((seed = (seed * 16807) % 2147483647) / 2147483647) || 1e-9;
      const v = (seed = (seed * 16807) % 2147483647) / 2147483647;
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const grid = Array.from({ length: 80 }, (_, i) => 1 + i / 30);
    // A skipped frame now and then is a multiple of the period, not noise.
    const thinned = grid.filter((_, i) => i % 7 !== 3);
    expect(stampNoise(thinned)).toBeLessThan(1e-6);
    const noisy = thinned.map((t) => t + 0.004 * gauss());
    expect(stampNoise(noisy)).toBeGreaterThan(0.0025);
    expect(stampNoise(noisy)).toBeLessThan(0.006);
    const tracker = new TimingTracker({ now: () => 0 });
    feed(tracker, noisy.slice(0, MIN_FRAMES_FOR_NOISE - 1).map((t) => ({ t, tSource: 'estimated' as const })));
    expect(Number.isNaN(tracker.reading().stampNoise)).toBe(true); // not enough frames yet
    feed(tracker, noisy.slice(MIN_FRAMES_FOR_NOISE - 1).map((t) => ({ t, tSource: 'estimated' as const })));
    expect(tracker.reading().stampNoise).toBeGreaterThan(0.0025);
    // Against the CAMERA's period (the review's cases): a 24 fps camera whose clock stamps
    // are quantised to a 60 Hz display, and a 30 fps camera paced by a 50 ms inference.
    const vsync = (fps: number, n: number) => Array.from({ length: n }, (_, i) => Math.ceil((1 + i / fps) * 60) / 60);
    const v24 = vsync(24, 90);
    for (let k = 0; k + 60 <= v24.length; k += 5) expect(stampNoise(v24.slice(k, k + 60), 1 / 24)).toBeGreaterThan(SUBFRAME_MAX_STAMP_NOISE_S);
    const paced = Array.from({ length: 60 }, (_, i) => 1 + i * 0.05);
    expect(stampNoise(paced, 1 / 30)).toBeGreaterThan(SUBFRAME_MAX_STAMP_NOISE_S);
    // A 60 fps camera on a 60 Hz display, and a de-jittered run on a 30 fps lattice: quiet.
    expect(stampNoise(vsync(60, 60), 1 / 60)).toBeLessThan(0.001);
    expect(stampNoise(thinned, 1 / 30)).toBeLessThan(1e-6);
    const camera = new TimingTracker({ now: () => 0 });
    camera.setCamera({ frameRate: 24, width: 1280, height: 720 });
    feed(camera, v24.map((t) => ({ t, tSource: 'clock' as const })));
    expect(camera.reading().stampNoise).toBeGreaterThan(SUBFRAME_MAX_STAMP_NOISE_S);
    const truthful = new TimingTracker({ now: () => 0 });
    feed(truthful, noisy.map((t) => ({ t, tSource: 'capture' as const, lag: 0.01 })));
    expect(Number.isNaN(truthful.reading().stampNoise)).toBe(true);
  });

  it('carries the host runtime checks, and the status line names a coarse timer and a missing captureTime', () => {
    const tracker = new TimingTracker({ now: () => 0, runtime: { crossOriginIsolated: false, timerResolution: 0.001 } });
    feed(tracker, Array.from({ length: 40 }, (_, i) => ({ t: 1 + i / 30, tSource: 'clock' as const })));
    const r = tracker.reading();
    expect(r.runtime).toEqual({ crossOriginIsolated: false, timerResolution: 0.001 });
    expect(describeTiming(r).line).toMatch(/timer 1 ms \(not isolated\) · no captureTime$/);
    const fine = new TimingTracker({ now: () => 0, runtime: { crossOriginIsolated: false, timerResolution: 0.0001 } });
    feed(fine, Array.from({ length: 10 }, (_, i) => ({ t: 1 + i / 30, tSource: 'capture' as const, lag: 0.01 })));
    expect(describeTiming(fine.reading()).line).not.toMatch(/timer|captureTime/);
  });

  it('measures a clock\'s resolution', () => {
    let t = 0;
    expect(measureTimerResolution(() => (t += 0.4) - ((t * 1000) % 1000) / 1000, 50)).toBeCloseTo(0.001, 6);
    let u = 0;
    expect(measureTimerResolution(() => (u += 0.005), 1)).toBeCloseTo(0.000005, 9);
    expect(Number.isNaN(measureTimerResolution(() => 7, 1))).toBe(true);
  });
});
