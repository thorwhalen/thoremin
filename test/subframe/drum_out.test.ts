/**
 * The `drum-out` node (#233): the clock map from engine time to audio-context time,
 * and the scheduling logic over a mock sink — each hit played once at the mapped
 * instant, never in the past, nothing at any clock scale but real time, nothing
 * without an audio context, a malformed hit skipped.
 */
import { describe, it, expect } from 'vitest';
import { drumOutNode, engineToContextTime, type DrumSink } from '@/nodes/browser';
import type { DrumHit } from '@/nodes';

describe('engineToContextTime', () => {
  it('uses the output timestamp pair when the context has one (the exact map)', () => {
    const ac = { currentTime: 5, getOutputTimestamp: () => ({ contextTime: 4.9, performanceTime: 12000 }) };
    // Engine time 12.05 s (performance base) is 50 ms after the paired instant.
    expect(engineToContextTime(ac, 12.05, 12.0)).toBeCloseTo(4.95, 9);
  });

  it('falls back to now plus the distance from the tick', () => {
    expect(engineToContextTime({ currentTime: 5 }, 12.05, 12.0)).toBeCloseTo(5.05, 9);
    const broken = { currentTime: 5, getOutputTimestamp: () => ({}) };
    expect(engineToContextTime(broken, 12.05, 12.0)).toBeCloseTo(5.05, 9);
  });
});

function mockSink() {
  const played: { sound: string; velocity: number; when: number }[] = [];
  let closed = 0;
  const sink: DrumSink = {
    play: (sound, velocity, when) => void played.push({ sound, velocity, when }),
    close: () => void closed++,
  };
  return { sink, played, closed: () => closed };
}

const hit = (t: number, over: Partial<DrumHit> = {}): DrumHit => ({ t, velocity: 0.7, hand: 'right', sound: 'kick', predicted: true, lead: 0.05, pull: 0, ...over });

describe('drum-out node', () => {
  const ac = { currentTime: 10 } as unknown as AudioContext;
  const master = {} as AudioNode;

  it('plays each hit once at its mapped time, never before now', () => {
    const m = mockSink();
    const h = drumOutNode.make({});
    const resources = { audioContext: ac, masterGain: master, createDrumSink: () => m.sink, timeScale: 1 };
    const ctx = { tick: 1, time: 100, dt: 1 / 60, resources };
    h.process({ hits: [hit(100.05), hit(99.99, { sound: 'snare', predicted: false })] }, ctx);
    expect(m.played).toHaveLength(2);
    expect(m.played[0].sound).toBe('kick');
    expect(m.played[0].velocity).toBe(0.7);
    expect(m.played[0].when).toBeCloseTo(10.05, 9);
    expect(m.played[1].sound).toBe('snare');
    expect(m.played[1].when).toBeCloseTo(10.001, 9); // a late ghost note sounds at once
    // The next tick with no hits plays nothing more.
    h.process({ hits: [] }, { ...ctx, tick: 2, time: 100.016 });
    expect(m.played).toHaveLength(2);
    h.dispose?.();
    expect(m.closed()).toBe(1);
  });

  it('is silent at any clock scale but real time, and without an audio context', () => {
    const m = mockSink();
    const h = drumOutNode.make({});
    const base = { audioContext: ac, masterGain: master, createDrumSink: () => m.sink };
    h.process({ hits: [hit(100.05)] }, { tick: 1, time: 100, dt: 0.016, resources: { ...base, timeScale: 0.5 } });
    expect(m.played).toHaveLength(0);
    h.process({ hits: [hit(100.05)] }, { tick: 2, time: 100.02, dt: 0.016, resources: { timeScale: 1 } });
    expect(m.played).toHaveLength(0);
    // Absent scale = a batch run = not real time either? No: absence means yes (see
    // src/dag/timescale.ts), so a host that never declares a scale still sounds.
    h.process({ hits: [hit(100.05)] }, { tick: 3, time: 100.03, dt: 0.016, resources: base });
    expect(m.played).toHaveLength(1);
  });

  it('skips a malformed hit list rather than throwing', () => {
    const m = mockSink();
    const h = drumOutNode.make({});
    const resources = { audioContext: ac, masterGain: master, createDrumSink: () => m.sink, timeScale: 1 };
    expect(() => h.process({ hits: [{ t: 'soon' }] }, { tick: 1, time: 100, dt: 0.016, resources })).not.toThrow();
    expect(() => h.process({ hits: 'nope' }, { tick: 2, time: 100.02, dt: 0.016, resources })).not.toThrow();
    expect(m.played).toHaveLength(0);
  });
});
