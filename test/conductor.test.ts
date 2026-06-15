/**
 * Tests conductor mode (M5): `transport` (beat clock), `score` (immutable piece
 * performed live), `performance` (control → tempo + dynamics), and the full DAG:
 *   control → performance → transport → score
 * A rising control speeds up the piece and raises its dynamics.
 */
import { describe, it, expect } from 'vitest';
import { replayNode, runHeadless, type GraphSpec } from '@/dag';
import { transportNode, scoreNode, performanceNode, createCoreRegistry } from '@/nodes';
import { freqToMidi } from '@/music/theory';
import type { SynthParams } from '@/nodes';

const SCALE_NOTES = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({
  midi,
  start: i,
  duration: 1,
  velocity: 1,
}));

const presentVoice = (p: SynthParams) => p.voices.find((v) => v.present);

describe('transport node', () => {
  it('advances beats proportional to bpm and elapsed time', async () => {
    const dt = 1 / 30;
    const at120 = await replayNode(transportNode.make(transportNode.params.parse({})), { bpm: Array(31).fill(120) }, { dt });
    const at240 = await replayNode(transportNode.make(transportNode.params.parse({})), { bpm: Array(31).fill(240) }, { dt });
    // 30 increments * (1/30)s = 1.0s; 120bpm = 2 beats/s, 240bpm = 4 beats/s.
    expect(at120[at120.length - 1].beat as number).toBeCloseTo(2.0, 1);
    expect(at240[at240.length - 1].beat as number).toBeCloseTo(4.0, 1);
  });
});

describe('score node', () => {
  it('sounds the note at the current beat, scaled by velocityScale, and loops', async () => {
    const h = scoreNode.make(scoreNode.params.parse({ notes: SCALE_NOTES, loopBeats: 8, baseGain: 0.4 }));
    const outs = await replayNode(h, { beat: [0, 1, 7.5, 8.0], velocityScale: [1, 0.5, 1, 1] });
    const v = outs.map((o) => presentVoice(o.params as SynthParams)!);
    expect(Math.round(freqToMidi(v[0].freq))).toBe(60); // beat 0 → first note
    expect(Math.round(freqToMidi(v[1].freq))).toBe(62); // beat 1 → second note
    expect(v[1].gain).toBeCloseTo(0.5 * 0.4, 5); // velocityScale 0.5
    expect(Math.round(freqToMidi(v[2].freq))).toBe(72); // beat 7.5 → last note
    expect(Math.round(freqToMidi(v[3].freq))).toBe(60); // beat 8.0 wraps → first note
  });
});

describe('performance node', () => {
  it('maps control 0..1 to bpm and velocityScale (no humanization = exact)', async () => {
    const h = performanceNode.make(performanceNode.params.parse({ bpmMin: 60, bpmMax: 160, dynMin: 0.4, dynMax: 1 }));
    const outs = await replayNode(h, { control: [0, 0.5, 1] });
    expect(outs[0]).toMatchObject({ bpm: 60, velocityScale: 0.4 });
    expect(outs[1].bpm).toBeCloseTo(110, 5);
    expect(outs[2]).toMatchObject({ bpm: 160, velocityScale: 1 });
  });

  it('humanization adds bounded, deterministic jitter', async () => {
    const h = performanceNode.make(performanceNode.params.parse({ humanizeBpm: 5, bpmMin: 120, bpmMax: 120 }));
    const a = (await replayNode(h, { control: [0.5, 0.5, 0.5] }, { dt: 1 / 30 })).map((o) => o.bpm as number);
    const b = (await replayNode(h, { control: [0.5, 0.5, 0.5] }, { dt: 1 / 30 })).map((o) => o.bpm as number);
    expect(a).toEqual(b); // deterministic
    expect(a.every((x) => Math.abs(x - 120) <= 5.001)).toBe(true); // bounded by amplitude
  });
});

describe('conductor chain (DAG): rising control speeds up the piece', () => {
  it('beat accelerates and the score keeps sounding notes', async () => {
    const ticks = 90;
    const ramp = Array.from({ length: ticks }, (_, i) => i / (ticks - 1)); // 0 → 1
    const spec: GraphSpec = {
      nodes: [
        { id: 'ctrl', type: 'replay-source', params: { values: ramp } },
        { id: 'perf', type: 'performance', params: { bpmMin: 40, bpmMax: 200 } },
        { id: 'xport', type: 'transport' },
        { id: 'score', type: 'score', params: { notes: SCALE_NOTES, loopBeats: 8 } },
      ],
      edges: [
        { from: { node: 'ctrl', port: 'value' }, to: { node: 'perf', port: 'control' } },
        { from: { node: 'perf', port: 'bpm' }, to: { node: 'xport', port: 'bpm' } },
        { from: { node: 'perf', port: 'velocityScale' }, to: { node: 'score', port: 'velocityScale' } },
        { from: { node: 'xport', port: 'beat' }, to: { node: 'score', port: 'beat' } },
      ],
    };
    const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks, nominalDt: 1 / 30 });

    const beats = recorder.values('xport.beat') as number[];
    // Monotonic non-decreasing.
    for (let i = 1; i < beats.length; i++) expect(beats[i]).toBeGreaterThanOrEqual(beats[i - 1]);
    // Late (fast) beat deltas exceed early (slow) ones — the piece accelerates.
    const earlyDelta = beats[10] - beats[5];
    const lateDelta = beats[beats.length - 1] - beats[beats.length - 6];
    expect(lateDelta).toBeGreaterThan(earlyDelta * 1.5);
    // The score is performing: a note sounds on most ticks.
    const params = recorder.values('score.params') as SynthParams[];
    const sounding = params.filter((p) => p.voices.some((v) => v.present)).length;
    expect(sounding).toBeGreaterThan(ticks * 0.6);
  });
});
