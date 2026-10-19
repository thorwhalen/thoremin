// @vitest-environment jsdom
/**
 * The MIDI section's "Mute silences MIDI too" toggle writes the store (#391 item 9; the MIDI slice's
 * since #600 S13, moved from `test/panel_controls_dispatch.test.tsx` with its assertions): it
 * dispatches through the command registry (`dispatchDialSet`), so a write reaches both the dials
 * store and the hot store the graph reads. `midi_panel` covers the controls' presence.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MidiControls } from '@/slices/midi/panels/midi';
import { useMidiStatus } from '@/slices/midi/app/midiStatus';
import { dialsStore } from '@/app/dials/settingsStore';
// The dial write path and the dials form the panel reaches through the SDK (they install its host).
import '@/app/dispatchDial';
import '@/app/dials/useDialsSettings';
import { useControls } from '@/app/store';
import { MIDI } from '../helpers/extensions';

const effective = (key: string) => dialsStore.getState().effective[key];
const drain = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

afterEach(() => {
  cleanup();
  useMidiStatus.getState().reset();
  Reflect.deleteProperty(navigator, 'requestMIDIAccess');
});

describe.runIf(MIDI)('MIDI: the "Mute silences MIDI too" toggle', () => {
  /** Pretend this browser has Web MIDI (jsdom has none). */
  const stubWebMidi = () => {
    (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess = () => Promise.reject(new Error('stub'));
  };

  it('is disabled while MIDI is off; once on, unticking and reticking writes the dial and the hot store', async () => {
    stubWebMidi();
    render(<MidiControls />);
    const toggle = screen.getByLabelText('Mute silences MIDI too') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Send to MIDI output'));
    await drain();
    expect(effective('midi.enabled')).toBe(true);
    expect(toggle.disabled).toBe(false);

    fireEvent.click(toggle);
    await drain();
    expect(effective('midi.muteFollowsMaster')).toBe(false);
    expect((useControls.getState() as unknown as { midi: { muteFollowsMaster: boolean } }).midi.muteFollowsMaster).toBe(false);
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    await drain();
    expect(effective('midi.muteFollowsMaster')).toBe(true);
    expect((useControls.getState() as unknown as { midi: { muteFollowsMaster: boolean } }).midi.muteFollowsMaster).toBe(true);

    // Restore for the other tests.
    fireEvent.click(screen.getByLabelText('Send to MIDI output'));
    await drain();
    expect(effective('midi.enabled')).toBe(false);
  });
});

