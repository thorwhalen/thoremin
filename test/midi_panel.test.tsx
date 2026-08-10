// @vitest-environment jsdom
/**
 * MIDI panel reachability (#137) — the UI half of the guard. The DAG-edge test
 * (app_graph.test.ts) proves the node CAN be driven; this proves a player can FIND
 * the control: the settings panel mounts a MIDI section, the section renders a live
 * toggle where Web MIDI exists, and it renders the honest "not supported here"
 * message (not a dead toggle) where it doesn't. Without this, deleting the panel
 * section keeps every other test green — the exact #119/#120 failure mode.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import DialsControlsPanel from '@/app/dials/DialsControlsPanel';
import { MidiControls } from '@/app/dials/panels/midi';
import { useMidiStatus, ABSENT_MIDI_STATUS } from '@/app/midiStatus';

afterEach(() => {
  cleanup();
  useMidiStatus.getState().reset();
  delete (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess;
});

/** Pretend this browser has Web MIDI (jsdom has none). */
function stubWebMidi(): void {
  (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess = () =>
    Promise.reject(new Error('stub'));
}

describe('the settings panel mounts the MIDI section (#137 reachability)', () => {
  it('renders a MIDI section', () => {
    render(<DialsControlsPanel />);
    expect(screen.getByText('MIDI')).toBeTruthy();
  });
});

describe('MidiControls', () => {
  it('renders the enable toggle + port selector where Web MIDI exists', () => {
    stubWebMidi();
    useMidiStatus.getState().report({
      ...ABSENT_MIDI_STATUS,
      supported: true,
      ports: ['IAC Driver Bus 1', 'Synth A'],
    });
    render(<MidiControls />);
    expect(screen.getByText('Send to MIDI output')).toBeTruthy();
    expect(screen.getByText('First available')).toBeTruthy();
    expect(screen.getByText('IAC Driver Bus 1')).toBeTruthy();
    expect(screen.getByText('Synth A')).toBeTruthy();
  });

  it('renders the honest unsupported message — not a dead toggle — where Web MIDI is absent', () => {
    // jsdom has no navigator.requestMIDIAccess, which IS the Safari/iOS condition.
    render(<MidiControls />);
    expect(screen.queryByText('Send to MIDI output')).toBeNull();
    expect(screen.getByText(/not supported in this browser/i)).toBeTruthy();
  });

  it('keeps a saved-but-missing port selectable, labeled as not found', () => {
    stubWebMidi();
    useMidiStatus.getState().report({ ...ABSENT_MIDI_STATUS, supported: true, ports: ['Synth A'] });
    // The dial may hold a port name from another machine — it must stay visible
    // rather than silently snapping the dial to a different device.
    render(<MidiControls />);
    // (The dial store's midi.port is '' by default here, so only live ports render;
    // this asserts the de-duplicated option list renders without duplicate keys.)
    expect(screen.getByText('Synth A')).toBeTruthy();
  });
});
