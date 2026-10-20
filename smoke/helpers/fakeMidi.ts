/**
 * A Web MIDI stand-in, installed from the test before the app loads: one output port that records
 * every message the app sends, and one input port the test can play notes into. Headless Chromium
 * has no MIDI devices, so without it neither MIDI output nor the chord instruments that follow a
 * keyboard can be exercised at all.
 *
 * It implements the part of `MIDIAccess` / `MIDIPort` that the app's two MIDI users read: WEBMIDI.js
 * for the output (`outputs` / `inputs` maps, `open`, `send`, the state fields, `onstatechange`) and
 * the harmony extension's chord input (`inputs.forEach`, `onmidimessage`).
 */
import type { Page } from '@playwright/test';

/** One message the app sent: its bytes. */
export type SentMidi = number[];

declare global {
  interface Window {
    __smokeMidi?: { sent(): SentMidi[]; clear(): void; noteOn(note: number, velocity?: number): void; noteOff(note: number): void };
  }
}

function fakeMidiInPage(): void {
  const sent: SentMidi[] = [];
  const port = (id: string, name: string, type: 'input' | 'output') => ({
    id,
    name,
    type,
    manufacturer: 'thoremin smoke',
    version: '1',
    state: 'connected',
    connection: 'closed',
    onstatechange: null as unknown,
    onmidimessage: null as null | ((e: { data: Uint8Array; timeStamp: number }) => void),
    open() {
      this.connection = 'open';
      return Promise.resolve(this);
    },
    close() {
      this.connection = 'closed';
      return Promise.resolve(this);
    },
    clear() {},
    send(data: ArrayLike<number>) {
      sent.push(Array.from(data));
    },
    addEventListener() {},
    removeEventListener() {},
  });
  const output = port('smoke-out', 'Smoke MIDI out', 'output');
  const input = port('smoke-in', 'Smoke MIDI in', 'input');
  const access = {
    inputs: new Map([[input.id, input]]),
    outputs: new Map([[output.id, output]]),
    sysexEnabled: false,
    onstatechange: null,
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true, value: () => Promise.resolve(access) });
  const deliver = (bytes: number[]) => input.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp: performance.now() });
  window.__smokeMidi = {
    sent: () => sent.slice(),
    clear: () => void (sent.length = 0),
    noteOn: (note, velocity = 100) => deliver([0x90, note, velocity]),
    noteOff: (note) => deliver([0x80, note, 0]),
  };
}

/** Install the stand-in on a page; call before `page.goto`. */
export async function installFakeMidi(page: Page): Promise<void> {
  await page.addInitScript(fakeMidiInPage);
}

/** The note-ons among `messages` (status 0x9n with a velocity), as MIDI note numbers. */
export function noteOns(messages: SentMidi[]): number[] {
  return messages.filter((m) => (m[0] & 0xf0) === 0x90 && m[2] > 0).map((m) => m[1]);
}
