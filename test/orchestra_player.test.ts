/**
 * `createOrchestraPlayer` (#392 item 5): what the `orchestra` node does with a loaded
 * synth, driven here without the node (no lazy loading, no ports), on a recording fake
 * synth and a hand-advanced `TickClock`.
 */
import { describe, expect, it } from 'vitest';
import { CC, createOrchestraPlayer, DEFAULT_ORCHESTRA, type OrchestraSynth, type TickClock } from '@/nodes/output/orchestra';
import { DEMO_SCALE_NOTES } from '@/nodes';

type Call = { op: string; args: number[] };

class FakeSynth implements OrchestraSynth {
  calls: Call[] = [];
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
  close() {}
  ops(op: string) {
    return this.calls.filter((c) => c.op === op);
  }
}

const DT = 1 / 30;
const TEMPO = 120;
const at = (i: number): TickClock => ({ clock: { currentTime: 100 + i * DT }, nowEngine: 1000 + i * DT, stage: 0.02 });
const time = (i: number) => ({ t: 0, beat: (i * DT * TEMPO) / 60, phase: 0, tempo: TEMPO, period: 60 / TEMPO, confidence: 1, nextBeatAt: 0, beatsPerBar: 4, beatInBar: 0, state: 'running' as const, anchors: 3 });

describe('createOrchestraPlayer', () => {
  it('plans the demo scale with no document: one program, then the scale in order on the context clock', () => {
    const synth = new FakeSynth();
    const player = createOrchestraPlayer(synth);
    player.ensurePlan(undefined, at(0));
    expect(synth.ops('program')).toHaveLength(1);
    // The same document again does not replan.
    player.ensurePlan(undefined, at(1));
    expect(synth.ops('program')).toHaveLength(1);
    for (let i = 0; i < 150; i++) player.advance({ time: time(i), articulation: 0.5, dt: DT }, at(i));
    const keys = synth.ops('noteOn').map((c) => c.args[1]);
    expect(keys.slice(0, DEMO_SCALE_NOTES.length)).toEqual(DEMO_SCALE_NOTES.map((n) => n.midi));
    // Per key, every onset follows the previous release on the context clock.
    const byKey = new Map<number, Call[]>();
    for (const c of synth.calls.filter((c) => c.op === 'noteOn' || c.op === 'noteOff')) byKey.set(c.args[1], [...(byKey.get(c.args[1]) ?? []), c]);
    for (const seq of byKey.values()) for (let k = 1; k < seq.length; k++) expect(seq[k].args.at(-1)!).toBeGreaterThan(seq[k - 1].args.at(-1)!);
  });

  it('levels: volume every tick only when it changes, dynamics rate-limited by ccInterval', () => {
    const synth = new FakeSynth();
    const player = createOrchestraPlayer(synth, { ccInterval: 0.1 });
    player.ensurePlan(undefined, at(0));
    for (let i = 0; i < 6; i++) player.levels({ settings: DEFAULT_ORCHESTRA, velocityScale: i < 3 ? 1 : 0.5 }, at(i));
    const cc = (n: number) => synth.ops('cc').filter((c) => c.args[1] === n);
    expect(cc(CC.volume)).toHaveLength(1);
    // Ticks 0 and 3 pass the 0.1 s limit (1/30 s apart); the value changed at tick 3.
    expect(cc(CC.expression).map((c) => c.args[2])).toEqual([127, 64]);
  });

  it('silence releases what the scheduler committed, then stops everything', () => {
    const synth = new FakeSynth();
    const player = createOrchestraPlayer(synth);
    player.ensurePlan(undefined, at(0));
    for (let i = 0; i < 10; i++) player.advance({ time: time(i), articulation: 0.5, dt: DT }, at(i));
    const before = synth.calls.length;
    player.silence(at(10));
    const after = synth.calls.slice(before);
    expect(after.at(-1)!.op).toBe('allNotesOff');
    expect(after.filter((c) => c.op === 'noteOff').length).toBeGreaterThan(0);
  });
});
