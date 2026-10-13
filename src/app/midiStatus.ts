/**
 * midiStatus — a tiny store the engine writes the live `midi-out` status into
 * (throttled), so the settings panel can render an honest MIDI control (#137):
 * the live device list, the connection phase, and "unsupported here" instead of
 * a dead toggle. Ephemeral per-frame runtime state, exactly like `faceStatus` —
 * the DAG produces it; React only displays it. {@link makeMidiReporter} is the
 * per-frame sink the host loop (`useEngine.ts`) registers to write it.
 */
import { create } from 'zustand';
import type { MidiStatus } from '@/nodes/browser';
import type { OutputReader } from './generativeStatus';

/** The status before the engine has reported anything (or after teardown). */
export const ABSENT_MIDI_STATUS: MidiStatus = {
  phase: 'off',
  supported: false,
  portName: null,
  ports: [],
  activeNotes: 0,
  message: 'MIDI output off',
};

export interface MidiStatusState {
  status: MidiStatus;
  report(status: MidiStatus): void;
  reset(): void;
}

export const useMidiStatus = create<MidiStatusState>((set) => ({
  status: ABSENT_MIDI_STATUS,
  report: (status) => set({ status }),
  reset: () => set({ status: ABSENT_MIDI_STATUS }),
}));

/** Min interval (ms) between MIDI-status reports while notes are moving (#137).
 *  Phase / port-list changes always report immediately; this only paces the
 *  `activeNotes` counter so held-note changes don't re-render the panel 60×/s. */
const MIDI_REPORT_MS = 250;

/** The `midi-out` node's id in `graph.ts`. */
const MIDI_NODE_ID = 'midiOut';

/**
 * Build the per-frame sink that bridges the midi-out node's status to React (#137): the
 * settings panel renders the live device list and connection phase from it. Transitions
 * (phase / resolved port / device list) report immediately; the `activeNotes` counter is paced
 * so it can't re-render the panel 60×/s. Pure over the reader and the store, so it is testable
 * with a stub engine.
 *
 * @param now - the frame time in MILLISECONDS (the host converts the clock's seconds).
 */
export function makeMidiReporter(
  engine: OutputReader,
  store: { getState(): Pick<MidiStatusState, 'status' | 'report'> } = useMidiStatus,
): (now: number) => void {
  let lastMidiReport = 0;
  let lastMidiKey = '';
  return (now) => {
    const ms = engine.getOutput(MIDI_NODE_ID, 'status') as MidiStatus | undefined;
    if (!ms) return;
    const key = `${ms.phase}|${ms.portName ?? ''}|${ms.ports.join(',')}|${ms.message}`;
    const notesChanged = ms.activeNotes !== store.getState().status.activeNotes;
    if (key === lastMidiKey && (!notesChanged || now - lastMidiReport < MIDI_REPORT_MS)) return;
    store.getState().report(ms);
    lastMidiReport = now;
    lastMidiKey = key;
  };
}
