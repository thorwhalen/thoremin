/**
 * Held notes from MIDI (H8 of #613): what the chord map reads when a keyboard chooses its chords,
 * and the bookkeeping that turns MIDI messages into the notes held. Pure: the Web MIDI listener
 * is the app half (`../app/midiChordIn`).
 */

/** What the chord map reads: the notes held, and whether there is anything to hear them from.
 *  `reason` says why nothing can be heard: the browser has no Web MIDI, the player refused it, or
 *  the browser is still asking. */
export interface MidiHeld {
  available: boolean;
  inputs: number;
  held: number[];
  reason?: 'unsupported' | 'denied' | 'pending';
}

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL = 0xb0;
const SUSTAIN = 64;
/** All sound off, all notes off: a keyboard's panic, which must free every note. */
const ALL_OFF = [120, 123];

/** The held-note bookkeeping, per input and channel, with the sustain pedal. Pure. */
export function createHeldNotes() {
  const down = new Map<string, Set<number>>();
  const sustained = new Map<string, Set<number>>();
  const pedal = new Set<string>();
  const of = (m: Map<string, Set<number>>, k: string) => m.get(k) ?? m.set(k, new Set()).get(k)!;
  return {
    message(source: string, data: ArrayLike<number>): void {
      const status = data[0] ?? 0;
      const kind = status & 0xf0;
      const key = `${source}:${status & 0x0f}`;
      const note = data[1] ?? 0;
      const value = data[2] ?? 0;
      if (kind === NOTE_ON && value > 0) {
        of(down, key).add(note);
        of(sustained, key).delete(note);
      } else if (kind === NOTE_OFF || (kind === NOTE_ON && value === 0)) {
        of(down, key).delete(note);
        if (pedal.has(key)) of(sustained, key).add(note);
      } else if (kind === CONTROL && ALL_OFF.includes(note)) {
        of(down, key).clear();
        of(sustained, key).clear();
      } else if (kind === CONTROL && note === SUSTAIN) {
        if (value >= 64) pedal.add(key);
        else {
          pedal.delete(key);
          of(sustained, key).clear();
        }
      }
    },
    /** Forget an input's notes (it was unplugged), or every input's. */
    clear(source?: string): void {
      for (const m of [down, sustained]) for (const k of [...m.keys()]) if (source === undefined || k.startsWith(`${source}:`)) m.delete(k);
      for (const k of [...pedal]) if (source === undefined || k.startsWith(`${source}:`)) pedal.delete(k);
    },
    held(): number[] {
      const all = new Set<number>();
      for (const m of [down, sustained]) for (const s of m.values()) for (const n of s) all.add(n);
      return [...all].sort((a, b) => a - b);
    },
  };
}

