/**
 * Musical time for the harmonic instruments (H9 of #613): the beat from a song's or a
 * conductor's stream, the realizer's figuration on it, and a held change committed on the beat.
 */
import { describe, it, expect } from 'vitest';
import { beatAt, createBeatQuantizer } from '@thoremin/sdk/harmony/clock';
import { createRealizer, DEFAULT_CONTROLS, DEFAULT_SPEC, tonesInRegister } from '@thoremin/sdk/harmony/realize';

describe('the beat from musical time', () => {
  it('extrapolates a running stream, holds a held one, and has none while it waits', () => {
    expect(beatAt({ t: 10, beat: 4, tempo: 120, state: 'running' }, 10.25)).toBeCloseTo(4.5);
    expect(beatAt({ t: 10, beat: 4, tempo: 120, state: 'hold' }, 11)).toBe(4);
    expect(beatAt({ t: 10, beat: 0, tempo: 120, state: 'ready' }, 11)).toBeNull();
    expect(beatAt(undefined, 11)).toBeNull();
  });

  it('steps an arpeggio on the music\'s beats rather than its own tempo', () => {
    const r = createRealizer({ idBase: 0, maxVoices: 3 });
    const at = (beat: number) =>
      r.render({ tones: tonesInRegister([60, 64, 67]), spec: { ...DEFAULT_SPEC, figuration: 'arpUp' }, controls: DEFAULT_CONTROLS, bpm: 60, gain: 1, sound: 'sine', silentSound: 'sine', dt: 1 / 60, beat }).voices.findIndex((v) => v.gain > 0);
    const first = at(0);
    expect(r.beat()).toBe(0);
    expect(at(0.5)).not.toBe(first); // half a beat on: the next arpeggio note (eighths), whatever the tempo says
    expect(r.beat()).toBe(0.5);
  });
});

describe('committing a change on the beat', () => {
  it('waits for the next beat, takes a beat just passed, and drops a change undone in time', () => {
    const q = createBeatQuantizer(-1);
    expect(q.push(0, 2.5, 1)).toBe(-1); // mid-beat: waits
    expect(q.pending()).toBe(0);
    expect(q.push(0, 2.99, 1)).toBe(-1);
    expect(q.push(0, 3.0, 1)).toBe(0); // on the beat
    expect(q.push(3, 4.05, 1)).toBe(3); // just after a beat: that beat
    expect(q.push(5, 4.5, 1)).toBe(3);
    expect(q.push(3, 4.7, 1)).toBe(3); // undone before its beat: never sounds
    expect(q.pending()).toBeUndefined();
    expect(q.push(5, 4.8, 2)).toBe(3); // every other beat: lands on 6
    expect(q.push(5, 5.5, 2)).toBe(3);
    expect(q.push(5, 6.0, 2)).toBe(5);
  });
});
