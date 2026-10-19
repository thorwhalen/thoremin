/**
 * The `orchestra` node's lifecycle edges (#391 item 5), headless, with a recording fake
 * synth in place of `spessasynth_lib` (the shape `test/orchestra_node.test.ts` uses):
 *
 *  - the written dynamics: `planPiece` must voice a score the way the `score` node's
 *    oscillators voice it, through `flattenNotes`, behind the `dynamics` param whose
 *    default stays `raw` (#393 item 3);
 *  - a suspended `AudioContext`: nothing is committed onto its frozen clock, and on
 *    resume the notes the beat passed meanwhile are skipped rather than burst out;
 *  - the synth factory still pending when the node is disposed, or when the dial is
 *    switched off and on again: no stray synth survives, and exactly one plays;
 *  - a piece swapped mid-play: the sounding keys are released before the new
 *    programs are sent.
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import type { LoadStatus } from '@thoremin/lazy';
import { orchestraNode, type OrchestraEngineFactory, type OrchestraSynth } from '@/slices/conductor/nodes/orchestra';
import { planPiece } from '@/slices/conductor/nodes/orchestra';
import { flattenNotes, type ScoreDoc } from '@thoremin/sdk/score/schema';
import { CONDUCTOR } from '../helpers/extensions';

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
const ON = { orchestra: { enabled: true } };
const OFF = { orchestra: { enabled: false } };
const ENGINE0 = 1000;
const DT = 1 / 30;

const time = (beat: number, tempo: number) => ({ t: 0, beat, phase: beat % 1, tempo, period: 60 / tempo, confidence: 1, nextBeatAt: 0, beatsPerBar: 4, beatInBar: 0, state: 'running', anchors: 3 });

/** A deferred factory: each call creates a synth and waits until the test resolves it. */
function deferredFactory() {
  const pending: { synth: FakeSynth; resolve: () => void; signal: AbortSignal }[] = [];
  const factory: OrchestraEngineFactory = ({ signal }) =>
    new Promise((resolve) => {
      const synth = new FakeSynth();
      pending.push({ synth, signal, resolve: () => resolve({ resource: synth }) });
    });
  return { factory, pending };
}

function harness(factory?: OrchestraEngineFactory) {
  const synth = new FakeSynth();
  const ac = { currentTime: 100, state: 'running' as string };
  const resources: Record<string, unknown> = {
    createOrchestraEngine: factory ?? (async () => ({ resource: synth })),
    audioContext: ac,
    masterGain: {},
  };
  const h = orchestraNode.make(orchestraNode.params.parse({}));
  let tick = 0;
  /** One engine tick. The context clock follows engine time unless it is suspended. */
  const step = (inputs: Record<string, unknown>) => {
    const ctx: NodeContext = { tick, time: ENGINE0 + tick * DT, dt: DT, resources };
    if (ac.state === 'running') ac.currentTime += tick === 0 ? 0 : DT;
    tick++;
    return h.process(inputs, ctx) as { status: LoadStatus; playing: boolean };
  };
  return { h, synth, step, ac };
}

const doc = (over: Partial<ScoreDoc> = {}): ScoreDoc =>
  ({
    v: 1,
    title: 't',
    source: 'midi',
    parts: [],
    tempoMap: [],
    timeSignatures: [],
    dynamics: [],
    fermatas: [],
    lengthBeats: 8,
    ...over,
  }) as ScoreDoc;

/** A violin line under a `p` from the start and a part-scoped `ff` from beat 3. */
const markedPiece = () =>
  doc({
    parts: [
      {
        id: 'v',
        name: 'Violin',
        program: 40,
        percussion: false,
        notes: [0, 1, 2, 3, 4, 5].map((i) => ({ midi: 60 + i, start: i, duration: 1, velocity: 0.8 })),
      },
    ],
    dynamics: [
      { beat: 0, value: 0.36, text: 'p' },
      { beat: 3, value: 0.9, text: 'ff', part: 'v' },
    ],
  } as Partial<ScoreDoc>);
const byNote = (xs: { key: number; start: number; velocity: number }[]) => xs.map((x) => [x.key, x.start, x.velocity]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);

describe.runIf(CONDUCTOR)('planPiece and the written dynamics', () => {
  it('with dynamics `written`, voices a piece with dynamics marks the way flattenNotes does (#393 item 3)', () => {
    const piece = markedPiece();
    const flat = flattenNotes(piece);
    // The marks do change the velocities (the fixture is not vacuous).
    expect(flat.map((n) => n.velocity)).not.toEqual(piece.parts[0].notes.map((n) => n.velocity));
    expect(byNote(planPiece(piece, { dynamics: 'written' }).events)).toEqual(byNote(flat.map((n) => ({ key: n.midi, start: n.start, velocity: n.velocity }))));
  });

  it('the default is still the raw velocities: the written marks are opt-in', () => {
    const piece = markedPiece();
    const raw = piece.parts[0].notes.map((n) => ({ key: n.midi, start: n.start, velocity: n.velocity }));
    expect(byNote(planPiece(piece).events)).toEqual(byNote(raw));
    expect(byNote(planPiece(piece, { dynamics: 'raw' }).events)).toEqual(byNote(raw));
    expect(orchestraNode.params.parse({}).dynamics).toBe('raw');
  });

  it('the node param reaches the plan: `written` plays the marked velocities, the default the raw ones', async () => {
    const play = async (params: Record<string, unknown>) => {
      const synth = new FakeSynth();
      const ac = { currentTime: 100, state: 'running' };
      const resources: Record<string, unknown> = { createOrchestraEngine: async () => ({ resource: synth }), audioContext: ac, masterGain: {} };
      const h = orchestraNode.make(orchestraNode.params.parse(params));
      const piece = markedPiece();
      for (let i = 0; i < 120; i++) {
        ac.currentTime = 100 + i * DT;
        h.process({ config: ON, doc: piece, conducting: i > 0, time: time((i * DT * 120) / 60, 120) }, { tick: i, time: ENGINE0 + i * DT, dt: DT, resources });
        if (i === 0) await flush();
      }
      return synth.ons().map((c) => [c.args[1], c.args[2]]);
    };
    const raw = await play({});
    const written = await play({ dynamics: 'written' });
    expect(raw.length).toBeGreaterThan(3);
    expect(raw.map(([, v]) => v)).toEqual(raw.map(() => Math.round(0.8 * 127)));
    const piece = markedPiece();
    const want = new Map(flattenNotes(piece).map((n) => [n.midi, Math.max(1, Math.round(n.velocity * 127))]));
    expect(written.length).toBe(raw.length);
    for (const [key, v] of written) expect(v).toBe(want.get(key));
  });

  it('a piece with no marks keeps its velocities (the control case)', () => {
    const piece = doc({
      parts: [{ id: 'v', name: 'Violin', program: 40, percussion: false, notes: [{ midi: 60, start: 0, duration: 1, velocity: 0.55 }] }],
    } as Partial<ScoreDoc>);
    expect(planPiece(piece).events.map((e) => e.velocity)).toEqual(flattenNotes(piece).map((n) => n.velocity));
  });
});

describe.runIf(CONDUCTOR)('orchestra node with a suspended AudioContext', () => {
  it('commits nothing while suspended; on resume skips the notes the beat passed and does not burst', async () => {
    const { step, synth, ac } = harness();
    step({ config: ON });
    await flush();
    // 120 bpm: two beats a second. Play beats 0..1.5, the demo scale's first notes.
    let i = 0;
    const beatOf = (k: number) => (k * DT * 120) / 60;
    for (; i < 24; i++) step({ config: ON, conducting: true, time: time(beatOf(i), 120) });
    const before = synth.ons().length;
    expect(before).toBeGreaterThan(0);
    // The context suspends (another tab took the device, Safari before a gesture) for
    // 2 s while the conductor beats on: four beats.
    ac.state = 'suspended';
    const frozen = ac.currentTime;
    for (; i < 84; i++) step({ config: ON, conducting: true, time: time(beatOf(i), 120) });
    expect(synth.ons().length).toBe(before);
    expect(ac.currentTime).toBe(frozen);
    // Resume: the next tick sees the beat four beats on.
    ac.state = 'running';
    const callsAtResume = synth.calls.length;
    const beatAtResume = beatOf(i);
    step({ config: ON, conducting: true, time: time(beatAtResume, 120) });
    const resumeOns = synth.calls.slice(callsAtResume).filter((c) => c.op === 'noteOn');
    // At most the note under way at the beat, plus one due within the horizon: no burst.
    expect(resumeOns.length).toBeLessThanOrEqual(2);
    for (const c of resumeOns) expect(c.args[3]).toBeGreaterThanOrEqual(ac.currentTime - 1e-9);
    // The notes whose whole span the beat passed while suspended never sound.
    const lastBeforeSuspend = beatOf(23);
    const passedKeys = [60, 62, 64, 65, 67, 69, 71, 72].filter((_, start) => start > lastBeforeSuspend + 0.5 && start + 0.9 <= beatAtResume);
    expect(passedKeys.length).toBeGreaterThan(0);
    const afterSuspendKeys = synth.calls.slice(callsAtResume).filter((c) => c.op === 'noteOn').map((c) => c.args[1]);
    for (const k of passedKeys) expect(afterSuspendKeys).not.toContain(k);
    // Playing on, each later tick commits at most a note or two.
    for (let n = 0; n < 30; n++, i++) {
      const at = synth.calls.length;
      step({ config: ON, conducting: true, time: time(beatOf(i + 1), 120) });
      expect(synth.calls.slice(at).filter((c) => c.op === 'noteOn').length).toBeLessThanOrEqual(2);
    }
  });
});

describe.runIf(CONDUCTOR)('orchestra node: the synth factory still pending', () => {
  it('disposed while the factory is pending: once it resolves the synth is closed and never played', async () => {
    const { factory, pending } = deferredFactory();
    const { h, step } = harness(factory);
    expect(step({ config: ON, conducting: true, time: time(0, 60) }).status.phase).toBe('loading');
    expect(pending).toHaveLength(1);
    h.dispose?.();
    pending[0].resolve();
    await flush();
    expect(pending[0].synth.closed).toBe(true);
    expect(pending[0].synth.ons()).toHaveLength(0);
    expect(pending[0].synth.calls.filter((c) => c.op === 'program')).toHaveLength(0);
  });

  it('disabled and re-enabled mid-load: exactly one live synth, and only it plays', async () => {
    const { factory, pending } = deferredFactory();
    const { step } = harness(factory);
    step({ config: ON });
    step({ config: OFF });
    step({ config: ON });
    expect(pending).toHaveLength(2);
    expect(pending[0].signal.aborted).toBe(true);
    // The stale load resolves last-but-one, the fresh one after it.
    pending[0].resolve();
    pending[1].resolve();
    await flush();
    for (let i = 0; i < 60; i++) step({ config: ON, conducting: true, time: time((i * DT * 120) / 60, 120) });
    const live = pending.filter((p) => !p.synth.closed);
    expect(live).toHaveLength(1);
    expect(live[0]).toBe(pending[1]);
    expect(pending[0].synth.ons()).toHaveLength(0);
    expect(pending[1].synth.ons().length).toBeGreaterThan(0);
  });

  it('the same, when the stale load resolves after the fresh one', async () => {
    const { factory, pending } = deferredFactory();
    const { step } = harness(factory);
    step({ config: ON });
    step({ config: OFF });
    step({ config: ON });
    pending[1].resolve();
    await flush();
    step({ config: ON, conducting: true, time: time(0, 120) });
    pending[0].resolve();
    await flush();
    for (let i = 1; i < 60; i++) step({ config: ON, conducting: true, time: time((i * DT * 120) / 60, 120) });
    expect(pending.filter((p) => !p.synth.closed)).toEqual([pending[1]]);
    expect(pending[0].synth.calls).toHaveLength(0);
  });
});

describe.runIf(CONDUCTOR)('orchestra node: swapping the piece mid-play', () => {
  it('releases the sounding keys before sending the new programs', async () => {
    const { step, synth } = harness();
    step({ config: ON });
    await flush();
    // The built-in scale, until a note is sounding.
    let i = 0;
    for (; i < 20; i++) step({ config: ON, conducting: true, time: time((i * DT * 120) / 60, 120) });
    const sounding = new Set<string>();
    for (const c of synth.calls) {
      const k = `${c.args[0]}:${c.args[1]}`;
      if (c.op === 'noteOn') sounding.add(k);
      else if (c.op === 'noteOff') sounding.delete(k);
    }
    expect(sounding.size).toBeGreaterThan(0);
    const at = synth.calls.length;
    const horn = doc({
      parts: [
        { id: 'c', name: 'Cello', program: 42, percussion: false, notes: [{ midi: 48, start: 0, duration: 4, velocity: 0.8 }] },
        { id: 'f', name: 'Flute', program: 73, percussion: false, notes: [{ midi: 72, start: 0, duration: 4, velocity: 0.8 }] },
      ],
    } as Partial<ScoreDoc>);
    step({ config: ON, doc: horn, conducting: true, time: time((i * DT * 120) / 60, 120) });
    const after = synth.calls.slice(at);
    const firstProgram = after.findIndex((c) => c.op === 'program');
    expect(firstProgram).toBeGreaterThan(-1);
    expect(new Set(after.filter((c) => c.op === 'program').map((c) => c.args[1]))).toEqual(new Set([42, 73]));
    // Every key the old piece left sounding gets its note-off, and all of them come first.
    for (const k of sounding) {
      const off = after.findIndex((c) => c.op === 'noteOff' && `${c.args[0]}:${c.args[1]}` === k);
      expect(off, `noteOff for ${k}`).toBeGreaterThan(-1);
      expect(off).toBeLessThan(firstProgram);
    }
    const stop = after.findIndex((c) => c.op === 'allNotesOff');
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(firstProgram);
    // No onset of the new piece before its programs.
    const firstOn = after.findIndex((c) => c.op === 'noteOn');
    if (firstOn !== -1) expect(firstOn).toBeGreaterThan(firstProgram);
  });
});
