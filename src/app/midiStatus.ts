/**
 * midiStatus — a tiny store the engine writes the live `midi-out` status into
 * (throttled), so the settings panel can render an honest MIDI control (#137):
 * the live device list, the connection phase, and "unsupported here" instead of
 * a dead toggle. Ephemeral per-frame runtime state, exactly like `faceStatus` —
 * the DAG produces it; React only displays it.
 */
import { create } from 'zustand';
import type { MidiStatus } from '@/nodes/browser';

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
