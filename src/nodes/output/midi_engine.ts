/**
 * Browser-only WEBMIDI.js adapter for the `midi-out` node — the real
 * {@link MidiSink} the node drives, kept out of the node module so the node's
 * note/CC contract logic stays Node-safe and headlessly testable (mirroring how
 * `lyria_engine.ts` is the browser impl behind the `lyria` node's facade).
 *
 * This module statically imports WEBMIDI.js, so it must only ever be reached via
 * the node's *dynamic* `import('./midi_engine')` — which fires the first time MIDI
 * output is enabled in a browser. It is never imported by Node tests or the node
 * definition itself, so the vendor library (and any MIDI-access permission prompt)
 * is pulled in strictly on demand.
 *
 * {@link openWebMidiSink} feature-detects `navigator.requestMIDIAccess` before
 * touching the library, enables Web MIDI (no sysex), and binds a sink to the chosen
 * output port (or the first available). It resolves — never throws — a
 * {@link MidiOpenResult} whose `sink` is null (with a `reason`) when Web MIDI is
 * unsupported, no ports exist, or the requested port is missing.
 */
import { webMidiSupported, type MidiOpenResult, type MidiSink } from './midi_out';

export async function openWebMidiSink({ portName }: { portName: string }): Promise<MidiOpenResult> {
  // Guard here too (the node also gates) so the adapter is safe if ever called
  // directly on Safari/iOS: never import the vendor library where it can't work.
  if (!webMidiSupported()) return { sink: null, ports: [], reason: 'unsupported' };

  const { WebMidi } = await import('webmidi');
  try {
    await WebMidi.enable(); // requests MIDI access (no sysex); idempotent if already enabled
  } catch {
    return { sink: null, ports: [], reason: 'error' };
  }

  const outputs = WebMidi.outputs;
  const ports = outputs.map((o) => o.name);
  if (outputs.length === 0) return { sink: null, ports, reason: 'no-ports' };

  const chosen = portName ? outputs.find((o) => o.name === portName) : outputs[0];
  if (!chosen) return { sink: null, ports, reason: 'port-not-found' };

  const sink: MidiSink = {
    portName: chosen.name,
    noteOn(channel, note, velocity) {
      // WEBMIDI.js channels are 1-indexed (channels[1]..channels[16]); rawAttack is
      // the raw 0..127 note-on velocity. The node only sends channels 1..16.
      chosen.channels[channel]?.playNote(note, { rawAttack: velocity });
    },
    noteOff(channel, note) {
      chosen.channels[channel]?.stopNote(note);
    },
    controlChange(channel, controller, value) {
      chosen.channels[channel]?.sendControlChange(controller, value);
    },
    allNotesOff() {
      try {
        chosen.sendAllNotesOff();
        chosen.sendAllSoundOff();
      } catch {
        /* best effort — a device may not honour these; the node also tracks note-offs */
      }
    },
    close() {
      // WebMidi is a process-wide singleton shared with any other MIDI use, so we
      // don't disable it — just make sure this port is left silent.
      try {
        chosen.sendAllNotesOff();
      } catch {
        /* ignore */
      }
    },
  };

  return { sink, ports };
}
