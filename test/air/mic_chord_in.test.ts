/**
 * The microphone for the chord map (H8 of #613, second part): opened only while the map follows
 * it, read on a pace, closed when the map stops following it; pending, refused and unsupported
 * said apart.
 */
import { describe, it, expect } from 'vitest';
import { magnitudesOf, startMicChordIn, type MicLike } from '@thoremin/ext-air/app/micChordIn';
import type { AudioHeard } from '@thoremin/ext-air/lib/audio_heard';

const store = (follow: string) => {
  let state = { chordMap: { enabled: true, follow } };
  const subs: ((s: typeof state) => void)[] = [];
  return {
    getState: () => state,
    subscribe: (l: (s: typeof state) => void) => (subs.push(l), () => undefined),
    set: (f: string) => {
      state = { chordMap: { enabled: true, follow: f } };
      subs.forEach((l) => l(state));
    },
  };
};

describe('the microphone listener', () => {
  it('opens only while the map follows it, publishes the chroma on its pace, and closes', async () => {
    let opened = 0;
    let closed = 0;
    let tick: (() => void) | null = null;
    // An A at 440 Hz: the bin nearest it loud, everything else silent.
    const db = new Float32Array(4096).fill(-Infinity);
    db[Math.round(440 / (44100 / 8192))] = -20;
    const mic: MicLike = { sampleRate: 44100, fftSize: 8192, read: () => db, close: () => void (closed += 1) };
    const published: (AudioHeard | null)[] = [];
    const s = store('hands');
    startMicChordIn({ store: s, publish: (h) => published.push(h), open: () => (opened++, Promise.resolve(mic)), every: (fn) => ((tick = fn), () => (tick = null)) });
    expect(opened).toBe(0);
    s.set('audio');
    expect(published[published.length - 1]).toMatchObject({ reason: 'pending' });
    await Promise.resolve();
    await Promise.resolve();
    tick!();
    const heard = published[published.length - 1]!;
    expect(heard.available).toBe(true);
    expect(heard.chroma[9]).toBe(1); // A
    s.set('hands');
    expect(published[published.length - 1]).toBeNull();
    expect(closed).toBe(1);
    expect(tick).toBeNull();
  });

  it('says it is unsupported, or refused', async () => {
    const a: (AudioHeard | null)[] = [];
    startMicChordIn({ store: store('audio'), publish: (h) => a.push(h), open: null });
    expect(a).toEqual([{ available: false, chroma: [], energy: 0, reason: 'unsupported' }]);
    const b: (AudioHeard | null)[] = [];
    startMicChordIn({ store: store('audio'), publish: (h) => b.push(h), open: () => Promise.reject(new Error('no')) });
    await Promise.resolve();
    await Promise.resolve();
    expect(b[b.length - 1]).toMatchObject({ reason: 'denied' });
  });

  it('turns the analyser\'s decibels into magnitudes, silence into nothing', () => {
    expect([...magnitudesOf([0, -20, -Infinity])]).toEqual([1, 0.1, 0]);
  });
});
