/**
 * The `drum-out` node (#233): the clock map from engine time to audio-context time,
 * and the scheduling logic over a mock sink — each hit played once at the mapped
 * instant, never in the past, nothing at any clock scale but real time, nothing
 * without an audio context, a malformed hit skipped.
 */
import { describe, it, expect } from 'vitest';
import { drumOutNode, type DrumSink } from '@thoremin/ext-air/nodes/drum_out';
import type { DrumHit } from '@thoremin/ext-air/nodes/air_drum';
import { engineToContextTime, scheduleAt, MIN_SCHEDULE_AHEAD_S } from '@thoremin/sdk/timing/clock_map';
import { OUTPUT_STAGE_PRIOR_S } from '@thoremin/sdk/timing/output_stage';
import { knownOutputStage } from '../helpers/timing';

describe('the clock map (the one shared through @thoremin/sdk/timing/clock_map)', () => {
  it('schedules a hit one output stage EARLIER on the context clock than its distance from the tick', () => {
    const ac = { currentTime: 5 };
    // Engine time 12.05 s is 50 ms after the tick at 12.0; with a 32 ms output stage the
    // sound must be written at 5.018 so it leaves the device at 5.05.
    expect(engineToContextTime(ac, 12.05, 12.0, 0.032)).toBeCloseTo(5.018, 9);
    expect(scheduleAt(ac, 12.05, 12.0, 0.032)).toBeCloseTo(5.018, 9);
  });

  it('never schedules behind the context clock: a late hit sounds at once', () => {
    const ac = { currentTime: 5 };
    expect(scheduleAt(ac, 11.99, 12.0, 0.032)).toBeCloseTo(5 + MIN_SCHEDULE_AHEAD_S, 9);
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

const hit = (t: number, over: Partial<DrumHit> = {}): DrumHit => ({ t, impactT: t, velocity: 0.7, hand: 'right', sound: 'kick', predicted: true, onTime: 'yes', lead: 0.05, lateBy: 0, pull: 0, ...over });

describe('drum-out node', () => {
  const ac = { currentTime: 10 } as unknown as AudioContext;
  const master = {} as AudioNode;

  it('plays each hit once at its mapped time (one output stage early), never before now', () => {
    const m = mockSink();
    const h = drumOutNode.make({});
    const resources = { audioContext: ac, masterGain: master, createDrumSink: () => m.sink, timeScale: 1, ...knownOutputStage(0.03) };
    const ctx = { tick: 1, time: 100, dt: 1 / 60, resources };
    h.process({ hits: [hit(100.05), hit(99.99, { sound: 'snare', predicted: false, onTime: 'late' })] }, ctx);
    expect(m.played).toHaveLength(2);
    expect(m.played[0].sound).toBe('kick');
    expect(m.played[0].velocity).toBe(0.7);
    expect(m.played[0].when).toBeCloseTo(10.05 - 0.03, 9);
    expect(m.played[1].sound).toBe('snare');
    expect(m.played[1].when).toBeCloseTo(10.001, 9); // a late ghost note sounds at once
    // The next tick with no hits plays nothing more.
    h.process({ hits: [] }, { ...ctx, tick: 2, time: 100.016 });
    expect(m.played).toHaveLength(2);
    h.dispose?.();
    expect(m.closed()).toBe(1);
  });

  it('without a timing resource the output stage is the stated prior, never 0 (Safari before the first tap)', () => {
    const m = mockSink();
    const h = drumOutNode.make({});
    const resources = { audioContext: ac, masterGain: master, createDrumSink: () => m.sink, timeScale: 1 };
    h.process({ hits: [hit(100.05)] }, { tick: 1, time: 100, dt: 1 / 60, resources });
    expect(m.played[0].when).toBeCloseTo(10.05 - OUTPUT_STAGE_PRIOR_S, 9);
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
    // packages/dag/src/timescale.ts), so a host that never declares a scale still sounds.
    h.process({ hits: [hit(100.05)] }, { tick: 3, time: 100.03, dt: 0.016, resources: base });
    expect(m.played).toHaveLength(1);
  });

  it('plays nothing on a context that is not running', () => {
    const m = mockSink();
    const h = drumOutNode.make({});
    const suspended = { currentTime: 10, state: 'suspended' } as unknown as AudioContext;
    const resources = { audioContext: suspended, masterGain: master, createDrumSink: () => m.sink, timeScale: 1 };
    h.process({ hits: [hit(100.05)] }, { tick: 1, time: 100, dt: 0.016, resources });
    expect(m.played).toHaveLength(0);
    const running = { currentTime: 10, state: 'running' } as unknown as AudioContext;
    h.process({ hits: [hit(100.05)] }, { tick: 2, time: 100.02, dt: 0.016, resources: { ...resources, audioContext: running } });
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
