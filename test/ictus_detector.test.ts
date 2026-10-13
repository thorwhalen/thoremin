/**
 * The ictus detector (packages/ictus/src/detector.ts) and the whole facade, on a synthetic stroke
 * and on the recorded conducting-pattern fixtures.
 *
 * Synthetic: a smooth up-down stroke whose bottom (the ictus) lands BETWEEN 30 Hz
 * frames, so the sub-frame refinement is what the timing assertion tests; the top of
 * the stroke must never fire; a tiny wiggle must not fire.
 *
 * Fixtures: `test/fixtures/conducting_{44,34,24}` are 13-15 s excerpts of a conductor
 * beating 4/4, 3/4 and 2/4 patterns at a STATED 70 bpm (see each `meta.json`). The
 * reference grid is built from the stated tempo alone — only its phase is fitted to
 * the detections (`fitGrid`) — so a detector that fires at the wrong rate cannot pass.
 * What is asserted is the MIR beat-tracking F-measure and the median inter-anchor
 * interval; the oscillator's locked tempo on the same stream is asserted too.
 */
import { describe, it, expect } from 'vitest';
import { createAdaptiveOscillator, createIctus, createIctusDetector, fMeasure, fitGrid, medianInterval, type Anchor, type OscillatorOptions, type Sample } from '@thoremin/ictus';
import { gaussian, seeded } from './helpers/random';
import type { HandsFrame } from '@/nodes';
import { loadStream } from './helpers/fixtures';

const FPS = 30;

/** A smooth conducting-like stroke: y (image coords, down = +) is lowest at t = k*T,
 *  with a little lateral sway. The ictus times are exactly k*T + phase. */
function stroke(t: number, period: number, phase: number, amp = 100): { x: number; y: number } {
  const u = (2 * Math.PI * (t - phase)) / period;
  return { x: 300 + 20 * Math.sin(u / 2), y: 300 + amp * (Math.cos(u) + 1) / 2 };
}

function synthetic(period: number, phase: number, seconds: number, amp = 100): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i * (1 / FPS) <= seconds; i++) {
    const t = i / FPS;
    out.push({ t, ...stroke(t, period, phase, amp) });
  }
  return out;
}

describe('ictus detector (synthetic stroke)', () => {
  it('fires once per stroke at the bottom, within 8 ms of the true ictus (sub-frame)', () => {
    const period = 0.7;
    const phase = 0.0123; // deliberately between frames
    const det = createIctusDetector();
    const anchors = synthetic(period, phase, 6).map((s) => det.push(s)).filter((a) => a !== null);
    const times = anchors.map((a) => a!.t);
    // The first stroke has no measured top; everything after fires.
    expect(times.length).toBeGreaterThanOrEqual(7);
    for (const t of times) {
      const k = Math.round((t - phase) / period);
      expect(Math.abs(t - (phase + k * period))).toBeLessThan(0.008);
    }
    expect(medianInterval(times)).toBeCloseTo(period, 2);
  });

  it('the zero-crossing mode agrees on the count and lands within a frame', () => {
    const period = 0.7;
    const det = createIctusDetector({ mode: 'zeroCrossing' });
    const times = synthetic(period, 0.02, 6)
      .map((s) => det.push(s))
      .filter((a) => a !== null)
      .map((a) => a!.t);
    expect(times.length).toBeGreaterThanOrEqual(7);
    for (const t of times) {
      const k = Math.round((t - 0.02) / period);
      expect(Math.abs(t - (0.02 + k * period))).toBeLessThan(1 / FPS);
    }
  });

  it('never fires at the top of the stroke', () => {
    const period = 0.8;
    const det = createIctusDetector();
    const times = synthetic(period, 0, 6)
      .map((s) => det.push(s))
      .filter((a) => a !== null)
      .map((a) => a!.t);
    for (const t of times) {
      const frac = ((t % period) + period) % period;
      // Tops are at half-period; a detection there is a sign bug.
      expect(Math.abs(frac - period / 2)).toBeGreaterThan(0.1);
    }
  });

  it('a small wiggle after big strokes does not beat (relative amplitude gate)', () => {
    const det = createIctusDetector();
    const big = synthetic(0.7, 0, 4.55, 100); // ends at a TOP, so the last bottom is confirmed before the wiggle
    for (const s of big) det.push(s);
    const t0 = big[big.length - 1].t + 1 / FPS;
    let fired = 0;
    for (let i = 0; i * (1 / FPS) <= 4; i++) {
      const t = t0 + i / FPS;
      const s = stroke(t, 0.7, 0, 5); // 5% of the previous amplitude
      if (det.push({ t, ...s })) fired++;
    }
    expect(fired).toBe(0);
  });

  it('a player who starts beating much smaller can beat again within seconds (the envelope decays)', () => {
    const det = createIctusDetector();
    for (const s of synthetic(0.7, 0, 4.55, 100)) det.push(s);
    const t0 = 4.55 + 1 / FPS;
    const fired: number[] = [];
    for (let i = 0; i * (1 / FPS) <= 20; i++) {
      const t = t0 + i / FPS;
      if (det.push({ t, ...stroke(t, 0.7, 0, 15) })) fired.push(t - t0);
    }
    // 15% of the earlier amplitude is below the 20% envelope gate at first; once the
    // envelope has decayed it beats every stroke.
    expect(fired.length).toBeGreaterThan(10);
    expect(fired[0]).toBeLessThan(12);
    expect(det.envelope()).toBeLessThan(30);
  });

  it('strength and sharpness describe the stroke: a bigger stroke reads > 1, a sharper one reads higher', () => {
    const det = createIctusDetector();
    for (const s of synthetic(0.7, 0, 3.5, 60)) det.push(s);
    // Now a stroke twice as big: the first anchor of the new size should read ~2.
    let first = null;
    for (const s of synthetic(0.7, 0, 3.5, 120).map((s) => ({ ...s, t: s.t + 3.6 }))) {
      const a = det.push(s);
      if (a && !first) first = a;
    }
    expect(first).not.toBeNull();
    expect(first!.strength).toBeGreaterThan(1.5);
    expect(Number.isFinite(first!.sharpness)).toBe(true);
    expect(first!.sharpness).toBeGreaterThan(0);
  });

  it('the facade goes ready → running and reports a tempo near the stroke rate', () => {
    const period = 0.7;
    const ictus = createIctus();
    let last = ictus.state();
    for (const s of synthetic(period, 0.01, 8)) last = ictus.feed(s);
    expect(last.state).toBe('running');
    expect(last.tempo).toBeCloseTo(60 / period, 0);
    expect(last.confidence).toBeGreaterThan(0.6);
    expect(last.dynamics).toBeGreaterThan(0.5);
  });
});

// ---- recorded conducting patterns --------------------------------------------

interface Meta {
  statedBpm: number;
  pattern: string;
  fps: number;
}

function loadFixture(scenario: string): { samples: Sample[]; meta: Meta } {
  const frames = loadStream(scenario, 'src.hands') as HandsFrame[];
  const meta = JSON.parse(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures', scenario, 'meta.json'), 'utf8'),
  ) as Meta;
  const samples: Sample[] = [];
  frames.forEach((f, i) => {
    if (!f.hands.length) return;
    // The conductor beats with both hands mirrored; track the wrist of the hand that
    // MediaPipe labels Right (raw video: her left hand), falling back to whichever is
    // there. Normalised by the frame height so the units are "frames".
    const hand = f.hands.find((h) => h.handedness === 'Right') ?? f.hands[0];
    const wrist = hand.keypoints[0];
    samples.push({ t: i / meta.fps, x: wrist.x / f.height, y: wrist.y / f.height });
  });
  return { samples, meta };
}

function detect(samples: Sample[]) {
  const ictus = createIctus();
  const times: number[] = [];
  /** The follower's prediction of the NEXT beat, made at each anchor (§2.8: score the
   *  predictions, not just the detections). */
  const predicted: number[] = [];
  const statesAtAnchors: string[] = [];
  /** The anchors themselves, with the detector's confidences. */
  const anchors: Anchor[] = [];
  let last = ictus.state();
  let atLastAnchor = last;
  for (const s of samples) {
    last = ictus.feed(s);
    if (last.anchor) {
      times.push(last.anchor.t);
      anchors.push(last.anchor);
      statesAtAnchors.push(last.state);
      if (Number.isFinite(last.nextBeatAt)) predicted.push(last.nextBeatAt);
      atLastAnchor = last;
    }
  }
  return { times, anchors, last, atLastAnchor, predicted, statesAtAnchors };
}

describe.each(['conducting_44', 'conducting_34', 'conducting_24'])('%s (stated 70 bpm)', (scenario) => {
  const { samples, meta } = loadFixture(scenario);
  const period = 60 / meta.statedBpm;
  const { times, anchors, last, atLastAnchor, predicted, statesAtAnchors } = detect(samples);
  // Score over the span the detector was beating: first anchor to last anchor.
  const first = times[0];
  const lastT = times[times.length - 1];
  const fit = fitGrid(times, meta.statedBpm, first, lastT + 1e-6);

  it('finds about one anchor per stated beat over the beating span', () => {
    const expected = (lastT - first) / period + 1;
    expect(times.length).toBeGreaterThanOrEqual(7);
    expect(Math.abs(times.length - expected) / expected).toBeLessThan(0.2);
  });

  it('the mean inter-anchor interval is the stated period within 5% (the bar-level tempo)', () => {
    // The median is NOT asserted: this conductor gives the downbeat stroke ~1.05 s and the
    // inner beats ~0.7 s while keeping the bar at 70 bpm — real, and what the meter
    // recogniser (PR 6) is for. The mean over the span is the tempo she is keeping.
    const mean = (lastT - first) / (times.length - 1);
    expect(Math.abs(mean - period) / period).toBeLessThan(0.05);
  });

  it('F-measure against the stated-tempo grid: >= 0.7 at the mir_eval continuity tolerance (17.5% of a beat), >= 0.85 at 30%', () => {
    // A metronomic grid vs a human conductor whose inner beats are uneven: the phase
    // error accumulates to ~0.2 s after her long downbeat and recovers over the bar.
    // In 2/4 the alternation is at its most extreme (~1.05 s then ~0.65 s), so the
    // 17.5% bound is asserted for the three- and four-beat patterns only.
    if (scenario !== 'conducting_24') expect(fMeasure(fit.grid, times, 0.175 * period)).toBeGreaterThanOrEqual(0.7);
    expect(fMeasure(fit.grid, times, 0.3 * period)).toBeGreaterThanOrEqual(0.85);
    // And at the strict ±70 ms window it is well above chance.
    expect(fit.fMeasure).toBeGreaterThan(0.45);
  });

  // The 2/4 excerpt lost its lock between #231 and #232: the raw-sample timing moved
  // three anchors by 10 to 15 ms, and with this clip's alternating ~1.05 s / ~0.65 s
  // beats the oscillator's lost-lock rule (two consecutive phase errors past
  // `lostPhaseError`) fired and re-seeded at half tempo (41.7 bpm, `running`, never
  // `hold`, predictions F 0.40). #232 made a lost lock require misses at AGREEING
  // intervals (a tempo jump repeats its new interval; a long-short pattern does not),
  // which holds this lock in 200 of 200 runs under 10 ms of anchor jitter (below).
  it('the oscillator is running at most anchors, reports the stated tempo within 10% at the last beat, and enters hold when she stops', () => {
    const runningFraction = statesAtAnchors.filter((st) => st === 'running').length / statesAtAnchors.length;
    expect(runningFraction).toBeGreaterThanOrEqual(0.75);
    expect(Math.abs(atLastAnchor.tempo - meta.statedBpm) / meta.statedBpm).toBeLessThan(0.1);
    // Every clip ends with the conductor lowering her hands: the follower must notice.
    expect(last.state).toBe('hold');
  });

  it('the follower PREDICTS the next beat: predictions score against the grid too', () => {
    // The prediction made at each anchor for the beat after it, scored like the detections.
    // Looser than the detections by construction (a prediction carries the period error),
    // and the 2/4 clip's alternating long/short beats are the hardest case.
    expect(predicted.length).toBeGreaterThan(5);
    const f30 = fMeasure(fit.grid, predicted, 0.3 * period);
    expect(f30).toBeGreaterThanOrEqual(scenario === 'conducting_24' ? 0.5 : 0.6);
  });

  if (scenario === 'conducting_24') {
    it('the 2/4 lock holds under 10 ms of anchor jitter with the interval-agreement rule, and is lost without it (#232)', () => {
      // The fixture's own anchors (the detector's confidences included), jittered: the
      // test the #231 review ran by hand (the old rule held 0 of 200 at 5 ms). Fed to
      // the prior alone, so the detector cannot hide an oscillator change.
      const held = (options: OscillatorOptions, jitter: number, runs: number, set: Anchor[] = anchors, last = lastT) => {
        let ok = 0;
        for (let run = 0; run < runs; run++) {
          const next = seeded(run * 7919 + 1);
          const osc = createAdaptiveOscillator(options);
          for (const a of set) {
            const t = a.t + jitter * gaussian(next);
            osc.advance(t - 0.01);
            osc.update({ ...a, t });
          }
          const tempo = osc.state().tempo;
          osc.advance(last + 3);
          if (Math.abs(tempo - meta.statedBpm) / meta.statedBpm < 0.1 && osc.state().state === 'hold') ok++;
        }
        return ok;
      };
      expect(held({}, 0.005, 100)).toBe(100);
      expect(held({}, 0.01, 100)).toBe(100);
      // The pre-#232 rule, selectable, is the fragile one (about three runs in four at
      // 10 ms). The other half of the old loss, a re-seed from TWO intervals instead of
      // the missed anchors' own (the half-tempo lock), was a bug and is not selectable.
      // On this clip's anchors either half alone recovers the clean run (the review
      // checked both), so the result rests on 8 anchors and both halves.
      expect(held({ lostIfIntervalsAgree: false }, 0.01, 100)).toBeLessThan(90);
      // At 15 fps (every other frame: 7 anchors, two of them moved by a frame) the lock
      // is NOT robust: it holds in about half the runs at 5 ms of jitter (the review
      // measured 108 of 200). Reported here as a floor, not claimed as a lock.
      const fifteen = detect(samples.filter((s) => Math.round(s.t * meta.fps) % 2 === 0));
      const held15 = held({}, 0.005, 100, fifteen.anchors, fifteen.times[fifteen.times.length - 1]);
      expect(held15).toBeGreaterThanOrEqual(40);
      expect(held15).toBeLessThan(100);
    });
  }
});
