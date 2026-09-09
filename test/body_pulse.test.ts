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
import { createCoreRegistry, bodyPulseNode, createInterimPulseEngine, makeBodyKeypoints, type BodyFrame, type PulseState } from '@/nodes';
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

describe('the real dancer (video_body_que_calor): a harmonic of the beat, honestly', () => {
  it('reports a period that is a harmonic of 129.2 bpm, with the bar among its candidates', async () => {
    const frames = loadStream('video_body_que_calor', 'camBody.body') as BodyFrame[];
    const out = await replayNode(bodyPulseNode.make(bodyPulseNode.params.parse({})), { body: frames }, { dt: 1 / 30 });
    const beat = 60 / 129.2;
    const states = out.map((o) => o.pulse as PulseState);
    const last = states[states.length - 1];
    // A choreography phrase repeats at the bar, a bounce at the beat; both are the same
    // pulse to an octave-agnostic controller. What must never happen is a period
    // unrelated to the music.
    expect(Number.isFinite(last.periodS)).toBe(true);
    expect(nearHarmonic(last.periodS, beat)).toBe(true);
    const anyBar = last.candidates.some((c) => nearHarmonic(c.periodS, beat, [2, 4], 0.08));
    expect(anyBar).toBe(true);
    // Over the second half of the clip, whenever the engine is CONFIDENT the estimate is
    // on a harmonic; the low-confidence stretches (a phrase change) are what the pace
    // controller's confidence hold exists for, so they are not counted against it.
    // Measured on this fixture (head channel): confidence >= 0.15 in 76 of the last 300
    // ticks, 91 % of them on a harmonic; the hips manage 48 %, which is why the head is
    // the default channel. Confidence is low in absolute terms on a real dancer — the pace
    // controller's hold threshold (PR H) is set from this number, not from the synthetic.
    const confident = states.slice(300).filter((s) => s.confidence >= 0.15);
    expect(confident.length).toBeGreaterThan(30);
    const onHarmonic = confident.filter((s) => nearHarmonic(s.periodS, beat)).length;
    expect(onHarmonic / confident.length).toBeGreaterThan(0.8);
  });
});
