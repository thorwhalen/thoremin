/**
 * The `webaudio-synth` node against a recording fake of the Web Audio graph
 * (`test/helpers/fakeAudio.ts`). It is the sound of every field instrument, and before
 * this file only its absence was tested (the timescale boundary): what it schedules on a
 * live tick was not. Pinned here: silence without audio, the bus built once, a voice
 * built from its preset (partials, preset filter, vibrato, reverb send), each tick's
 * targets (pitch per partial, brightness, vibrato, pan, envelope), the release paths
 * (absent, gain 0, a producer that left the graph), a non-finite voice skipped, a sound
 * swap faded and rebuilt, a non-real-time scale tearing everything down, and dispose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { TIME_SCALE_KEY } from '@thoremin/dag';
import { getSound } from '@thoremin/sdk/music/sounds';
import type { SynthParams, VoiceParams } from '@thoremin/sdk/nodes/domain';
import { webAudioSynthNode } from '@/nodes/output/webaudio_synth';
import { fakeAudio, param, type FakeAudio, type FakeNode } from './helpers/fakeAudio';

const PARAMS = webAudioSynthNode.params.parse({});

function setup({ audio = true, extra = {} }: { audio?: boolean; extra?: Record<string, unknown> } = {}) {
  const fa = fakeAudio({ currentTime: 1 });
  const node = webAudioSynthNode.make(PARAMS);
  const resources: Record<string, unknown> = audio ? { audioContext: fa.ac, masterGain: fa.master, ...extra } : { ...extra };
  const ctx = { tick: 0, time: 0, dt: 0, resources } as unknown as NodeContext;
  const tick = (voices: VoiceParams[] | undefined) =>
    node.process!(voices ? { params: { voices } satisfies SynthParams } : {}, ctx);
  return { fa, node, resources, tick };
}

const voice = (v: Partial<VoiceParams> = {}): VoiceParams => ({
  id: 0,
  present: true,
  freq: 220,
  gain: 0.5,
  sound: 'warmPad',
  ...v,
});

/** The nodes the bus owns: compressor, makeup, reverb in, convolver, reverb out. */
const BUS_NODES = 5;

/** The oscillators that sound a partial (started, and their pitch follows the voice). */
const partialsOf = (fa: FakeAudio) =>
  fa.of('Oscillator').filter((o) => param(o, 'frequency').calls.some((c) => c[0] === 'target'));
const lfosOf = (fa: FakeAudio) =>
  fa.of('Oscillator').filter((o) => !param(o, 'frequency').calls.some((c) => c[0] === 'target'));
const lastTarget = (n: FakeNode, p: string) => param(n, p).calls.filter((c) => c[0] === 'target').at(-1);

describe('the webaudio-synth node', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is silent and builds nothing without an AudioContext and a master gain', () => {
    const { fa, tick } = setup({ audio: false });
    expect(tick([voice()])).toEqual({});
    expect(fa.nodes).toEqual([]);
  });

  it('builds the shared bus once, into the master, even before any params arrive', () => {
    const { fa, tick } = setup();
    tick(undefined);
    expect(fa.nodes.map((n) => n.kind)).toEqual(['DynamicsCompressor', 'Gain', 'Gain', 'Convolver', 'Gain']);
    const [comp, makeup, reverbIn, convolver, reverbOut] = fa.nodes;
    expect(comp.connections).toEqual([makeup]);
    expect(makeup.connections).toEqual([fa.master]);
    expect(reverbIn.connections).toEqual([convolver]);
    expect(convolver.connections).toEqual([reverbOut]);
    expect(reverbOut.connections).toEqual([comp]);
    // The impulse is a stereo decaying noise of 1.8 s at the context's rate.
    const ir = convolver.buffer as { numberOfChannels: number; length: number; getChannelData(c: number): Float32Array };
    expect(ir.numberOfChannels).toBe(2);
    expect(ir.length).toBe(Math.floor(8000 * 1.8));
    const tail = ir.getChannelData(0).slice(-100);
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(0.01);
    tick(undefined);
    tick([]);
    expect(fa.nodes).toHaveLength(BUS_NODES);
  });

  it('builds a voice from its preset: every partial, the preset filter, the vibrato and the reverb send', () => {
    const { fa, tick } = setup();
    const preset = getSound('warmPad');
    tick([voice({ brightness: 0.5, vibrato: 1, pan: 0.25 })]);
    const partials = partialsOf(fa);
    expect(partials).toHaveLength(preset.partials.length);
    partials.forEach((o, i) => {
      expect(o.type).toBe(preset.partials[i].type);
      expect(o.started).toHaveLength(1);
      expect(lastTarget(o, 'frequency')).toEqual(['target', 220 * (preset.partials[i].ratio ?? 1), 1, PARAMS.freqGlide]);
    });
    // The detuned partials carry their cents; the vibrato LFO modulates every partial's detune.
    expect(param(partials[0], 'detune').calls[0]).toEqual(['set', -7, 1]);
    const [lfo] = lfosOf(fa);
    expect(lfo.started).toHaveLength(1);
    const depth = lfo.connections[0] as FakeNode;
    expect(depth.connections).toEqual(partials.map((o) => o.detune));
    // Full live vibrato on a preset with no vibrato of its own: 35 cents.
    expect(lastTarget(depth, 'gain')).toEqual(['target', 35, 1, 0.05]);
    // Two filters: the brightness low-pass (the live one) and the preset's own.
    const filters = fa.of('BiquadFilter');
    expect(filters).toHaveLength(2);
    expect(filters[1].type).toBe(preset.filter!.type);
    expect(param(filters[1], 'frequency').calls[0]).toEqual(['set', preset.filter!.cutoff, 1]);
    expect(filters[1].connections).toEqual([filters[0]]);
    // brightness 0.5 -> 500 * 28^0.5 Hz.
    expect(lastTarget(filters[0], 'frequency')![1]).toBeCloseTo(500 * Math.sqrt(28), 6);
    // The dry path is panned; the envelope rises with the preset's attack.
    const [panner] = fa.of('StereoPanner');
    expect(lastTarget(panner, 'pan')).toEqual(['target', 0.25, 1, 0.05]);
    expect(panner.connections).toEqual([fa.nodes[0]]);
    const voiceGain = filters[0].connections[0] as FakeNode;
    expect(lastTarget(voiceGain, 'gain')).toEqual(['target', 0.5, 1, preset.attack]);
    // The reverb send carries the preset's amount into the bus's reverb input.
    const reverbIn = fa.nodes[2];
    const send = fa.of('Gain').find((g) => g.connections.includes(reverbIn))!;
    expect(param(send, 'gain').calls[0]).toEqual(['set', preset.reverbSend, 1]);
  });

  it('a preset with its own vibrato adds the live amount to it; no filter, no send, without one', () => {
    const { fa, tick } = setup();
    tick([voice({ sound: 'voice', vibrato: 0.5 })]);
    const [lfo] = lfosOf(fa);
    const v = getSound('voice').vibrato!;
    expect(param(lfo, 'frequency').calls[0]).toEqual(['set', v.rateHz, 1]);
    const depth = lfo.connections[0] as FakeNode;
    expect(lastTarget(depth, 'gain')![1]).toBeCloseTo(v.depthCents + 0.5 * 35, 9);

    const plain = setup();
    plain.tick([voice({ sound: 'sine' })]);
    expect(plain.fa.of('BiquadFilter')).toHaveLength(1); // the brightness filter only
    const reverbIn = plain.fa.nodes[2];
    expect(plain.fa.of('Gain').some((g) => g.connections.includes(reverbIn))).toBe(false);
    // The default vibrato rate when the preset names none.
    expect(param(lfosOf(plain.fa)[0], 'frequency').calls[0]).toEqual(['set', 5.5, 1]);
  });

  it('an unknown sound id plays the sine', () => {
    const { fa, tick } = setup();
    tick([voice({ sound: 'no-such-sound' as VoiceParams['sound'] })]);
    expect(partialsOf(fa).map((o) => o.type)).toEqual(['sine']);
  });

  it('reads absent and degenerate expression as neutral: open, no vibrato, centred', () => {
    const { fa, tick } = setup();
    tick([voice({ sound: 'sine', brightness: Number.NaN, vibrato: Number.NaN, pan: Number.NaN })]);
    const [bright] = fa.of('BiquadFilter');
    expect(lastTarget(bright, 'frequency')![1]).toBeCloseTo(500 * 28, 6);
    expect(lastTarget(lfosOf(fa)[0].connections[0] as FakeNode, 'gain')![1]).toBe(0);
    expect(lastTarget(fa.of('StereoPanner')[0], 'pan')![1]).toBe(0);
  });

  it('clamps pan and brightness into range', () => {
    const { fa, tick } = setup();
    tick([voice({ sound: 'sine', pan: 4, brightness: -3 })]);
    expect(lastTarget(fa.of('StereoPanner')[0], 'pan')![1]).toBe(1);
    expect(param(fa.of('StereoPanner')[0], 'pan').calls[0]).toEqual(['set', 1, 1]);
    expect(lastTarget(fa.of('BiquadFilter')[0], 'frequency')![1]).toBe(500);
  });

  it('follows the voice on every tick without rebuilding it', () => {
    const { fa, tick } = setup();
    tick([voice({ sound: 'sine' })]);
    const built = fa.nodes.length;
    fa.setTime(2);
    tick([voice({ sound: 'sine', freq: 330, gain: 0.7 })]);
    expect(fa.nodes).toHaveLength(built);
    const [osc] = partialsOf(fa);
    expect(lastTarget(osc, 'frequency')).toEqual(['target', 330, 2, PARAMS.freqGlide]);
  });

  it('a voice that is absent or at gain 0 releases with its preset release, and comes back without a rebuild', () => {
    const { fa, tick } = setup();
    const release = getSound('glass').release;
    tick([voice({ sound: 'glass' })]);
    const voiceGain = fa.of('BiquadFilter')[0].connections[0] as FakeNode;
    const built = fa.nodes.length;
    tick([voice({ sound: 'glass', present: false })]);
    expect(lastTarget(voiceGain, 'gain')).toEqual(['target', 0, 1, release]);
    tick([voice({ sound: 'glass', gain: 0 })]);
    expect(lastTarget(voiceGain, 'gain')).toEqual(['target', 0, 1, release]);
    tick([voice({ sound: 'glass', gain: 0.4 })]);
    expect(lastTarget(voiceGain, 'gain')![1]).toBe(0.4);
    expect(fa.nodes).toHaveLength(built);
  });

  it('a silent voice never heard builds nothing', () => {
    const { fa, tick } = setup();
    tick([voice({ present: false }), voice({ id: 1, gain: 0 })]);
    expect(fa.nodes).toHaveLength(BUS_NODES);
  });

  it('a voice whose producer left the graph fades out, and the others play on', () => {
    const { fa, tick } = setup();
    tick([voice({ id: 0, sound: 'sine' }), voice({ id: 1, sound: 'sine', freq: 440 })]);
    const gains = fa.of('BiquadFilter').map((f) => f.connections[0] as FakeNode);
    tick([voice({ id: 1, sound: 'sine', freq: 440 })]);
    expect(lastTarget(gains[0], 'gain')).toEqual(['target', 0, 1, PARAMS.gainGlide]);
    expect(lastTarget(gains[1], 'gain')![1]).toBe(0.5);
  });

  it('skips a voice with a non-finite pitch or gain instead of aborting the tick', () => {
    const { fa, tick } = setup();
    expect(() =>
      tick([voice({ id: 0, freq: Number.NaN }), voice({ id: 1, gain: Number.POSITIVE_INFINITY }), voice({ id: 2, sound: 'sine' })]),
    ).not.toThrow();
    expect(partialsOf(fa)).toHaveLength(1);
  });

  it('a sound swap fades the old voice out, stops it after its tail and builds the new one', () => {
    const { fa, tick } = setup();
    tick([voice({ sound: 'sine' })]);
    const oldNodes = fa.nodes.slice(BUS_NODES);
    const [oldOsc] = partialsOf(fa);
    const oldGain = fa.of('BiquadFilter')[0].connections[0] as FakeNode;
    fa.setTime(3);
    tick([voice({ sound: 'glass' })]);
    // Ramped to zero over 20 ms from where it was, then stopped 30 ms on.
    expect(param(oldGain, 'gain').calls.slice(-3)).toEqual([
      ['cancel', 3],
      ['set', 0, 3],
      ['linear', 0, 3.02],
    ]);
    expect(oldOsc.stopped).toEqual([3.03]);
    // Disconnected only after the fade, so the ramp is heard.
    expect(oldNodes.every((n) => n.disconnected === 0)).toBe(true);
    vi.advanceTimersByTime(120);
    expect(oldNodes.every((n) => n.disconnected === 1)).toBe(true);
    expect(partialsOf(fa).at(-1)!.type).toBe('sine');
    expect(partialsOf(fa)).toHaveLength(1 + getSound('glass').partials.length);
  });

  it('a fade survives a param that throws and a node already stopped or disconnected', () => {
    const { fa, tick } = setup();
    tick([voice({ sound: 'sine' })]);
    const voiceNodes = fa.nodes.slice(BUS_NODES);
    const g = param(fa.of('BiquadFilter')[0].connections[0] as FakeNode, 'gain');
    g.cancelScheduledValues = () => {
      throw new Error('param unavailable');
    };
    for (const n of voiceNodes) {
      n.stop = () => {
        throw new Error('already stopped');
      };
      n.disconnect = () => {
        throw new Error('already disconnected');
      };
    }
    expect(() => tick([voice({ sound: 'glass' })])).not.toThrow();
    expect(() => vi.advanceTimersByTime(120)).not.toThrow();
  });

  it('goes silent at any time scale but real time: every voice torn down, nothing built', () => {
    const { fa, resources, tick } = setup();
    tick([voice({ id: 0, sound: 'sine' }), voice({ id: 1, sound: 'sine' })]);
    const oscs = partialsOf(fa);
    resources[TIME_SCALE_KEY] = 2;
    const before = fa.nodes.length;
    tick([voice({ id: 0, sound: 'sine' })]);
    expect(oscs.every((o) => o.stopped.length === 1)).toBe(true);
    expect(fa.nodes).toHaveLength(before);
    // Back at real time the voice is rebuilt from scratch.
    resources[TIME_SCALE_KEY] = 1;
    tick([voice({ id: 0, sound: 'sine' })]);
    expect(partialsOf(fa)).toHaveLength(3);
  });

  it('dispose stops every voice at once and disconnects the voices and the bus; a second dispose is harmless', () => {
    const { fa, node, tick } = setup();
    tick([voice({ sound: 'warmPad' })]);
    fa.setTime(5);
    node.dispose!();
    expect(partialsOf(fa).every((o) => o.stopped[0] === 5)).toBe(true);
    expect(lfosOf(fa)[0].stopped).toEqual([5]);
    expect(fa.nodes.every((n) => n.disconnected === 1)).toBe(true);
    expect(() => node.dispose!()).not.toThrow();
  });

  it('dispose before any audio is a no-op', () => {
    const { node } = setup({ audio: false });
    expect(() => node.dispose!()).not.toThrow();
  });

  it('dispose survives bus nodes that are already disconnected', () => {
    const { fa, node, tick } = setup();
    tick([]);
    for (const n of fa.nodes)
      n.disconnect = () => {
        throw new Error('already disconnected');
      };
    expect(() => node.dispose!()).not.toThrow();
  });

  it('rebuilds the bus for a new AudioContext', () => {
    const first = setup();
    first.tick([]);
    const other = fakeAudio();
    first.resources.audioContext = other.ac;
    first.resources.masterGain = other.master;
    first.tick([]);
    expect(other.nodes).toHaveLength(BUS_NODES);
  });
});
