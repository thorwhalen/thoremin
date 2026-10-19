/**
 * MIDI in for the chord map (H8 of #613): held notes from MIDI messages (the sustain pedal
 * included), and the listener that opens only while the map follows MIDI.
 */
import { describe, it, expect } from 'vitest';
import { createHeldNotes, type MidiHeld } from '@thoremin/ext-air/lib/midi_held';
import { startMidiChordIn, type MidiAccessLike, type MidiInputLike } from '@thoremin/ext-air/app/midiChordIn';

describe('held notes', () => {
  it('follows note on and off (and note on at velocity 0), per input', () => {
    const h = createHeldNotes();
    h.message('a', [0x90, 60, 100]);
    h.message('a', [0x90, 64, 90]);
    h.message('b', [0x91, 67, 80]);
    expect(h.held()).toEqual([60, 64, 67]);
    h.message('a', [0x80, 60, 0]);
    h.message('b', [0x91, 67, 0]);
    expect(h.held()).toEqual([64]);
  });

  it('keeps released notes while the sustain pedal is down', () => {
    const h = createHeldNotes();
    h.message('a', [0xb0, 64, 127]);
    h.message('a', [0x90, 60, 100]);
    h.message('a', [0x80, 60, 0]);
    expect(h.held()).toEqual([60]);
    h.message('a', [0xb0, 64, 0]);
    expect(h.held()).toEqual([]);
  });

  it('frees every note on all-notes-off, and an unplugged input\'s on clear', () => {
    const h = createHeldNotes();
    h.message('a', [0x90, 60, 100]);
    h.message('b', [0x90, 64, 100]);
    h.message('a', [0xb0, 123, 0]);
    expect(h.held()).toEqual([64]);
    h.clear('b');
    expect(h.held()).toEqual([]);
  });
});

describe('the MIDI listener', () => {
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

  it('listens only while the map follows MIDI, and publishes what is held', async () => {
    const input: MidiInputLike = { id: 'k', onmidimessage: null };
    const access: MidiAccessLike = { inputs: { forEach: (cb) => cb(input) }, onstatechange: null };
    const published: (MidiHeld | null)[] = [];
    let asked = 0;
    const s = store('hands');
    startMidiChordIn({ store: s, publish: (h) => published.push(h), request: () => (asked++, Promise.resolve(access)) });
    expect(asked).toBe(0); // no permission prompt for a player who never asked
    s.set('midi');
    await Promise.resolve();
    await Promise.resolve();
    input.onmidimessage!({ data: [0x90, 60, 100] });
    expect(published[published.length - 1]).toEqual({ available: true, inputs: 1, held: [60] });
    s.set('hands');
    expect(published[published.length - 1]).toBeNull();
    expect(input.onmidimessage).toBeNull();
    // Released while nobody listened: not held when listening again.
    s.set('midi');
    await Promise.resolve();
    await Promise.resolve();
    expect(published[published.length - 1]).toEqual({ available: true, inputs: 1, held: [] });
    // A keyboard unplugged mid-chord lets its notes go; a clock tick publishes nothing.
    input.onmidimessage!({ data: [0x90, 64, 100] });
    const before = published.length;
    input.onmidimessage!({ data: [0xf8] });
    expect(published.length).toBe(before);
    access.onstatechange!({ port: { id: 'k', state: 'disconnected' } });
    expect(published[published.length - 1]).toEqual({ available: true, inputs: 1, held: [] });
  });

  it('says it is waiting while the browser asks, and that access was refused', async () => {
    const published: (MidiHeld | null)[] = [];
    startMidiChordIn({ store: store('midi'), publish: (h) => published.push(h), request: () => Promise.reject(new Error('no')) });
    expect(published[0]).toMatchObject({ reason: 'pending' });
    await Promise.resolve();
    await Promise.resolve();
    expect(published[published.length - 1]).toMatchObject({ available: false, reason: 'denied' });
  });

  it('says so where the browser has no Web MIDI', () => {
    const published: (MidiHeld | null)[] = [];
    startMidiChordIn({ store: store('midi'), publish: (h) => published.push(h), request: null });
    expect(published).toEqual([{ available: false, inputs: 0, held: [], reason: 'unsupported' }]);
  });
});
