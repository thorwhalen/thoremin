/**
 * Adversarial audit of `webaudio-synth` (2026-10-20 review lane): a voice whose id has left
 * the stream was faded to silence but never torn down, so a conducted score (one voice id per
 * note, each id present for its note and gone after) grew one set of oscillators per note
 * played and kept them running. A reaped voice that comes back under the same id starts at
 * the pitch it had, as it did when the voice was kept, so nothing a player hears changes.
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import type { SynthParams } from '@thoremin/sdk/nodes/domain';
import { webAudioSynthNode, ABSENT_VOICE_REAP_S } from '@/nodes/output/webaudio_synth';

type Call = [string, ...number[]];

function fakeParam(calls: Call[] = []) {
  const p = {
    value: 440,
    calls,
    setValueAtTime: (v: number, t: number) => void calls.push(['set', v, t]),
    linearRampToValueAtTime: (v: number, t: number) => void calls.push(['linear', v, t]),
    exponentialRampToValueAtTime: (v: number, t: number) => void calls.push(['exp', v, t]),
    setTargetAtTime: (v: number, t: number, tau: number) => void calls.push(['target', v, t, tau]),
    cancelScheduledValues: (t: number) => void calls.push(['cancel', t]),
  };
  return p;
}

function fakeContext() {
  const node = () => ({ connect: () => {}, disconnect: () => {} });
  let started = 0;
  let stopped = 0;
  const oscillators: { frequency: ReturnType<typeof fakeParam> }[] = [];
  const ac = {
    currentTime: 0,
    sampleRate: 48000,
    createOscillator: () => {
      const o = { ...node(), type: '', frequency: fakeParam(), detune: fakeParam(), start: () => void started++, stop: () => void stopped++ };
      oscillators.push(o);
      return o;
    },
    createBiquadFilter: () => ({ ...node(), type: '', frequency: fakeParam(), Q: fakeParam() }),
    createGain: () => ({ ...node(), gain: fakeParam() }),
    createStereoPanner: () => ({ ...node(), pan: fakeParam() }),
    createDynamicsCompressor: () => ({ ...node(), threshold: fakeParam(), knee: fakeParam(), ratio: fakeParam(), attack: fakeParam(), release: fakeParam() }),
    createConvolver: () => ({ ...node(), buffer: null }),
    createBuffer: (channels: number, length: number) => ({ getChannelData: () => new Float32Array(length), numberOfChannels: channels, length }),
  };
  return { ac, oscillators, live: () => started - stopped };
}

function harness() {
  const f = fakeContext();
  const h = webAudioSynthNode.make(webAudioSynthNode.params.parse({}));
  let tick = 0;
  const ctx = (): NodeContext => ({ tick: tick++, time: f.ac.currentTime, dt: 1 / 60, resources: { audioContext: f.ac, masterGain: {} as GainNode, timeScale: 1 } });
  const process = (params: SynthParams) => h.process({ params }, ctx());
  const voice = (id: number, present: boolean, freq = 110) => ({ id, present, freq, gain: present ? 0.3 : 0, sound: 'sine' as const });
  return { ...f, h, process, voice };
}

describe('webaudio-synth voices whose id has left the stream', () => {
  it('are torn down once their fade is over, so a score does not keep one oscillator set per note played', () => {
    const t = harness();
    // Two hundred notes in turn, each present for a tick, released for a tick, then gone.
    for (let i = 0; i < 200; i++) {
      t.ac.currentTime = i * 0.5;
      t.process({ voices: [t.voice(1000 + i, true, 110 + i)] });
      t.ac.currentTime += 0.1;
      t.process({ voices: [t.voice(1000 + i, false, 110 + i)] });
      t.ac.currentTime += 0.1;
      t.process({ voices: [] });
    }
    t.ac.currentTime += 10;
    t.process({ voices: [] });
    // Each voice: its partials plus the vibrato LFO. Nothing of a note long gone may run.
    expect(t.live()).toBeLessThanOrEqual(4);
  });

  it('are kept through their release, and a voice still in the stream (present or not) is never reaped', () => {
    const t = harness();
    t.process({ voices: [t.voice(0, true), t.voice(7, true)] });
    const after = t.live();
    t.ac.currentTime += 0.05;
    t.process({ voices: [t.voice(0, false)] }); // 7 left the stream, 0 is silent but present
    expect(t.live()).toBe(after); // 7 fades, nothing is stopped yet
    t.ac.currentTime += ABSENT_VOICE_REAP_S * 20;
    t.process({ voices: [t.voice(0, false)] });
    expect(t.live()).toBe(after / 2); // 7 is gone, 0 stays with its pitch memory
  });

  it('come back at the pitch they had, as an unreaped voice would', () => {
    const t = harness();
    t.process({ voices: [t.voice(5, true, 220)] });
    t.ac.currentTime += 1;
    t.process({ voices: [] });
    t.ac.currentTime += ABSENT_VOICE_REAP_S * 20;
    t.process({ voices: [] });
    const before = t.oscillators.length;
    t.ac.currentTime += 1;
    t.process({ voices: [t.voice(5, true, 220)] });
    const rebuilt = t.oscillators.slice(before);
    expect(rebuilt.length).toBeGreaterThan(0);
    // The partial (not the LFO) is anchored at its own pitch before the glide, as the kept
    // voice would already have been there.
    const partial = rebuilt[0]!;
    expect(partial.frequency.calls[0]).toEqual(['set', 220, t.ac.currentTime]);
  });

  it('a brand-new voice starts at its own pitch, not at the 440 Hz default (#734)', () => {
    const t = harness();
    t.process({ voices: [t.voice(3, true, 110)] });
    const partials = t.oscillators.filter((o) => o.frequency.calls.some((c) => c[0] === 'target'));
    expect(partials.length).toBeGreaterThan(0);
    for (const o of partials) {
      expect(o.frequency.calls[0]![0]).toBe('set');
      const target = o.frequency.calls.find((c) => c[0] === 'target')!;
      expect(o.frequency.calls[0]![1]).toBe(target[1]); // the glide starts where it ends
    }
  });
});
