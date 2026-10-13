/**
 * The WebAudio drum sink (#233/#245) against a fake `AudioContext` that counts what it
 * builds (#391 item 4): a hit with no velocity (0, negative, NaN) schedules no voice at
 * all, and the one second of white noise is built once per sink and shared by every
 * noise burst after it, until `close()`.
 */
import { describe, expect, it } from 'vitest';
import { createWebAudioDrumSink } from '@thoremin/ext-air/nodes/drum_out';

function fakeContext() {
  const made = { oscillators: 0, sources: [] as { buffer: unknown; starts: number[] }[], buffers: [] as unknown[], filters: 0, gains: 0 };
  const param = () => ({ value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} });
  const node = () => ({ connect: () => {}, disconnect: () => {} });
  const ac = {
    // Small, so building the noise is cheap: the sink sizes it from the rate.
    sampleRate: 64,
    createOscillator: () => {
      made.oscillators++;
      return { ...node(), type: '', frequency: param(), start: () => {}, stop: () => {} };
    },
    createGain: () => {
      made.gains++;
      return { ...node(), gain: param() };
    },
    createBiquadFilter: () => {
      made.filters++;
      return { ...node(), type: '', frequency: param(), Q: param() };
    },
    createBuffer: (_ch: number, len: number) => {
      const data = new Float32Array(len);
      const buf = { getChannelData: () => data };
      made.buffers.push(buf);
      return buf;
    },
    createBufferSource: () => {
      const src = { ...node(), buffer: null as unknown, starts: [] as number[], start: (t: number) => void src.starts.push(t), stop: () => {} };
      made.sources.push(src);
      return src;
    },
  };
  return { ac: ac as unknown as AudioContext, made };
}

describe('createWebAudioDrumSink', () => {
  it.each([0, -0.3, Number.NaN])('a hit of velocity %s schedules nothing', (velocity) => {
    const { ac, made } = fakeContext();
    const sink = createWebAudioDrumSink(ac, {} as AudioNode);
    for (const sound of ['kick', 'snare', 'hihat', 'ride'] as const) sink.play(sound, velocity, 1);
    expect(made).toEqual({ oscillators: 0, sources: [], buffers: [], filters: 0, gains: 0 });
  });

  it('a tone-only drum builds no noise', () => {
    const { ac, made } = fakeContext();
    const sink = createWebAudioDrumSink(ac, {} as AudioNode);
    sink.play('kick', 0.8, 1);
    expect(made.oscillators).toBe(1);
    expect(made.buffers).toHaveLength(0);
  });

  it('builds the noise buffer once and reuses it across hits and drums', () => {
    const { ac, made } = fakeContext();
    const sink = createWebAudioDrumSink(ac, {} as AudioNode);
    sink.play('snare', 0.8, 1);
    sink.play('hihat', 0.5, 1.1);
    sink.play('crash', 1, 1.2, { radial: 0.7 });
    expect(made.buffers).toHaveLength(1);
    expect(made.sources).toHaveLength(3);
    for (const s of made.sources) expect(s.buffer).toBe(made.buffers[0]);
    expect(made.sources.map((s) => s.starts[0])).toEqual([1, 1.1, 1.2]);
  });

  it('close() lets the noise go; a later hit builds it afresh', () => {
    const { ac, made } = fakeContext();
    const sink = createWebAudioDrumSink(ac, {} as AudioNode);
    sink.play('snare', 0.8, 1);
    sink.close();
    sink.play('snare', 0.8, 2);
    expect(made.buffers).toHaveLength(2);
    expect(made.sources[1].buffer).toBe(made.buffers[1]);
  });
});
