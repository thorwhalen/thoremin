/**
 * Headless contract test for the `midi-out` node — drives it with a MOCK
 * {@link MidiSink} (no browser, no WEBMIDI.js, no `navigator`) and verifies the
 * note/CC contract where the real bugs live: note-on/off lifecycle, velocity,
 * legato retrigger with hysteresis, diffed channel CC from the primary voice, and
 * — most importantly — that a note can never get stuck on (release, port change,
 * disable, and dispose all silence held notes). Also checks capability gating
 * (unsupported host never throws) and that the node is registered + wires from the
 * synth-merge bus in the real app registry.
 */
import { describe, it, expect } from 'vitest';
import { Engine } from '@/dag';
import type { NodeContext } from '@/dag';
import { createAppRegistry, midiOutNode } from '@/nodes/browser';
import type { MidiSink, MidiSinkFactory, MidiOpenResult, MidiStatus } from '@/nodes/browser';
import type { SynthParams, VoiceParams } from '@/nodes';
import { midiToFreq } from '@/music/theory';

type Ev =
  | { kind: 'on'; channel: number; note: number; velocity: number }
  | { kind: 'off'; channel: number; note: number }
  | { kind: 'cc'; channel: number; controller: number; value: number }
  | { kind: 'allNotesOff' }
  | { kind: 'close' };

class MockSink implements MidiSink {
  events: Ev[] = [];
  constructor(readonly portName = 'Mock Port') {}
  noteOn(channel: number, note: number, velocity: number) {
    this.events.push({ kind: 'on', channel, note, velocity });
  }
  noteOff(channel: number, note: number) {
    this.events.push({ kind: 'off', channel, note });
  }
  controlChange(channel: number, controller: number, value: number) {
    this.events.push({ kind: 'cc', channel, controller, value });
  }
  allNotesOff() {
    this.events.push({ kind: 'allNotesOff' });
  }
  close() {
    this.events.push({ kind: 'close' });
  }
  ons() {
    return this.events.filter((e): e is Extract<Ev, { kind: 'on' }> => e.kind === 'on');
  }
  offs() {
    return this.events.filter((e): e is Extract<Ev, { kind: 'off' }> => e.kind === 'off');
  }
  ccs() {
    return this.events.filter((e): e is Extract<Ev, { kind: 'cc' }> => e.kind === 'cc');
  }
  clear() {
    this.events = [];
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function make(params: Record<string, unknown> = {}) {
  return midiOutNode.make(midiOutNode.params.parse(params));
}

function ctx(resources: Record<string, unknown>, tick = 0, time = 0): NodeContext {
  return { tick, time, dt: 1 / 60, resources };
}

function factoryFor(result: MidiOpenResult): { factory: MidiSinkFactory; calls: () => number } {
  let n = 0;
  const factory: MidiSinkFactory = async () => {
    n += 1;
    return result;
  };
  return { factory, calls: () => n };
}

function voice(v: Partial<VoiceParams> = {}): VoiceParams {
  return { id: 0, present: true, freq: 440, gain: 0.5, sound: 'sine', ...v };
}
function sp(voices: VoiceParams[]): SynthParams {
  return { voices };
}

describe('midi-out node (contract logic, mock sink)', () => {
  it('is off by default: never opens a sink, sends nothing, reports phase "off"', async () => {
    const sink = new MockSink();
    const { factory, calls } = factoryFor({ sink, ports: [sink.portName] });
    const h = make();
    // `enabled` is unconnected here (undefined) → the node stays off.
    const out = h.process({ params: sp([voice()]) }, ctx({ createMidiSink: factory }));
    await flush();
    expect(calls()).toBe(0);
    expect(sink.events).toEqual([]);
    expect(out.status).toMatchObject({ phase: 'off', supported: true });
  });

  it('opens on enable, then plays a note with gain→velocity', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();

    // First enabled tick kicks off the async open — no note yet.
    const t0 = h.process({ params: sp([voice({ freq: 440, gain: 0.5 })]), enabled: true }, ctx(res));
    expect((t0.status as MidiStatus).phase).toBe('connecting');
    expect(sink.events).toEqual([]);
    await flush();

    // Sink now attached: the sounding voice plays A4 (MIDI 69) at full velocity
    // (gain 0.5 hits the default fullVelocityGain 0.5 → 127).
    h.process({ params: sp([voice({ freq: 440, gain: 0.5 })]), enabled: true }, ctx(res, 1, 0.02));
    expect(sink.ons()).toEqual([{ kind: 'on', channel: 1, note: 69, velocity: 127 }]);
  });

  it('releases a note (note-off) when the voice stops', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res));
    await flush();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res, 1, 0.02));
    sink.clear();
    // Voice goes absent → exactly one matching note-off, then no lingering note.
    h.process({ params: sp([voice({ present: false, gain: 0 })]), enabled: true }, ctx(res, 2, 0.04));
    expect(sink.offs()).toEqual([{ kind: 'off', channel: 1, note: 69 }]);
    const out = h.process({ params: sp([voice({ present: false, gain: 0 })]), enabled: true }, ctx(res, 3, 0.06));
    expect((out.status as MidiStatus).activeNotes).toBe(0);
  });

  it('legato-retriggers on a semitone change but holds through jitter (hysteresis)', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice({ freq: midiToFreq(69) })]), enabled: true }, ctx(res));
    await flush();
    h.process({ params: sp([voice({ freq: midiToFreq(69) })]), enabled: true }, ctx(res, 1, 0.02));
    sink.clear();

    // Within 0.5 + 0.1 hysteresis of note 69 → no retrigger.
    h.process({ params: sp([voice({ freq: midiToFreq(69.5) })]), enabled: true }, ctx(res, 2, 0.04));
    expect(sink.events).toEqual([]);

    // Beyond the hysteresis band → note-off 69, note-on 70.
    h.process({ params: sp([voice({ freq: midiToFreq(69.7) })]), enabled: true }, ctx(res, 3, 0.06));
    expect(sink.offs()).toEqual([{ kind: 'off', channel: 1, note: 69 }]);
    expect(sink.ons()).toEqual([{ kind: 'on', channel: 1, note: 70, velocity: 127 }]);
  });

  it('sends channel CC from the primary (lowest-id) voice, diffed', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res));
    await flush();
    sink.clear();

    // Two voices; id 0 is primary. Its brightness/vibrato/pan own the channel CC.
    const frame = sp([
      voice({ id: 0, freq: 440, gain: 0.5, brightness: 1, vibrato: 0, pan: 0 }),
      voice({ id: 1, freq: 660, gain: 0.5, brightness: 0, vibrato: 1, pan: 1 }),
    ]);
    h.process({ params: frame, enabled: true }, ctx(res, 1, 0.02));
    const cc = sink.ccs();
    // Defaults: expression=CC11, brightness=CC74, vibrato=CC1, pan=CC10.
    expect(cc).toEqual(
      expect.arrayContaining([
        { kind: 'cc', channel: 1, controller: 11, value: 127 }, // gain 0.5 / fullVelocityGain 0.5 → 127
        { kind: 'cc', channel: 1, controller: 74, value: 127 }, // brightness 1 → 127 (primary=id0)
        { kind: 'cc', channel: 1, controller: 1, value: 0 }, // vibrato 0 → 0 (primary=id0)
        { kind: 'cc', channel: 1, controller: 10, value: 64 }, // pan 0 → centre 64 (primary=id0)
      ]),
    );

    // Same values next tick → diffed away (no repeat CC).
    sink.clear();
    h.process({ params: frame, enabled: true }, ctx(res, 2, 0.04));
    expect(sink.ccs()).toEqual([]);

    // Change only brightness → exactly one CC 74.
    const brighter = sp([
      voice({ id: 0, freq: 440, gain: 0.5, brightness: 0.5, vibrato: 0, pan: 0 }),
      voice({ id: 1, freq: 660, gain: 0.5, brightness: 0, vibrato: 1, pan: 1 }),
    ]);
    h.process({ params: brighter, enabled: true }, ctx(res, 3, 0.06));
    expect(sink.ccs()).toEqual([{ kind: 'cc', channel: 1, controller: 74, value: 64 }]); // 0.5 → 64
  });

  it('disabling silences held notes and releases the port (no stuck notes)', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res));
    await flush();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res, 1, 0.02));
    sink.clear();

    const out = h.process({ params: sp([voice()]), enabled: false }, ctx(res, 2, 0.04));
    expect(sink.offs()).toEqual([{ kind: 'off', channel: 1, note: 69 }]);
    expect(sink.events.some((e) => e.kind === 'allNotesOff')).toBe(true);
    expect(sink.events.some((e) => e.kind === 'close')).toBe(true);
    expect(out.status).toMatchObject({ phase: 'off', activeNotes: 0 });
  });

  it('dispose panics: all-notes-off so nothing hangs on teardown', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res));
    await flush();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res, 1, 0.02));
    sink.clear();
    h.dispose?.();
    expect(sink.offs()).toEqual([{ kind: 'off', channel: 1, note: 69 }]);
    expect(sink.events.some((e) => e.kind === 'allNotesOff')).toBe(true);
  });

  it('gates gracefully where Web MIDI is unsupported (no factory) — never throws', () => {
    const h = make();
    let out: ReturnType<typeof h.process> | undefined;
    // No injected factory + a Node host with no navigator.requestMIDIAccess.
    expect(() => {
      out = h.process({ params: sp([voice()]), enabled: true }, ctx({}));
    }).not.toThrow();
    expect(out!.status).toMatchObject({ phase: 'unsupported', supported: false });
  });

  it('does not re-hammer the factory after a no-ports open', async () => {
    const { factory, calls } = factoryFor({ sink: null, ports: [], reason: 'no-ports' });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res));
    await flush();
    const out1 = h.process({ params: sp([voice()]), enabled: true }, ctx(res, 1, 0.02));
    expect((out1.status as MidiStatus).phase).toBe('no-ports');
    // Several more enabled ticks must NOT open again.
    for (let i = 2; i < 8; i++) h.process({ params: sp([voice()]), enabled: true }, ctx(res, i, i * 0.02));
    await flush();
    expect(calls()).toBe(1);
  });

  it('reference-counts unison notes: two voices on one note release independently', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice({ id: 0 }), voice({ id: 1 })]), enabled: true }, ctx(res));
    await flush();
    // Both voices quantize to A4 (69) on channel 1 → a single note-on, not two.
    h.process({ params: sp([voice({ id: 0 }), voice({ id: 1 })]), enabled: true }, ctx(res, 1, 0.02));
    expect(sink.ons()).toEqual([{ kind: 'on', channel: 1, note: 69, velocity: 127 }]);
    sink.clear();
    // Release voice 1 only → the note keeps sounding (voice 0 still holds it).
    h.process(
      { params: sp([voice({ id: 0 }), voice({ id: 1, present: false, gain: 0 })]), enabled: true },
      ctx(res, 2, 0.04),
    );
    expect(sink.offs()).toEqual([]);
    // Release voice 0 too → now the note releases exactly once.
    h.process(
      { params: sp([voice({ id: 0, present: false, gain: 0 }), voice({ id: 1, present: false, gain: 0 })]), enabled: true },
      ctx(res, 3, 0.06),
    );
    expect(sink.offs()).toEqual([{ kind: 'off', channel: 1, note: 69 }]);
  });

  it('re-enabling after a disable mid-open still connects (no wedged attempt latch)', async () => {
    const sink = new MockSink();
    const { factory, calls } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res, 0)); // kicks off open #1
    h.process({ params: sp([voice()]), enabled: false }, ctx(res, 1, 0.02)); // disabled before it resolves
    await flush(); // open #1 resolves → sink dropped, attempt latch cleared
    h.process({ params: sp([voice()]), enabled: true }, ctx(res, 2, 0.04)); // must open again
    await flush(); // open #2 resolves → sink attached
    const out = h.process({ params: sp([voice()]), enabled: true }, ctx(res, 3, 0.06));
    expect(calls()).toBe(2);
    expect(sink.ons()).toEqual([{ kind: 'on', channel: 1, note: 69, velocity: 127 }]);
    expect((out.status as MidiStatus).phase).toBe('ready');
  });

  it('treats a non-positive / non-finite freq as not sounding (no NaN note, no thrash)', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res));
    await flush();
    sink.clear();
    // A degenerate negative freq (freqToMidi would be NaN) must send nothing, on
    // this and every subsequent tick (no note-on/off machine-gun).
    for (let i = 1; i < 5; i++) {
      h.process({ params: sp([voice({ freq: -100 })]), enabled: true }, ctx(res, i, i * 0.02));
    }
    const out = h.process({ params: sp([voice({ freq: 0 })]), enabled: true }, ctx(res, 5, 0.1));
    expect(sink.events).toEqual([]);
    expect((out.status as MidiStatus).activeNotes).toBe(0);
  });

  it('does not leak the opened port if disposed while the open is in flight', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res)); // open in flight
    h.dispose?.(); // teardown before it resolves
    await flush(); // open resolves → must close the sink, never attach it
    expect(sink.events.some((e) => e.kind === 'close')).toBe(true);
    expect(sink.ons()).toEqual([]); // no notes ever sent on the leaked port
  });

  it('does not flood a controller shared by two dimensions (keeps the higher-priority one)', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    // Map BOTH expression and vibrato to CC 11 (a misconfiguration).
    const h = make({ cc: { expression: 11, brightness: 74, vibrato: 11, pan: 10 } });
    const res = { createMidiSink: factory };
    h.process({ params: sp([voice()]), enabled: true }, ctx(res));
    await flush();
    sink.clear();
    // expression (gain 0.5 → 127) differs from vibrato (0.5 → 64): a naive impl would
    // send CC11 twice with different values, and again every tick. Expect exactly ONE
    // CC 11 (expression wins) and no re-send when the value is unchanged next tick.
    const frame = sp([voice({ gain: 0.5, vibrato: 0.5, brightness: 0.25, pan: 0 })]);
    h.process({ params: frame, enabled: true }, ctx(res, 1, 0.02));
    const cc11 = sink.ccs().filter((e) => e.controller === 11);
    expect(cc11).toEqual([{ kind: 'cc', channel: 1, controller: 11, value: 127 }]); // expression, not vibrato (would be 64)
    sink.clear();
    h.process({ params: frame, enabled: true }, ctx(res, 2, 0.04));
    expect(sink.ccs().filter((e) => e.controller === 11)).toEqual([]); // diffed, no flood
  });

  it('reports "connecting" (not a stale "off") when re-enabled while an open is still in flight', async () => {
    const sink = new MockSink();
    const { factory, calls } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    // No flush between ticks, so the one async open stays pending across all three.
    h.process({ params: sp([voice()]), enabled: true }, ctx(res, 0)); // open in flight
    const off = h.process({ params: sp([voice()]), enabled: false }, ctx(res, 1, 0.02));
    expect((off.status as MidiStatus).phase).toBe('off');
    const back = h.process({ params: sp([voice()]), enabled: true }, ctx(res, 2, 0.04));
    // The prior open is still pending; status must reflect connecting, not the stale off.
    expect((back.status as MidiStatus).phase).toBe('connecting');
    await flush();
    expect(calls()).toBe(1); // no redundant second open was started
  });

  it('maps a non-finite pan to centre (64), not hard-left', async () => {
    const sink = new MockSink();
    const { factory } = factoryFor({ sink, ports: [sink.portName] });
    const res = { createMidiSink: factory };
    const h = make();
    h.process({ params: sp([voice()]), enabled: true }, ctx(res));
    await flush();
    // Start hard-left so the centre value is a real change the diffing will send.
    h.process({ params: sp([voice({ pan: -1 })]), enabled: true }, ctx(res, 1, 0.02));
    sink.clear();
    h.process({ params: sp([voice({ pan: NaN })]), enabled: true }, ctx(res, 2, 0.04));
    expect(sink.ccs().find((e) => e.controller === 10)).toEqual({
      kind: 'cc',
      channel: 1,
      controller: 10,
      value: 64,
    });
  });

  it('is registered in the app registry and wires from the synth-merge bus', () => {
    const spec = {
      nodes: [
        { id: 'src', type: 'synthetic-hands', params: { hands: 'right' } },
        { id: 'feat', type: 'hand-features', params: { mirrorX: false, mirrorHandedness: false } },
        { id: 'map', type: 'voice-mapping', params: { magnetism: 0.8, maxGain: 0.5 } },
        { id: 'merge', type: 'synth-merge', params: {} },
        { id: 'midiOut', type: 'midi-out', params: {} },
      ],
      edges: [
        { from: { node: 'src', port: 'hands' }, to: { node: 'feat', port: 'hands' } },
        { from: { node: 'feat', port: 'features' }, to: { node: 'map', port: 'features' } },
        { from: { node: 'map', port: 'params' }, to: { node: 'merge', port: 'a' } },
        { from: { node: 'merge', port: 'params' }, to: { node: 'midiOut', port: 'params' } },
      ],
    };
    const eng = new Engine(spec, createAppRegistry(), { resources: {}, nominalDt: 1 / 60 });
    // `enabled` is unconnected → defaults false → the node idles; the graph runs.
    expect(() => {
      for (let i = 0; i < 10; i++) eng.tick();
    }).not.toThrow();
    const status = eng.getOutput('midiOut', 'status') as { phase: string } | undefined;
    expect(status?.phase).toBe('off');
  });
});
