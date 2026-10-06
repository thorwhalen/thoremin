/**
 * The WebAudio pluck sink (#249), against a fake AudioContext that records every
 * AudioParam call. The regression it guards: damping a ringing note by cancelling its
 * ENVELOPE's ramp snapped the note back to its peak until the damp began (a click and a
 * burst on nearly every re-pluck of a bass line). The damp is now its own gain node; the
 * envelope is never touched after it is scheduled.
 */
import { describe, it, expect } from 'vitest';
import { createWebAudioPluckSink } from '@thoremin/ext-air/nodes/pluck_out';

type Call = [string, ...number[]];

function fakeParam(calls: Call[]) {
  return {
    value: 1,
    setValueAtTime: (v: number, t: number) => void calls.push(['set', v, t]),
    exponentialRampToValueAtTime: (v: number, t: number) => void calls.push(['exp', v, t]),
    setTargetAtTime: (v: number, t: number, tau: number) => void calls.push(['target', v, t, tau]),
    cancelScheduledValues: (t: number) => void calls.push(['cancel', t]),
  };
}

function fakeContext() {
  const gains: { calls: Call[] }[] = [];
  const filters: Call[][] = [];
  const node = () => ({ connect: () => {}, disconnect: () => {} });
  const ac = {
    sampleRate: 48000,
    createOscillator: () => ({ ...node(), type: '', frequency: fakeParam([]), start: () => {}, stop: () => {}, onended: null }),
    createBiquadFilter: () => {
      const calls: Call[] = [];
      filters.push(calls);
      return { ...node(), type: '', frequency: fakeParam(calls), Q: fakeParam([]) };
    },
    createGain: () => {
      const g = { calls: [] as Call[] };
      gains.push(g);
      return { ...node(), gain: fakeParam(g.calls) };
    },
  };
  return { ac: ac as unknown as AudioContext, gains, filters };
}

/** Per note the sink builds three gains: the oscillator mix, the envelope, the damp. */
const GAINS_PER_NOTE = 3;
const envOf = (gains: { calls: Call[] }[], note: number) => gains[note * GAINS_PER_NOTE + 1];
const dampOf = (gains: { calls: Call[] }[], note: number) => gains[note * GAINS_PER_NOTE + 2];

describe('the WebAudio pluck sink', () => {
  it('damps a re-plucked mono voice on its damp gain, never by cancelling the envelope', () => {
    const { ac, gains } = fakeContext();
    const sink = createWebAudioPluckSink(ac, {} as AudioNode, { timbre: 'bass', mono: true });
    sink.play(40, 0.8, 1.0);
    sink.play(43, 0.8, 1.5); // inside the first note's 1.4 s decay
    expect(gains).toHaveLength(2 * GAINS_PER_NOTE);
    // No cancellation anywhere: the first note's envelope keeps its ramp.
    for (const g of gains) expect(g.calls.some((c) => c[0] === 'cancel')).toBe(false);
    expect(envOf(gains, 0).calls.at(-1)).toEqual(['exp', 0.0001, expect.closeTo(2.4, 6)]);
    // The first note's damp falls from 1 at the second note's start, quickly.
    const damp = dampOf(gains, 0).calls;
    expect(damp).toHaveLength(1);
    expect(damp[0][0]).toBe('target');
    expect(damp[0][1]).toBe(0);
    expect(damp[0][2]).toBe(1.5);
    expect(damp[0][3]).toBeLessThan(0.02);
    // The new note's damp is untouched.
    expect(dampOf(gains, 1).calls).toEqual([]);
  });

  it('polyphonic: a note damps only the previous note on its own voice', () => {
    const { ac, gains } = fakeContext();
    const sink = createWebAudioPluckSink(ac, {} as AudioNode, { timbre: 'guitar', mono: false });
    sink.play(40, 0.8, 1.0, 0);
    sink.play(47, 0.8, 1.01, 1);
    sink.play(52, 0.8, 1.02); // no voice: its own
    sink.play(41, 0.8, 1.5, 0); // re-pluck string 0
    expect(dampOf(gains, 0).calls.map((c) => c[0])).toEqual(['target']);
    expect(dampOf(gains, 1).calls).toEqual([]);
    expect(dampOf(gains, 2).calls).toEqual([]);
  });

  it('a zero-velocity note on a voice only damps it (a muted string)', () => {
    const { ac, gains } = fakeContext();
    const sink = createWebAudioPluckSink(ac, {} as AudioNode, { timbre: 'guitar', mono: false });
    sink.play(40, 0.8, 1.0, 0);
    sink.play(0, 0, 1.5, 0);
    expect(gains).toHaveLength(GAINS_PER_NOTE); // nothing new was built
    expect(dampOf(gains, 0).calls[0]).toEqual(['target', 0, 1.5, expect.any(Number)]);
  });

  it('never exceeds the timbre peak and keeps the filter below Nyquist', () => {
    const { ac, gains, filters } = fakeContext();
    const sink = createWebAudioPluckSink(ac, {} as AudioNode, { timbre: 'guitar', mono: false });
    sink.play(120, 1, 1); // a very high note: its bright attack would pass Nyquist
    const peak = envOf(gains, 0).calls.find((c) => c[0] === 'exp')!;
    expect(peak[1]).toBeLessThanOrEqual(1);
    for (const c of filters[0]) expect(c[1]).toBeLessThan(24000);
  });
});
