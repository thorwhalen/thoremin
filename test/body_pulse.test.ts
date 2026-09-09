/**
 * The dance pulse (#186 PR F): the interim engine on a channel whose period is
 * known by construction, the `body-pulse` node on the synthetic body (whose bounce
 * period is a param), the `body.rhythm.*` features folded into the body vector,
 * the graph wiring — and the real dancer fixture, where the honest claim is the
 * research map's: the periodicity is a HARMONIC of the beat (the bar), and the
 * engine must report one of those, never something unrelated.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless, replayNode } from '@/dag';
import { createCoreRegistry, bodyPulseNode, createInterimPulseEngine, createAcfPeriodEstimator, acfPeaks, makeBodyKeypoints, PULSE_HOLD_CONFIDENCE, type BodyFrame, type PulseState } from '@/nodes';
import { defaultGraph } from '@/app/graph';
import type { FeatureVector } from '@/features/catalog';
import { loadStream } from './helpers/fixtures';

const nearHarmonic = (period: number, base: number, harmonics = [0.5, 1, 2, 4], tol = 0.06) =>
  harmonics.some((h) => Math.abs(period / (base * h) - 1) < tol);

describe('the interim pulse engine (pure)', () => {
  const bounce = (t: number, period: number) => Math.abs(Math.sin((Math.PI * t) / period));

  it('finds the period of a bouncing channel within 2 % and locks phase to its extrema', () => {
    const period = 0.5;
    const e = createInterimPulseEngine();
    let s: PulseState = e.state();
    for (let i = 0; i < 240; i++) {
      const t = i / 30;
      e.push(t, bounce(t, period) + 0.01 * Math.sin(t * 7.3)); // a little wobble
      s = e.state();
    }
    expect(Math.abs(s.periodS / period - 1)).toBeLessThan(0.02);
    expect(s.bpm).toBeCloseTo(60 / period, 0);
    // A rectified sine's detrended autocorrelation peaks well under 1 (its harmonics
    // share the energy), and confidence is that strength times the anchor regularity.
    expect(s.confidence).toBeGreaterThan(0.3);
    // The anchors are the bottoms of the bounce (maxima of the channel): at t = 8 s the
    // channel peaked at 7.75 s, a quarter period ago → phase ≈ 0.5.
    expect(s.phase).toBeGreaterThan(0.35);
    expect(s.phase).toBeLessThan(0.65);
    expect(s.nextAnchorT).toBeGreaterThan(8);
    expect(s.nextAnchorT - s.lastAnchorT).toBeCloseTo(period, 1);
    // The harmonics are reported, strongest first.
    expect(s.candidates.length).toBeGreaterThan(1);
    expect(s.candidates.some((c) => Math.abs(c.periodS / (2 * period) - 1) < 0.1)).toBe(true);
  });

  it('reports nothing on a still or random channel, and resets on demand', () => {
    const e = createInterimPulseEngine();
    for (let i = 0; i < 150; i++) e.push(i / 30, 1);
    expect(Number.isNaN(e.state().periodS)).toBe(true);
    expect(e.state().confidence).toBe(0);
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const r = createInterimPulseEngine({ minStrength: 0.4 });
    for (let i = 0; i < 300; i++) r.push(i / 30, rnd());
    expect(r.state().confidence).toBeLessThan(0.4);
    r.reset();
    expect(r.state()).toMatchObject({ confidence: 0 });
    expect(Number.isNaN(r.state().periodS)).toBe(true);
  });

  it('is causal and deterministic: the same samples give the same states, and a non-monotonic time is ignored', () => {
    const run = () => {
      const e = createInterimPulseEngine();
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        e.push(i / 30, bounce(i / 30, 0.6));
        out.push(e.state().periodS);
      }
      e.push(1, 0); // in the past: ignored
      out.push(e.state().periodS);
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('follows a tempo change', () => {
    const e = createInterimPulseEngine();
    for (let i = 0; i < 240; i++) e.push(i / 30, bounce(i / 30, 0.5));
    expect(Math.abs(e.state().periodS / 0.5 - 1)).toBeLessThan(0.03);
    // Speed up to a 0.4 s bounce (an unrelated tempo, not a harmonic): the estimate follows.
    let phase0 = 8 / 0.5;
    for (let i = 240; i < 480; i++) {
      const t = i / 30;
      e.push(t, Math.abs(Math.sin(Math.PI * (phase0 + (t - 8) / 0.4))));
    }
    expect(Math.abs(e.state().periodS / 0.4 - 1)).toBeLessThan(0.05);
  });
});

describe('body-pulse on the synthetic body, and body.rhythm in the vector', () => {
  it('recovers the bounce period and feeds body.rhythm.* into body-feature-vector', async () => {
    const period = 0.6;
    const spec = {
      nodes: [
        { id: 'b', type: 'synthetic-body', params: { bouncePeriod: period } },
        { id: 'p', type: 'body-pulse', params: {} },
        { id: 'v', type: 'body-feature-vector', params: { groups: ['body.rhythm', 'body.pos'] } },
      ],
      edges: [
        { from: { node: 'b', port: 'body' }, to: { node: 'p', port: 'body' } },
        { from: { node: 'b', port: 'body' }, to: { node: 'v', port: 'body' } },
        { from: { node: 'p', port: 'pulse' }, to: { node: 'v', port: 'pulse' } },
      ],
    };
    const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks: 240, nominalDt: 1 / 30, recordOnly: ['p.pulse', 'v.vector'] });
    const pulses = recorder.values('p.pulse') as PulseState[];
    const last = pulses[pulses.length - 1];
    expect(Math.abs(last.periodS / period - 1)).toBeLessThan(0.02);
    expect(last.confidence).toBeGreaterThan(0.3);
    const vectors = recorder.values('v.vector') as FeatureVector[];
    const v = vectors[vectors.length - 1];
    expect(v['body.rhythm.period']).toBeCloseTo(last.periodS, 9);
    expect(v['body.rhythm.bpm']).toBeCloseTo(60 / last.periodS, 6);
    expect(v['body.rhythm.phase']).toBeGreaterThanOrEqual(0);
    expect(v['body.rhythm.phase']).toBeLessThan(1);
    expect([0, 1]).toContain(v['body.rhythm.beat']);
    // The beat gate fires once per period, roughly: about 15 % of ticks over the last 4 s.
    const beats = vectors.slice(120).map((x) => x['body.rhythm.beat']).filter((x) => x === 1).length;
    expect(beats / 120).toBeGreaterThan(0.08);
    expect(beats / 120).toBeLessThan(0.3);
    // Before anything is known the rhythm keys are simply absent (NaN dropped), never NaN.
    expect(vectors[0]['body.rhythm.period']).toBeUndefined();
  });

  it('an absent body resets the pulse (no stale tempo when the dancer returns)', () => {
    const h = bodyPulseNode.make(bodyPulseNode.params.parse({}));
    const ctx = (t: number) => ({ tick: 0, time: t, dt: 1 / 30, resources: {} });
    // A skeleton bouncing at 0.5 s: the hips dip by a twentieth of the frame.
    const mk = (t: number): BodyFrame => {
      const { landmarks, world } = makeBodyKeypoints({ width: 640, height: 480, cx: 0.5, cy: 0.6 + 0.05 * Math.abs(Math.sin((Math.PI * t) / 0.5)), torso: 100, leftArm: 0, rightArm: 0, kneeBend: 0, lean: 0 });
      return { width: 640, height: 480, present: true, landmarks, world, visibility: new Array(33).fill(1) };
    };
    for (let i = 0; i < 200; i++) h.process({ body: mk(i / 30) }, ctx(i / 30));
    expect((h.process({ body: mk(200 / 30) }, ctx(200 / 30)) as { pulse: PulseState }).pulse.confidence).toBeGreaterThan(0.3);
    const gone = (h.process({ body: { width: 640, height: 480, present: false, landmarks: [], visibility: [] } }, ctx(201 / 30)) as { pulse: PulseState }).pulse;
    expect(gone.confidence).toBe(0);
    const back = (h.process({ body: mk(202 / 30) }, ctx(202 / 30)) as { pulse: PulseState }).pulse;
    expect(Number.isNaN(back.periodS)).toBe(true);
  });

  it('is wired in the default graph: camBody → pulse → bodyVec', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(has('camBody', 'body', 'pulse', 'body')).toBe(true);
    expect(has('pulse', 'pulse', 'bodyVec', 'pulse')).toBe(true);
  });
});

describe('the estimator and the detector (the parts an ictus adapter reuses)', () => {
  it('the per-lag normalisation does not crush a slow, perfectly regular bounce', () => {
    // A plain /a0 autocorrelation caps a 2.4 s bounce in a 5 s window near r = 0.4 because
    // the overlap shrinks with the lag; normalising by the overlapping energies keeps a
    // regular signal near 1 at every period in range.
    for (const period of [0.4, 1.2, 2.4]) {
      const x = Array.from({ length: 150 }, (_, i) => Math.abs(Math.sin((Math.PI * i) / 30 / period)));
      const peaks = acfPeaks(x, 8, 75);
      const best = peaks[0];
      expect(Math.abs(best.lag / 30 / period - 1), `period ${period}`).toBeLessThan(0.05);
      expect(best.r, `strength at ${period}`).toBeGreaterThan(0.8);
    }
    // And the search never returns a lag beyond maxLag.
    const slow = Array.from({ length: 150 }, (_, i) => Math.abs(Math.sin((Math.PI * i) / 30 / 2.6)));
    for (const p of acfPeaks(slow, 8, 75)) expect(p.lag).toBeLessThanOrEqual(75);
  });

  it('a NaN channel (an unobserved landmark) drops a lock instead of extrapolating it', () => {
    const e = createInterimPulseEngine();
    for (let i = 0; i < 240; i++) e.push(i / 30, Math.abs(Math.sin((Math.PI * i) / 30 / 0.5)));
    expect(e.state().confidence).toBeGreaterThan(0.3);
    expect(Number.isFinite(e.state().phase)).toBe(true);
    for (let i = 240; i < 360; i++) e.push(i / 30, NaN); // 4 s unobserved
    expect(Number.isFinite(e.state().phase)).toBe(false);
    // Coming back, the old phase is not resurrected: it must be re-acquired.
    e.push(12, 0.5);
    expect(Number.isFinite(e.state().phase)).toBe(false);
  });

  it('the estimator is usable on its own (the seam an ictus adapter seeds from)', () => {
    const est = createAcfPeriodEstimator({ windowS: 4 });
    const samples = Array.from({ length: 120 }, (_, i) => ({ t: i / 30, v: Math.abs(Math.sin((Math.PI * i) / 30 / 0.6)) }));
    const r = est.estimate(samples)!;
    expect(Math.abs(r.candidates[0].periodS / 0.6 - 1)).toBeLessThan(0.05);
    expect(r.sigma).toBeGreaterThan(0);
  });
});

describe('the real dancer (video_body_que_calor): a harmonic of the beat, honestly', () => {
  const beat = 60 / 129.2;
  const replay = async (channel: 'head' | 'hip') => {
    const frames = loadStream('video_body_que_calor', 'camBody.body') as BodyFrame[];
    const out = await replayNode(bodyPulseNode.make(bodyPulseNode.params.parse({ channel })), { body: frames }, { dt: 1 / 30 });
    return out.map((o) => o.pulse as PulseState);
  };
  /** The distinct anchors the engine accepted over the clip. */
  const anchorsOf = (states: PulseState[]) => {
    const a: number[] = [];
    for (const s of states) if (Number.isFinite(s.lastAnchorT) && (a.length === 0 || Math.abs(a[a.length - 1] - s.lastAnchorT) > 1e-6)) a.push(s.lastAnchorT);
    return a;
  };
  /** Circular resultant of the anchors' phases against a grid of `level` beats, with
   *  0 and 0.5 treated alike (a down-bounce and an up-groove are the same pulse). */
  const foldedR = (anchors: number[], level: number) => {
    const ph = anchors.map((t) => ((((t / (beat * level)) % 1) + 1) % 1) * 2 % 1);
    const c = ph.reduce((a, p) => a + Math.cos(2 * Math.PI * p), 0) / ph.length;
    const s = ph.reduce((a, p) => a + Math.sin(2 * Math.PI * p), 0) / ph.length;
    return Math.hypot(c, s);
  };

  it('the head channel: when confident, the period is a harmonic of 129.2 bpm; the anchors are phase-coherent with the beat', async () => {
    const states = await replay('head');
    const last = states[states.length - 1];
    expect(Number.isFinite(last.periodS)).toBe(true);
    // Measured on this fixture with the shipped engine: at the hold threshold 164 of the
    // last 300 ticks are confident and 90 % of those sit within 6 % of a harmonic
    // (chance for the search range is 17 %); the resultant of the 13 accepted anchors
    // against the folded beat grid is 0.66 (chance for n = 13 is about 0.28).
    const confident = states.slice(300).filter((s) => s.confidence >= PULSE_HOLD_CONFIDENCE);
    expect(confident.length).toBeGreaterThan(100);
    const onHarmonic = confident.filter((s) => nearHarmonic(s.periodS, beat)).length;
    expect(onHarmonic / confident.length).toBeGreaterThan(0.8);
    const anchors = anchorsOf(states);
    expect(anchors.length).toBeGreaterThan(8);
    expect(foldedR(anchors, 1)).toBeGreaterThan(0.4);
  });

  it('the hips carry the steps, not the pulse: their anchors are not phase-coherent (why the head is the default)', async () => {
    const states = await replay('hip');
    const anchors = anchorsOf(states);
    expect(foldedR(anchors, 1)).toBeLessThan(0.4);
  });
});
