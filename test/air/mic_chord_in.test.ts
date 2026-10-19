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
    // The room (a quiet hiss), then an A at 440 Hz: the bin nearest it loud.
    const room = new Float32Array(4096).fill(-110);
    const a440 = new Float32Array(4096).fill(-110);
    a440[Math.round(440 / (44100 / 8192))] = -30;
    let db = room;
    const mic: MicLike = { sampleRate: 44100, fftSize: 8192, read: () => db, close: () => void (closed += 1) };
    const published: (AudioHeard | null)[] = [];
    const s = store('hands');
    startMicChordIn({ store: s, publish: (h) => published.push(h), open: () => (opened++, Promise.resolve(mic)), every: (fn) => ((tick = fn), () => (tick = null)) });
    expect(opened).toBe(0);
    s.set('audio');
    expect(published[published.length - 1]).toMatchObject({ reason: 'pending' });
    await Promise.resolve();
    await Promise.resolve();
    for (let i = 0; i < 10; i++) tick!();
    // The room: published once, not ten times (every write is a persist pass).
    expect(published.filter((h) => h?.available && !h.sounding)).toHaveLength(1);
    db = a440;
    tick!();
    const heard = published[published.length - 1]!;
    expect(heard).toMatchObject({ available: true, sounding: true });
    expect(heard.chroma[9]).toBe(1); // A
    s.set('hands');
    expect(published[published.length - 1]).toBeNull();
    expect(closed).toBe(1);
    expect(tick).toBeNull();
  });

  it('says it is unsupported, or refused', async () => {
    const a: (AudioHeard | null)[] = [];
    startMicChordIn({ store: store('audio'), publish: (h) => a.push(h), open: null });
    expect(a).toEqual([{ available: false, chroma: [], sounding: false, reason: 'unsupported' }]);
    const b: (AudioHeard | null)[] = [];
    startMicChordIn({ store: store('audio'), publish: (h) => b.push(h), open: () => Promise.reject(new Error('no')) });
    await Promise.resolve();
    await Promise.resolve();
    expect(b[b.length - 1]).toMatchObject({ reason: 'denied' });
    const c: (AudioHeard | null)[] = [];
    startMicChordIn({ store: store('audio'), publish: (h) => c.push(h), open: () => Promise.reject(Object.assign(new Error('no'), { failed: true })) });
    await Promise.resolve();
    await Promise.resolve();
    expect(c[c.length - 1]).toMatchObject({ reason: 'failed', available: false });
  });

  it('turns the analyser\'s decibels into magnitudes, silence into nothing', () => {
    expect([...magnitudesOf([0, -20, -Infinity])]).toEqual([1, 0.1, 0]);
  });
});
