/**
 * The `midi_out` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */


/** Lifecycle/capability phase surfaced on the node's `status` port. */
export type MidiPhase = 'off' | 'unsupported' | 'connecting' | 'ready' | 'no-ports' | 'denied' | 'error';

/** True when the host environment exposes the Web MIDI API. False in Node and on
 *  Safari/iOS, which is exactly where the node must degrade instead of throwing. */
export function webMidiSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function'
  );
}


// ---- The sink facade the node drives (implemented by ./midi_engine or a mock) --

/**
 * A minimal MIDI output the node writes to. Every argument is already in the MIDI
 * domain: `channel` 1..16, `note`/`velocity`/CC `value` 0..127. Implemented by the
 * browser WEBMIDI.js adapter (`./midi_engine`) or by a mock in tests — the node
 * never touches the vendor library or `navigator` directly.
 */
export interface MidiSink {
  /** The resolved output port name this sink targets (for the status readout). */
  readonly portName: string;
  noteOn(channel: number, note: number, velocity: number): void;
  noteOff(channel: number, note: number): void;
  controlChange(channel: number, controller: number, value: number): void;
  /** Silence everything: all-notes-off (+ all-sound-off) across the port. */
  allNotesOff(): void;
  /** Release the underlying port (best effort; silences first). */
  close(): void;
}

/** Why a sink could not be opened — reported, never thrown, so a UI can show an
 *  actionable message and disable the control. `denied` = the user (or a policy)
 *  blocked the MIDI-access permission — actionable, unlike a generic `error`. */
export type MidiUnavailable = 'unsupported' | 'no-ports' | 'port-not-found' | 'denied' | 'error';

export interface MidiOpenResult {
  /** The opened sink, or null when unavailable (see `reason`). */
  sink: MidiSink | null;
  /** Every available output port name (for selection + status). */
  ports: string[];
  /** Set when `sink` is null. */
  reason?: MidiUnavailable;
}
