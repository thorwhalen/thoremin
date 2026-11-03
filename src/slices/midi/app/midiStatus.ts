/**
 * midiStatus — a tiny store the engine writes the live `midi-out` status into
 * (throttled), so the settings panel can render an honest MIDI control (#137):
 * the live device list, the connection phase, and "unsupported here" instead of
 * a dead toggle. Ephemeral per-frame runtime state, exactly like `faceStatus` —
 * the DAG produces it; React only displays it. {@link MIDI_STATUS} is the store, its per-frame
 * reporter and its status hook; the slice (`../ui.tsx`) runs the hook on the page clock.
 */
import { createStatusStore, type StatusState } from '@thoremin/sdk-ui/statusStore';
import type { MidiStatus } from '../nodes/midi_out';

/** The status before the engine has reported anything (or after teardown). */
export const ABSENT_MIDI_STATUS: MidiStatus = {
  phase: 'off',
  supported: false,
  portName: null,
  ports: [],
  activeNotes: 0,
  message: 'MIDI output off',
};

export type MidiStatusState = StatusState<MidiStatus>;

/** Min interval (ms) between MIDI-status reports while notes are moving (#137).
 *  Phase / port-list changes always report immediately; this only paces the
 *  `activeNotes` counter so held-note changes don't re-render the panel 60×/s. */
const MIDI_REPORT_MS = 250;

/** The `midi-out` node's id in `graph.ts`. */
const MIDI_NODE_ID = 'midiOut';

/** The transitions, reported at once: the phase, the resolved port, the device list, the words. */
const midiKey = (ms: MidiStatus): string => `${ms.phase}|${ms.portName ?? ''}|${ms.ports.join(',')}|${ms.message}`;

/** MIDI's readout store, reporter and status hook (the shared readout store, #969), the
 *  `activeNotes` counter paced to {@link MIDI_REPORT_MS}. */
export const MIDI_STATUS = createStatusStore(MIDI_NODE_ID, {
  absent: ABSENT_MIDI_STATUS,
  keyOf: midiKey,
  throttle: { ms: MIDI_REPORT_MS, keyOf: (ms) => String(ms.activeNotes) },
});

export const useMidiStatus = MIDI_STATUS.useStatus;
