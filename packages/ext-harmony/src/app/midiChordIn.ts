/**
 * MIDI in for the chord map (H8 of #613, "MIDI chooses, the camera performs"): while the chord
 * map follows MIDI (`chordMap.follow` = `midi`), listen to every Web MIDI input and publish the
 * notes held to the hot store's transient `chordMapMidi`, which `store-controls` feeds to the
 * chord map node. Off, it listens to nothing (no permission prompt for a player who never asked).
 *
 * Safari has no Web MIDI, as for MIDI out: the field then says `available: false` and the panel
 * says so. Held notes follow note-on (velocity above 0) and note-off (or note-on at velocity 0),
 * per input and channel; a held sustain pedal keeps released notes held, as a pianist expects.
 * The `startPatternPlaySync` pattern.
 */
import { harmonyControls } from './controls';

import { createHeldNotes, type MidiHeld } from '../lib/midi_held';

type MapState = { chordMap?: { enabled?: boolean; follow?: string } };

/** The smallest slice of Web MIDI this reads (so a test can hand it a fake). */
export interface MidiAccessLike {
  inputs: { forEach(cb: (input: MidiInputLike) => void): void };
  /** A port came or went: `port.state` is 'disconnected' for an unplugged one. */
  onstatechange: ((e: { port?: { id: string; state?: string } }) => void) | null;
}
export interface MidiInputLike {
  id: string;
  onmidimessage: ((e: { data: Uint8Array | number[] }) => void) | null;
}

export interface MidiChordInDeps {
  store?: { getState(): MapState; subscribe(l: (s: MapState) => void): () => void };
  publish?: (held: MidiHeld | null) => void;
  request?: (() => Promise<MidiAccessLike>) | null;
}

const browserRequest = (): (() => Promise<MidiAccessLike>) | null => {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as unknown as { requestMIDIAccess?: () => Promise<MidiAccessLike> });
  return nav && typeof nav.requestMIDIAccess === 'function' ? () => nav.requestMIDIAccess!() : null;
};

/** Start watching the dial; listens only while the map follows MIDI. Returns the unsubscribe. */
export function startMidiChordIn(deps: MidiChordInDeps = {}): () => void {
  const store = deps.store ?? (harmonyControls.store() as unknown as NonNullable<MidiChordInDeps['store']>);
  const publish = deps.publish ?? ((held) => harmonyControls.setTransient('chordMapMidi', held));
  const request = deps.request === undefined ? browserRequest() : deps.request;
  let access: MidiAccessLike | null = null;
  let listening = false;
  let generation = 0;
  const notes = createHeldNotes();
  let inputs = 0;
  /** What was published last, so a clock tick or active sensing writes nothing. */
  let lastSent = '';
  const send = (held: MidiHeld | null) => {
    const key = JSON.stringify(held);
    if (key === lastSent) return;
    lastSent = key;
    publish(held);
  };
  const sendHeld = () => send({ available: true, inputs, held: notes.held() });

  const attach = (a: MidiAccessLike) => {
    inputs = 0;
    a.inputs.forEach((input) => {
      inputs += 1;
      input.onmidimessage = (e) => {
        notes.message(input.id, e.data);
        sendHeld();
      };
    });
    sendHeld();
  };
  const detach = () => {
    access?.inputs.forEach((input) => {
      input.onmidimessage = null;
    });
    if (access) access.onstatechange = null;
    access = null;
    // Keys released while nobody listened must not come back held.
    notes.clear();
  };

  const apply = (s: MapState) => {
    const want = s.chordMap?.enabled === true && s.chordMap.follow === 'midi';
    if (want === listening) return;
    listening = want;
    const mine = ++generation;
    if (!want) {
      detach();
      send(null);
      return;
    }
    if (!request) {
      send({ available: false, inputs: 0, held: [], reason: 'unsupported' });
      return;
    }
    send({ available: false, inputs: 0, held: [], reason: 'pending' });
    request()
      .then((a) => {
        if (mine !== generation) return;
        access = a;
        attach(a);
        // A keyboard plugged in later is heard too; one unplugged mid-chord lets its notes go.
        a.onstatechange = (e) => {
          if (mine !== generation) return;
          if (e?.port?.state === 'disconnected') notes.clear(e.port.id);
          attach(a);
        };
      })
      .catch(() => {
        if (mine === generation) send({ available: false, inputs: 0, held: [], reason: 'denied' });
      });
  };
  apply(store.getState());
  const unsubscribe = store.subscribe(apply);
  return () => {
    unsubscribe();
    generation += 1;
    detach();
    send(null);
  };
}
