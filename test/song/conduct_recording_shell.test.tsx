// @vitest-environment jsdom
/**
 * "Conduct a recording" in the Conductor tool (#187 PR 7): reachable from a cold load and
 * does what it says. The shipping rule's test: Conductor (a pinned bar button), Conduct a
 * recording, Choose a recording, Start conducting (four clicks) sets the conductor to lead
 * the recording through the dial write path, loads the song with the Song tool's loader,
 * and composes the song's pace controller with the conductor (not the dancer's body); the
 * panel then says what the recording is doing, read off the engine by the reporter.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ConductorPanel from '@/app/ConductorPanel';
import { describeRecording } from '@/slices/song/panels/RecordingSection';
// The Song tool's panel, in the frame the shell opens an extension's tool in (#600 S15).
import ExtensionToolPanels from '@/app/ExtensionToolPanels';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { dialsStore } from '@/app/dials/settingsStore';
import { loadSongFile } from '@/slices/song/app/host';
import { makeSongReporter, PACE_NODE_ID, SONG_NODE_ID, useSongStatus } from '@/slices/song/app/songStatus';

import { branchIdsFor } from '@/app/graph';
import { dispatchDialSetIn } from '@/app/dispatchDial';
import type { DerivationSettings } from '@/instruments/derive';
import type { ConductorSettings } from '@/settings/schema';
import { renderClickTrack, SR } from '../helpers/clicks';
import { setSongHandle, setSongStartBeat, songStartBeat } from '@/slices/song/app/state';
import { SONG } from '../helpers/extensions';

const conductor = () => dialsStore.getState().effective.conductor as ConductorSettings;
const derived = () => branchIdsFor(useControls.getState() as unknown as DerivationSettings);

function clickFile() {
  const { samples } = renderClickTrack({ bpm: 120, seconds: 12 });
  const file = Object.assign(new Blob([new Uint8Array(8)], { type: 'audio/wav' }), {
    name: 'take.wav',
    arrayBuffer: async () => new ArrayBuffer(8),
  });
  const decode = async () => ({ channels: [samples], durationS: samples.length / SR });
  return { file, opts: { decode, makeUrl: () => 'blob:test-conduct' } };
}

beforeEach(async () => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  setSongHandle(null);
  useSongStatus.getState().reset();
  await dispatchDialSetIn('conductor.enabled', false);
  await dispatchDialSetIn('conductor.conducts', 'score');
});
afterEach(async () => {
  cleanup();
  await dispatchDialSetIn('conductor.enabled', false);
  await dispatchDialSetIn('conductor.conducts', 'score');
  setSongHandle(null);
});

describe.runIf(SONG)('Conduct a recording', () => {
  it('four clicks from a cold load: Conductor, Conduct a recording, Choose a recording, Start conducting', async () => {
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    expect(useTools.getState().open).toBe('conductor');

    fireEvent.click(screen.getByText('Conduct a recording'));
    await waitFor(() => expect(conductor().conducts).toBe('recording'));
    // The file picker's click (the third) cannot run in jsdom; its handler's work can.
    expect(screen.getByText('Choose a recording...')).toBeTruthy();
    const { file, opts } = clickFile();
    await act(async () => {
      await loadSongFile(file, opts);
    });
    expect(screen.getByText('take.wav')).toBeTruthy();
    expect(derived()).not.toContain('song-pace');

    fireEvent.click(screen.getByText('Start conducting'));
    await waitFor(() => expect(conductor().enabled).toBe(true));
    // The hot store follows the dial; the engine's derivation composes the pace controller
    // and the conductor that leads it, and no body camera.
    await waitFor(() => expect(derived()).toEqual(expect.arrayContaining(['conductor', 'song-pace'])));
    expect(derived()).not.toContain('body-source');
  });

  it('says what the recording is doing, from the engine through the reporter', async () => {
    useTools.setState({ open: 'conductor' });
    await dispatchDialSetIn('conductor.conducts', 'recording');
    await dispatchDialSetIn('conductor.enabled', true);
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    render(<ConductorPanel />);
    // The servo's reading reaches the section through the SONG's reporter (#600 S15: the
    // conductor's reporter read it before the song became a slice).
    const outputs: Record<string, Record<string, unknown>> = {
      [SONG_NODE_ID]: { status: { phase: 'active', message: 'Playing' } },
      [PACE_NODE_ID]: { servo: { t: 3, mode: 'following', rate: 0.834, playing: true, cue: { id: 1, beat: 0 }, error: -0.04 } },
    };
    const tick = makeSongReporter({ getOutput: (n, p) => outputs[n]?.[p] }, useSongStatus.getState());
    act(() => tick());
    expect(screen.getByTestId('conductor-recording-live').textContent).toBe('Playing at 83 % speed, 4 % of a beat behind.');
  });

  it('chooses the song beat the first beat lands on: typed, or "Here" while the song plays, reset by another song (#364)', async () => {
    useTools.setState({ open: 'conductor' });
    await dispatchDialSetIn('conductor.conducts', 'recording');
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    render(<ConductorPanel />);
    expect(songStartBeat()).toBe(0);
    fireEvent.change(screen.getByLabelText("Song beat the conductor's first beat lands on"), { target: { value: '8' } });
    await waitFor(() => expect(songStartBeat()).toBe(8));
    act(() => useSongStatus.setState({ live: { beat: 12, bpm: 120, positionS: 6 } }));
    fireEvent.click(screen.getByText('Here'));
    await waitFor(() => expect(songStartBeat()).toBe(12));
    // Before the first tracked beat, "Here" is beat 0.
    act(() => useSongStatus.setState({ live: { beat: -2, bpm: 120, positionS: 0 } }));
    fireEvent.click(screen.getByText('Here'));
    await waitFor(() => expect(songStartBeat()).toBe(0));
    act(() => setSongStartBeat(5));
    await loadSongFile(file, opts);
    expect(songStartBeat()).toBe(0);
  });

  it('the Song tool says the conductor leads the song', async () => {
    await dispatchDialSetIn('conductor.conducts', 'recording');
    await dispatchDialSetIn('conductor.enabled', true);
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    useTools.setState({ open: 'song' });
    render(<ExtensionToolPanels />);
    await waitFor(() => expect(screen.getByTestId('song-conducted')).toBeTruthy());
  });

  it('describes the servo in words', () => {
    expect(describeRecording(null)).toMatch(/no beat/);
    expect(describeRecording({ mode: 'cueing', rate: 1, error: 0 })).toMatch(/waits on its first beat/);
    expect(describeRecording({ mode: 'holding', rate: 1, error: 0 })).toMatch(/next beat/);
    expect(describeRecording({ mode: 'following', rate: 1.1, error: 0.001 })).toBe('Playing at 110 % speed, on your beat.');
    expect(describeRecording({ mode: 'following', rate: 1, error: 0.12 })).toBe('Playing at 100 % speed, 12 % of a beat ahead.');
  });

  it('says the song is loading, or waits for a tap, instead of "no beat" (#502)', () => {
    const idle = { mode: 'idle', rate: 1, error: 0 } as const;
    expect(describeRecording(idle, { phase: 'loading', message: 'Loading a.mp3...' })).toBe('Loading a.mp3...');
    expect(describeRecording(null, { phase: 'unavailable', reason: 'no-audio', message: 'x' })).toBe('Tap to play, then beat.');
    expect(describeRecording(idle, { phase: 'error', reason: 'decode', message: 'a.mp3 could not be played' })).toBe('a.mp3 could not be played');
    expect(describeRecording(idle, { phase: 'ready', message: 'a.mp3 is ready' })).toMatch(/no beat/);
    expect(describeRecording({ mode: 'cueing', rate: 1, error: 0 }, { phase: 'loading', message: 'Loading...' })).toMatch(/first beat/);
  });
});
