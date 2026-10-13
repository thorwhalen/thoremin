/**
 * The `orchestra` node (#187 PR 5), headless, with a recording fake synth in place of
 * `spessasynth_lib`: the lazy seam (nothing loads until the dial says so; no audio graph
 * is an honest, retrying `unavailable`), the handover to the score's oscillators, the
 * controller mapping (CC7 per section, CC11 + CC74 for the conductor's dynamics), the
 * articulation, a trainer's claim, and the real thing: the 4/4 conducting fixture
 * through the `conductor` node, conducting the shipped Beethoven 5, lands each note's
 * onset on its beat.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { replayNode, type NodeContext } from '@thoremin/dag';
import type { LoadStatus } from '@thoremin/lazy';
import { conductorNode, orchestraNode, type HandsFrame, type OrchestraEngineFactory, type OrchestraSynth } from '@/nodes';
import { CC, durationScaleFor, dynamicsControllers, planPiece } from '@/nodes/output/orchestra';
import { loadScore } from '@/score/load';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import { loadStream } from './helpers/fixtures';

type Call = { op: string; args: number[] };

class FakeSynth implements OrchestraSynth {
  calls: Call[] = [];
  closed = false;
  noteOn(channel: number, key: number, velocity: number, time: number) {
    this.calls.push({ op: 'noteOn', args: [channel, key, velocity, time] });
  }
  noteOff(channel: number, key: number, time: number) {
    this.calls.push({ op: 'noteOff', args: [channel, key, time] });
  }
  controllerChange(channel: number, cc: number, value: number, time: number) {
    this.calls.push({ op: 'cc', args: [channel, cc, value, time] });
  }
  programChange(channel: number, program: number) {
    this.calls.push({ op: 'program', args: [channel, program] });
  }
  allNotesOff() {
    this.calls.push({ op: 'allNotesOff', args: [] });
  }
  close() {
    this.closed = true;
  }
  ons() {
    return this.calls.filter((c) => c.op === 'noteOn');
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** A running context whose clock reads the engine time plus `offset`. */
const fakeAc = (offset = 100) => {
  const ac = { currentTime: offset, state: 'running' };
  return ac;
};
const ON = { orchestra: { enabled: true } };

function harness(synth = new FakeSynth()) {
  let loads = 0;
  const factory: OrchestraEngineFactory = async ({ progress }) => {
    loads++;
    progress(0.5);
    return { resource: synth };
  };
  const ac = fakeAc();
  const resources: Record<string, unknown> = { createOrchestraEngine: factory, audioContext: ac, masterGain: {} };
  const h = orchestraNode.make(orchestraNode.params.parse({}));
  let tick = 0;
  const dt = 1 / 30;
  const step = (inputs: Record<string, unknown>) => {
    const ctx: NodeContext = { tick, time: tick * dt, dt, resources };
    ac.currentTime = 100 + tick * dt;
    tick++;
    return h.process(inputs, ctx) as { status: LoadStatus; playing: boolean };
  };
  return { h, synth, step, loads: () => loads, resources };
}

const time = (beat: number, tempo: number) => ({ t: 0, beat, phase: beat % 1, tempo, period: 60 / tempo, confidence: 1, nextBeatAt: 0, beatsPerBar: 4, beatInBar: 0, state: 'running', anchors: 3 });

describe('orchestra node: the lazy seam', () => {
  it('is off and loads nothing until conductor.orchestra.enabled', async () => {
    const { step, loads } = harness();
    for (let i = 0; i < 5; i++) expect(step({ config: { enabled: true }, conducting: true }).status.phase).toBe('off');
    await flush();
    expect(loads()).toBe(0);
  });

  it('without an audio graph (no tap yet) the default loader is a retrying unavailable, and imports nothing', async () => {
    const h = orchestraNode.make(orchestraNode.params.parse({}));
    const ctx: NodeContext = { tick: 0, time: 0, dt: 1 / 30, resources: {} };
    h.process({ config: ON }, ctx);
    await flush();
    const out = h.process({ config: ON }, { ...ctx, tick: 1 }) as { status: LoadStatus; playing: boolean };
    expect(out.status).toMatchObject({ phase: 'unavailable', reason: 'no-audio' });
    expect(out.playing).toBe(false);
    h.dispose?.();
  });

  it('loads once when enabled, reports ready, then active while conducting; disabling closes the synth', async () => {
    const { step, synth, loads } = harness();
    expect(step({ config: ON }).status.phase).toBe('loading');
    await flush();
    const ready = step({ config: ON });
    expect(ready.status.phase).toBe('ready');
    expect(ready.playing).toBe(false);
    const on = step({ config: ON, conducting: true, time: time(0, 60) });
    expect(on.status.phase).toBe('active');
    expect(on.playing).toBe(true);
    expect(loads()).toBe(1);
    expect(step({ config: { orchestra: { enabled: false } }, conducting: true }).status.phase).toBe('off');
    expect(synth.closed).toBe(true);
  });
});

describe('orchestra node: playing the piece', () => {
  it('with no piece loaded plays the built-in scale on a strings channel, each onset on its beat', async () => {
    const { step, synth } = harness();
    step({ config: ON });
    await flush();
    const dt = 1 / 30;
    for (let i = 0; i < 300; i++) {
      const beat = (i * dt * 120) / 60; // 120 bpm from engine time 1/30 onwards
      step({ config: ON, conducting: true, time: time(beat, 120) });
    }
    expect(synth.calls.find((c) => c.op === 'program')?.args).toEqual([0, 48]);
    const ons = synth.ons();
    expect(ons.slice(0, 8).map((c) => c.args[1])).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    // Beat b is heard at engine time (b / 2) s after tick 1 started it; context = engine + 100.
    // With no timing resource the output stage is the stated 20 ms prior, written that early.
    for (const c of ons.slice(1, 8)) {
      const beat = ons.indexOf(c);
      expect(c.args[3]).toBeCloseTo(100 + (beat * 60) / 120 + 1 / 30 - 0.02, 2);
    }
  });

  it('assigns each part its program, one channel per program', () => {
    const plan = planPiece({
      v: 1,
      title: 't',
      source: 'midi',
      parts: [
        { id: 'a', name: 'Violin I', program: 40, percussion: false, notes: [{ midi: 67, start: 0, duration: 1, velocity: 0.8 }] },
        { id: 'b', name: 'Violin II', program: 40, percussion: false, notes: [{ midi: 64, start: 0, duration: 1, velocity: 0.8 }] },
        { id: 'c', name: 'Horn', program: 60, percussion: false, notes: [{ midi: 55, start: 0, duration: 1, velocity: 0.8 }] },
        { id: 'd', name: '?', percussion: false, notes: [] },
      ],
      tempoMap: [],
      timeSignatures: [],
      dynamics: [],
      fermatas: [],
      lengthBeats: 1,
    } as ScoreDoc);
    // Violins share channel 0; the horn (not in the cut bank) maps to the nearest kept
    // program in its family or the default; the programless part plays the default.
    expect(plan.channels.map((c) => [c.channel, c.program])).toEqual([
      [0, 40],
      [1, 48],
    ]);
    expect(plan.events.map((e) => e.channel)).toEqual([0, 0, 1]);
  });

  it('hands the piece to the score only while it plays, and a claim silences it', async () => {
    const { step, synth } = harness();
    step({ config: ON });
    expect(step({ config: ON, conducting: true, time: time(0, 60) }).playing).toBe(false); // still loading
    await flush();
    expect(step({ config: ON, conducting: true, time: time(0, 60) }).playing).toBe(true);
    const claimed = step({ config: ON, conducting: true, claimed: true, time: time(0.1, 60) });
    expect(claimed.playing).toBe(false);
    expect(synth.calls.at(-1)?.op).toBe('allNotesOff');
  });

  it('stopping the conductor releases what sounds', async () => {
    const { step, synth } = harness();
    step({ config: ON });
    await flush();
    step({ config: ON, conducting: true, time: time(0, 60) });
    expect(synth.ons()).toHaveLength(1);
    step({ config: ON, conducting: false, time: time(0, 0) });
    const offs = synth.calls.filter((c) => c.op === 'noteOff');
    expect(offs).toHaveLength(1);
    expect(synth.calls.at(-1)?.op).not.toBe('noteOn');
    expect(synth.calls.some((c) => c.op === 'allNotesOff')).toBe(true);
  });
});

describe('orchestra node: controllers', () => {
  it('CC7 is the overall level times the section level', async () => {
    const { step, synth } = harness();
    const config = { orchestra: { enabled: true, volume: 0.5, sections: { strings: 0.5 } } };
    step({ config });
    await flush();
    step({ config });
    expect(synth.calls.find((c) => c.op === 'cc' && c.args[1] === CC.volume)?.args.slice(0, 3)).toEqual([0, 7, Math.round(0.25 * 127)]);
  });

  it('the conductor’s dynamics drive CC11 and CC74 on sounding notes, rate-limited and diffed', async () => {
    const { step, synth } = harness();
    step({ config: ON });
    await flush();
    for (let i = 0; i < 30; i++) step({ config: ON, conducting: true, time: time(i / 30, 60), velocityScale: 0.35 + (0.65 * i) / 29 });
    const expr = synth.calls.filter((c) => c.op === 'cc' && c.args[1] === CC.expression);
    // ccInterval 0.05 s at 30 fps: at most one update every other tick.
    expect(expr.length).toBeLessThanOrEqual(16);
    expect(expr.length).toBeGreaterThan(8);
    expect(expr.at(-1)!.args[2]).toBeGreaterThan(expr[0].args[2]);
  });

  it('maps dynamics: full is neutral brightness, soft is darker and quieter', () => {
    expect(dynamicsControllers(1, 0.5)).toEqual({ expression: 127, brightness: 64 });
    const soft = dynamicsControllers(0.35, 0.5);
    expect(soft.expression).toBe(Math.round(0.35 * 127));
    expect(soft.brightness).toBeLessThan(64);
    expect(dynamicsControllers(0.35, 0).brightness).toBe(64);
  });

  it('maps articulation: smooth strokes play notes as written, sharp ones shorten them', () => {
    expect(durationScaleFor(0, 0.5)).toBe(1);
    expect(durationScaleFor(0.5, 0.5)).toBe(1);
    expect(durationScaleFor(1, 0.5)).toBe(0.5);
    expect(durationScaleFor(1, 0)).toBe(1);
  });
});

describe('orchestra node: conducting Beethoven 5 from the 4/4 fixture', () => {
  it('every onset sounds near the moment the conductor’s beat reaches it', async () => {
    const FPS = 30;
    const dt = 1 / FPS;
    const frames = loadStream('conducting_44', 'src.hands') as HandsFrame[];
    const cond = conductorNode.make(conductorNode.params.parse({ enabled: true, mirrorX: false, mirrorHandedness: false }));
    const outs = await replayNode(cond, { hands: frames }, { dt });
    const doc = await loadScore(new Uint8Array(readFileSync('public/scores/beethoven-symphony-5-1.mid')), 'beethoven-symphony-5-1.mid');

    const { step, synth } = harness();
    step({ config: ON });
    await flush();
    const beats: number[] = [];
    for (const o of outs) {
      beats.push(o.beat as number);
      step({ config: ON, doc, conducting: true, time: o.time, velocityScale: o.velocityScale, articulation: o.articulation });
    }
    // Programs: Beethoven's winds, timpani and strings, all in the cut bank.
    expect(new Set(synth.calls.filter((c) => c.op === 'program').map((c) => c.args[1]))).toEqual(new Set([40, 41, 42, 43, 47, 68, 69, 70, 71, 73]));
    const ons = synth.ons();
    expect(ons.length).toBeGreaterThan(30);
    // Each onset's heard time (context time − 100 + the 20 ms stage, in engine seconds,
    // counted from the harness's tick 1) mapped back through the conductor's beat.
    const beatAt = (t: number) => {
      const i = t / dt - 1;
      const lo = Math.max(0, Math.min(beats.length - 1, Math.floor(i)));
      const hi = Math.min(beats.length - 1, lo + 1);
      return beats[lo] + (beats[hi] - beats[lo]) * (i - lo);
    };
    const plan = planPiece(doc);
    const starts = new Map<string, number[]>();
    for (const e of plan.events) {
      const k = `${e.channel}:${e.key}`;
      starts.set(k, [...(starts.get(k) ?? []), e.start]);
    }
    const errs = ons.map((c) => {
      const heard = c.args[3] - 100 + 0.02;
      const b = beatAt(heard);
      const cands = starts.get(`${c.args[0]}:${c.args[1]}`)!;
      return Math.min(...cands.map((s) => Math.abs(s - b)));
    });
    errs.sort((a, b) => a - b);
    const median = errs[Math.floor(errs.length / 2)];
    const p90 = errs[Math.floor(errs.length * 0.9)];
    // Measured: 48 onsets, median 0.003 beat, p90 0.017 (the tempo moving between commit and onset).
    expect(median).toBeLessThan(0.02);
    expect(p90).toBeLessThan(0.05);
  });
});
