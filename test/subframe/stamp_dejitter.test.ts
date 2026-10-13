/**
 * The gated de-jitter of the frame capture stamps (step 9 of the 2026-10-05 timing
 * plan; #226): a jittered clock is moved onto the camera's grid, a capture stamp is
 * never touched (byte for byte), and stamps that already sit on a grid — the
 * sample-and-hold pairs of the `raf-poll` regime above all — keep the gate shut.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sample } from '@thoremin/ictus';
import { createStampDejitter, DEJITTER_MIN_FRAMES, DEJITTER_MIN_JITTER_MS, DEJITTER_WINDOW_FRAMES } from '@thoremin/sdk/timing/stamp_dejitter';
import { createFramePump, type FrameStamp } from '@/nodes/sources/frame_pump';
import { dejitterStamps, pollAtVsync, stampSourceOfRegime } from '../../scripts/subframe/stamps';
import { FIXTURES } from '../helpers/fixtures';

// ---- Fixtures ---------------------------------------------------------------------

/** mulberry32, so every run sees the same jitter. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussian = (next: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, next()))) * Math.cos(2 * Math.PI * next());

const PERIOD_MS = 1000 / 30;
/** The bench's stamp-noise regime at 30 fps: 4 ms of noise on a regular camera. */
const NOISE_MS = 4;
/** The clock reads the frame this long after its capture (the pipeline's offset). */
const OFFSET_MS = 20;

/** A regular 30 fps camera's grid (ms), `n` frames from `t0`. */
const grid = (n: number, t0 = 1000): number[] => Array.from({ length: n }, (_, i) => t0 + i * PERIOD_MS);
/** A jittered clock reading of each grid time: the offset plus seeded Gaussian noise. */
function jitteredClock(gridMs: number[], seed: number, sd = NOISE_MS): number[] {
  const next = rng(seed);
  return gridMs.map((t) => t + OFFSET_MS + sd * gaussian(next));
}
const diffs = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);
const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
/** Root-mean-square distance from the grid, after removing the mean offset. */
function rmsFromGrid(stamps: number[], gridMs: number[]): number {
  const errs = stamps.map((t, i) => t - gridMs[i]);
  const m = errs.reduce((a, b) => a + b, 0) / errs.length;
  return Math.sqrt(errs.reduce((a, b) => a + (b - m) ** 2, 0) / errs.length);
}

function loadFixtureSamples(name: string): Sample[] {
  const dir = join(FIXTURES, name);
  const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as { objects: { name: string; impact_keypoint: string }[] };
  const obj = truth.objects[0];
  const samples: Sample[] = [];
  for (const line of readFileSync(join(dir, 'keypoints.ndjson'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as { t: number; value: { keypoints: { object: string; name: string; x: number; y: number }[] } };
    const p = rec.value.keypoints.find((k) => k.object === obj.name && k.name === obj.impact_keypoint)!;
    samples.push({ t: rec.t, x: p.x, y: p.y });
  }
  return samples;
}

// ---- The jittered clock -----------------------------------------------------------

describe('stamp de-jitter on a jittered clock', () => {
  const N = 120;
  const truth = grid(N);
  const raw = jitteredClock(truth, 7);

  it('tightens the period estimate and never lets a stamp regress', () => {
    const dj = createStampDejitter();
    const out = raw.map((t) => dj.push(t, 'clock').tMs);
    // Strictly increasing by at least the step, every frame.
    for (let i = 1; i < out.length; i++) expect(out[i] - out[i - 1]).toBeGreaterThanOrEqual(1);
    // The first frames pass through (nothing to fit yet); then the line engages.
    for (let i = 0; i < DEJITTER_MIN_FRAMES - 1; i++) expect(out[i]).toBe(raw[i]);
    expect(dj.state().engaged).toBe(true);
    // The fit knows the camera: its period within a quarter millisecond of 33.3, its
    // jitter estimate the noise that was put in.
    expect(Math.abs(dj.state().periodMs - PERIOD_MS)).toBeLessThan(0.25);
    expect(dj.state().jitterMs).toBeGreaterThan(NOISE_MS * 0.6);
    expect(dj.state().jitterMs).toBeLessThan(NOISE_MS * 1.5);
    // The frame-to-frame period of the stamps is far steadier (the raw clock's
    // differences carry sqrt(2) times the noise), and the stamps sit far closer to
    // the camera's grid, after the window has filled.
    const settled = DEJITTER_WINDOW_FRAMES;
    expect(sd(diffs(out.slice(settled)))).toBeLessThan(0.5 * sd(diffs(raw.slice(settled))));
    expect(rmsFromGrid(out.slice(settled), truth.slice(settled))).toBeLessThan(0.6 * rmsFromGrid(raw.slice(settled), truth.slice(settled)));
  });

  it('uses the line as it is: a stamp may sit a little past the reading that noticed it', () => {
    const dj = createStampDejitter();
    const out = raw.map((t) => dj.push(t, 'clock').tMs);
    expect(out.some((t, i) => t > raw[i])).toBe(true);
    expect(rmsFromGrid(out.slice(DEJITTER_WINDOW_FRAMES), truth.slice(DEJITTER_WINDOW_FRAMES))).toBeLessThan(1.5);
  });

  it('capped at the raw reading (the comparison variant), no stamp is later than the clock read it', () => {
    const dj = createStampDejitter({ clampToRaw: true });
    const out = raw.map((t) => dj.push(t, 'clock').tMs);
    out.forEach((t, i) => expect(t).toBeLessThanOrEqual(raw[i]));
    for (let i = 1; i < out.length; i++) expect(out[i] - out[i - 1]).toBeGreaterThanOrEqual(1);
    expect(dj.state().engaged).toBe(true);
  });

  it('infers the frame index across a busy machine: 33 / 67 ms pacing keeps the period at 33', () => {
    // Inference-paced: every other frame is skipped for a stretch (the plan's slow
    // laptop), so the gaps alternate; the line must not read that as a 50 ms camera.
    const kept = truth.filter((_, i) => i < 20 || i % 2 === 0 || i % 3 === 0);
    const rawKept = jitteredClock(kept, 11);
    const dj = createStampDejitter();
    rawKept.forEach((t) => dj.push(t, 'clock'));
    expect(dj.state().engaged).toBe(true);
    expect(Math.abs(dj.state().periodMs - PERIOD_MS)).toBeLessThan(0.5);
  });

  it('finds the lattice when the run opens on a skipped frame: a 67 ms first gap is two steps, not a 67 ms camera', () => {
    // No regular lead-in: the stream alternates 33 / 67 from its first gap (and so did
    // the bench's inference-paced nominal stamps, where a seed taken from the first gap
    // read a 50 ms camera, bent the line and opened the gate on regular stamps).
    const paced = truth.filter((_, i) => i % 3 !== 1);
    const regular = createStampDejitter();
    paced.forEach((t) => expect(regular.push(t, 'clock').engaged).toBe(false));
    expect(Math.abs(regular.state().periodMs - PERIOD_MS)).toBeLessThan(0.01);
    expect(regular.state().jitterMs).toBeLessThan(0.01);
    const noisy = createStampDejitter();
    jitteredClock(paced, 17).forEach((t) => noisy.push(t, 'clock'));
    expect(noisy.state().engaged).toBe(true);
    expect(Math.abs(noisy.state().periodMs - PERIOD_MS)).toBeLessThan(0.5);
    expect(noisy.state().jitterMs).toBeLessThan(1.5 * NOISE_MS);
  });

  it('finds a lattice finer than any gap: a 60 fps camera paced by inference (gaps of two and three frames)', () => {
    const sixty = Array.from({ length: 200 }, (_, i) => 1000 + (i * 1000) / 60);
    // Every third frame, then every second: 33 and 50 ms gaps, never 16.7.
    const paced = sixty.filter((_, i) => i % 5 === 0 || i % 5 === 2);
    const regular = createStampDejitter();
    paced.forEach((t) => expect(regular.push(t, 'clock').engaged).toBe(false));
    expect(Math.abs(regular.state().periodMs - 1000 / 60)).toBeLessThan(0.01);
    const noisy = createStampDejitter();
    jitteredClock(paced, 23, 2).forEach((t) => noisy.push(t, 'clock'));
    expect(noisy.state().engaged).toBe(true);
    expect(Math.abs(noisy.state().periodMs - 1000 / 60)).toBeLessThan(0.3);
  });

  it('engages on estimated stamps too, and a run from one source never bends on the other', () => {
    // Capture stamps (the camera's own grid), then a hidden tab: clock stamps a lag
    // later. The clock run starts fresh — its first frames pass through, and the fit
    // that follows is the clock run's own.
    const dj = createStampDejitter();
    const captureOut = truth.slice(0, 40).map((t) => dj.push(t, 'capture'));
    captureOut.forEach((r, i) => expect(r).toEqual({ tMs: truth[i], source: 'capture', engaged: false }));
    const clockRaw = jitteredClock(truth.slice(40), 5);
    const clockOut = clockRaw.map((t) => dj.push(t, 'estimated'));
    for (let i = 0; i < DEJITTER_MIN_FRAMES - 1; i++) expect(clockOut[i].tMs).toBe(clockRaw[i]);
    expect(clockOut[clockOut.length - 1].engaged).toBe(true);
    expect(clockOut[clockOut.length - 1].source).toBe('estimated');
    expect(Math.abs(dj.state().periodMs - PERIOD_MS)).toBeLessThan(0.5);
    const all = [...captureOut, ...clockOut].map((r) => r.tMs);
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1]).toBeGreaterThanOrEqual(1);
  });

  it('retract undoes a push: a frame offered again is the same frame, not the next on the grid', () => {
    const a = createStampDejitter();
    const b = createStampDejitter();
    raw.slice(0, 40).forEach((t) => {
      a.push(t, 'clock');
      b.push(t, 'clock');
    });
    a.push(raw[40] + 0.4, 'clock');
    a.retract();
    // Nothing to undo twice.
    a.retract();
    expect(a.state()).toEqual(b.state());
    expect(a.push(raw[40], 'clock')).toEqual(b.push(raw[40], 'clock'));
    expect(a.push(raw[41], 'clock')).toEqual(b.push(raw[41], 'clock'));
  });

  it('refuses a window too small to fit, or a minimum below three points', () => {
    expect(() => createStampDejitter({ windowFrames: 1 })).toThrow(RangeError);
    expect(() => createStampDejitter({ minFrames: 2 })).toThrow(RangeError);
    expect(() => createStampDejitter({ windowFrames: 4, minFrames: 5 })).toThrow(RangeError);
  });
});

// ---- The gate ---------------------------------------------------------------------

describe('stamp de-jitter under attack (the #319 review)', () => {
  /** A 30 fps clock with noise from `noise(next)` (ms), kept increasing like the pump's. */
  function clockRun(seed: number, n: number, noise: (next: () => number) => number, spike = 0): number[] {
    const next = rng(seed);
    const out: number[] = [];
    let last = -Infinity;
    for (let i = 0; i < n; i++) {
      let t = 1000 + i * PERIOD_MS + OFFSET_MS + noise(next) + (spike > 0 && next() < spike ? 25 + 20 * next() : 0);
      if (t < last + 1) t = last + 1;
      out.push(t);
      last = t;
    }
    return out;
  }

  it('one-sided delivery noise: the output sits closer to the camera, and rarely on a finer lattice', () => {
    let engaged = 0;
    let finer = 0;
    const errRaw: number[] = [];
    const errOut: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const dj = createStampDejitter();
      clockRun(seed, 200, (next) => -2 * Math.log(Math.max(1e-12, next()))).forEach((t, i) => {
        const r = dj.push(t, 'clock');
        if (i < DEJITTER_WINDOW_FRAMES) return;
        const truth = 1000 + i * PERIOD_MS;
        errRaw.push(t - truth);
        errOut.push(r.tMs - truth);
        if (!r.engaged) return;
        engaged++;
        // A 60 fps lattice under a 30 fps camera is a camera rate too, and fits nearly the
        // same line with every index doubled; it is counted, not forbidden.
        if (dj.state().periodMs < 0.75 * PERIOD_MS) finer++;
      });
    }
    expect(engaged).toBeGreaterThan(3000);
    expect(finer / engaged).toBeLessThan(0.05);
    expect(sd(errOut)).toBeLessThan(0.5 * sd(errRaw));
  });

  it('a 30 fps camera delivered on a 75 Hz display: the camera\'s period, not the beat pattern\'s 22 ms', () => {
    // Frames at 33.3 ms delivered at the next 13.3 ms vsync: gaps of 40 and 26.7 ms.
    const vsync = 1000 / 75;
    const stamps = Array.from({ length: 120 }, (_, i) => Math.ceil((i * PERIOD_MS + 0.5) / vsync) * vsync + 1000);
    const dj = createStampDejitter();
    const out = stamps.map((t) => dj.push(t, 'clock').tMs);
    expect(Math.abs(dj.state().periodMs - PERIOD_MS)).toBeLessThan(0.1);
    const truth = (i: number) => 1000 + i * PERIOD_MS;
    const settled = (xs: number[]) => xs.slice(DEJITTER_WINDOW_FRAMES).map((x, k) => x - truth(k + DEJITTER_WINDOW_FRAMES));
    expect(sd(settled(out))).toBeLessThan(0.5 * sd(settled(stamps)));
  });

  it('a repeating eight-frame jitter holds the camera\'s period: no lattice is finer than a 60 fps camera', () => {
    const jit = [1.5, -1.5, 2, -2, 0.5, -0.5, 1.8, -1.2];
    const dj = createStampDejitter();
    for (let i = 0; i < 100; i++) dj.push(1000 + i * PERIOD_MS + OFFSET_MS + jit[i % jit.length], 'clock');
    expect(Math.abs(dj.state().periodMs - PERIOD_MS)).toBeLessThan(0.1);
  });

  it('with delivery spikes, no output sits more than half a period from its reading, and outputs keep increasing', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const dj = createStampDejitter();
      let prev = -Infinity;
      for (const t of clockRun(seed, 120, (next) => 2 * Math.abs(gaussian(next)), 0.05)) {
        const r = dj.push(t, 'clock');
        // The floor may lift a reading past a replaced stamp by at most the step.
        expect(Math.abs(r.tMs - t)).toBeLessThanOrEqual(PERIOD_MS / 2 + 1);
        expect(r.tMs - prev).toBeGreaterThanOrEqual(1);
        prev = r.tMs;
      }
    }
  });

  it('a pass-through after a replaced stamp is floored, so the module alone never steps back', () => {
    const dj = createStampDejitter();
    let prev = -Infinity;
    const run = clockRun(5, 60, (next) => 3 * gaussian(next));
    // A run of clock stamps, then a jump to a regular (gate-shut) clock that starts just behind.
    const tail = Array.from({ length: 10 }, (_, i) => run[run.length - 1] + 0.2 + i * PERIOD_MS);
    for (const t of [...run, ...tail]) {
      const r = dj.push(t, 'clock');
      expect(r.tMs - prev).toBeGreaterThanOrEqual(1);
      prev = r.tMs;
    }
  });
});

describe('stamp de-jitter gate', () => {
  it('a capture stamp is a pass-through, byte for byte, however jittered the camera is', () => {
    // The bench's capture-jitter-actual regime: an irregular camera reported truthfully.
    const next = rng(3);
    const irregular = grid(100).map((t) => t + 0.08 * PERIOD_MS * gaussian(next)).sort((a, b) => a - b);
    const dj = createStampDejitter();
    irregular.forEach((t) => expect(dj.push(t, 'capture')).toEqual({ tMs: t, source: 'capture', engaged: false }));
    expect(dj.state()).toEqual({ frames: 0, periodMs: NaN, jitterMs: NaN, engaged: false });
    // And the compositor's own time for a frame is a measurement too.
    const pres = createStampDejitter();
    irregular.forEach((t) => expect(pres.push(t, 'presentation').tMs).toBe(t));
  });

  it('a regular clock (the pump tests\' clocks; a 1 ms-rounded capture time) passes through', () => {
    const dj = createStampDejitter();
    grid(100).forEach((t) => expect(dj.push(t, 'clock').tMs).toBe(t));
    expect(dj.state().engaged).toBe(false);
    expect(dj.state().jitterMs).toBeLessThan(DEJITTER_MIN_JITTER_MS);
    // Safari's arrival stamps rounded to the millisecond: sd 0.29 ms, under the floor.
    const rounded = createStampDejitter();
    grid(100).forEach((t) => expect(rounded.push(Math.round(t), 'estimated').tMs).toBe(Math.round(t)));
    expect(rounded.state().engaged).toBe(false);
  });

  it('a jitter floor of 0 opens the gate on any run of clock stamps', () => {
    const dj = createStampDejitter({ minJitterMs: 0 });
    const out = grid(40).map((t) => dj.push(t, 'clock'));
    expect(out[out.length - 1].engaged).toBe(true);
  });

  it('stays shut on sample-and-hold stamps (the raf-poll regime): no line is fitted to a vsync', () => {
    const samples = loadFixtureSamples('subframe_stick_air_30');
    const polled = pollAtVsync(samples, 60);
    // Two vsync samples per camera frame, positions held.
    expect(polled.length).toBeGreaterThanOrEqual(2 * samples.length - 1);
    expect(polled[1]).toEqual({ ...samples[0], t: samples[0].t + 1 / 60 });
    expect(diffs(polled.map((s) => s.t)).every((d) => Math.abs(d - 1 / 60) < 1e-9)).toBe(true);
    const out = dejitterStamps(polled, stampSourceOfRegime('raf-poll'));
    expect(out.length).toBe(polled.length);
    out.forEach((s, i) => expect(s).toBe(polled[i]));
    // Nor with the sub-millisecond jitter a real vsync has.
    const next = rng(9);
    const jittery = polled.map((s) => ({ ...s, t: s.t + 0.0003 * gaussian(next) }));
    const dj = createStampDejitter();
    jittery.forEach((s) => expect(dj.push(1000 * s.t, 'clock').engaged).toBe(false));
  });

  it('the capture-stamp regimes of the bench come out byte-identical (the scorer\'s own check)', () => {
    for (const name of ['subframe_stick_air_30', 'subframe_stick_surface_30', 'subframe_ball_air_60']) {
      const samples = loadFixtureSamples(name);
      for (const regime of ['exact', 'capture-jitter-actual']) {
        const out = dejitterStamps(samples, stampSourceOfRegime(regime));
        expect(JSON.stringify(out)).toBe(JSON.stringify(samples));
        out.forEach((s, i) => expect(s).toBe(samples[i]));
      }
    }
  });

  it('the clock-stamp regimes of the bench engage, and the stream stays causal and increasing', () => {
    const samples = loadFixtureSamples('subframe_stick_air_30');
    const next = rng(21);
    const noisy = samples.map((s) => ({ ...s, t: s.t + (NOISE_MS / 1000) * gaussian(next) })).sort((a, b) => a.t - b.t);
    const out = dejitterStamps(noisy, stampSourceOfRegime('stamp-noise'));
    expect(out.some((s, i) => s !== noisy[i])).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThan(out[i - 1].t);
    expect(() => stampSourceOfRegime('no-such-regime')).toThrow();
  });
});

// ---- In the pump ------------------------------------------------------------------

describe('the frame pump with the de-jitter', () => {
  interface FakeVideo {
    readyState: number;
    videoWidth: number;
    currentTime: number;
  }
  /** The pre-#226 path (no video frame callback) on a jittered clock: every frame is
   *  noticed by the animation loop a jittered offset after its capture. */
  function run(dejitter: boolean): { raw: number[]; got: FrameStamp[] } {
    const video: FakeVideo = { readyState: 4, videoWidth: 640, currentTime: 0 };
    let pending: (() => void) | null = null;
    let clock = 0;
    const got: FrameStamp[] = [];
    const pump = createFramePump(() => video as unknown as HTMLVideoElement, (stamp) => void got.push(stamp), {
      now: () => clock,
      requestAnimationFrame: (cb) => {
        pending = cb;
        return 1;
      },
      cancelAnimationFrame: () => void (pending = null),
      dejitter,
    });
    pump.start();
    const truth = grid(90, 5000);
    const raw = jitteredClock(truth, 13);
    raw.forEach((t, i) => {
      video.currentTime = truth[i] / 1000;
      clock = t;
      const cb = pending!;
      pending = null;
      cb();
    });
    pump.stop();
    return { raw, got };
  }

  it('moves clock stamps onto the grid, keeps them increasing, and says they are still clock stamps', () => {
    const { raw, got } = run(true);
    expect(got.length).toBe(raw.length);
    const stamps = got.map((s) => s.tMs);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(1);
    expect(got.every((s) => s.source === 'clock')).toBe(true);
    expect(sd(diffs(stamps.slice(DEJITTER_WINDOW_FRAMES)))).toBeLessThan(0.5 * sd(diffs(raw.slice(DEJITTER_WINDOW_FRAMES))));
    // The lag reported is the distance from the stamp to the clock reading: a few
    // milliseconds either way once the line has replaced the reading.
    got.forEach((s, i) => expect(s.lagMs).toBeCloseTo(raw[i] - s.tMs, 9));
    expect(Math.max(...got.map((s) => Math.abs(s.lagMs)))).toBeLessThan(4 * NOISE_MS);
  });

  it('switched off, the stamps are the clock, as before', () => {
    const { raw, got } = run(false);
    got.forEach((s, i) => expect(s).toEqual({ tMs: raw[i], source: 'clock', lagMs: 0, skipped: 0 }));
  });
});
