// @vitest-environment jsdom
/**
 * The Song tool (#186 PR G): reachable from a cold load, and does what it says. The
 * shipping rule's test: Tools, then Song, opens the panel; choosing a file decodes it,
 * tracks its beat and makes it the loaded song; Play and Pause go through the command
 * path and drive the transient transport, which reaches the graph through store-controls.
 * Decoding is injected (jsdom has no `OfflineAudioContext`); the file is a synthetic
 * click track at Que Calor's 129.2 bpm.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import ToolsBar from '@/app/tools/ToolsBar';
import ToolsLauncher from '@/app/tools/ToolsLauncher';
import { describeGrid, formatTime } from '@/slices/song/panels/SongPanel';
// The Song tool's panel, in the frame the shell opens an extension's tool in (#600 S15).
import ExtensionToolPanels from '@/app/tools/ExtensionToolPanels';
import { useTools } from '@/app/tools/toolsStore';
import { useToolPins } from '@/app/tools/toolPins';
import { TOOL_PINS_STORAGE_KEY } from '@/app/tools/toolsCollection';
import { useControls, toSettings, mergeControls } from '@/app/store';
import { loadSongFile } from '@/slices/song/app/host';
import { ANALYSIS_SAMPLE_RATE } from '@/slices/song/app/load';
import { createThoreminRegistry } from '@/app/commands/registry';
import { EMPTY_SONG_GRID } from '@thoremin/ictus';
import { renderClickTrack, SR } from '../helpers/clicks';
import { setSongHandle, setSongPlaying, setSongPrefs, songHandle, songPlaying, songPlays, songPrefs } from '@/slices/song/app/state';
import { SONG_COMMANDS } from '@/slices/song/app/songCommands';
import { SONG } from '../helpers/extensions';

/** Core's registry with the song slice's commands (#600 S15: they are the slice's, registered by the shell's fold point). */
const songRegistry = () => {
  const r = createThoreminRegistry();
  r.registerAll(SONG_COMMANDS as never);
  return r;
};

const Shell = () => (
  <>
    <ToolsBar />
    <ToolsLauncher />
    <ExtensionToolPanels />
  </>
);

/** A click-track "file" whose decode is injected. */
function clickFile() {
  const { samples } = renderClickTrack({ bpm: 129.2, seconds: 20, offset: 0.3 });
  // jsdom's File has no arrayBuffer(); the bytes are not read anyway (decode is injected).
  const file = Object.assign(new Blob([new Uint8Array(8)], { type: 'audio/wav' }), {
    name: 'que_calor_clicks.wav',
    arrayBuffer: async () => new ArrayBuffer(8),
  });
  const decode = async () => ({ channels: [samples], durationS: samples.length / SR });
  return { file, opts: { decode, makeUrl: () => 'blob:test-song' } };
}

beforeEach(() => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  localStorage.removeItem(TOOL_PINS_STORAGE_KEY);
  useToolPins.setState({ choices: {} });
  setSongHandle(null);
});
afterEach(cleanup);

describe.runIf(SONG)('the Song tool', () => {
  it('is the tracker rate the helper renders at', () => {
    expect(ANALYSIS_SAMPLE_RATE).toBe(SR);
  });

  it('opens from a cold load in two clicks: Tools, then Song', async () => {
    render(<Shell />);
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Song', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    expect(useTools.getState().open).toBe('song');
    expect(screen.getByText('Choose a song...')).toBeTruthy();
    expect(screen.getByTestId('song-file')).toBeTruthy();
  });

  it('a chosen file becomes the loaded song, with its beat tracked; play and pause go through the commands', async () => {
    useTools.setState({ open: 'song' });
    render(<Shell />);
    const { file, opts } = clickFile();
    await act(async () => {
      await loadSongFile(file, opts);
    });
    const song = songHandle()!;
    expect(song.name).toBe('que_calor_clicks.wav');
    expect(Math.abs(song.grid.bpm - 129.2)).toBeLessThan(0.2);
    expect(screen.getByTestId('song-grid').textContent).toMatch(/129\.\d bpm/);

    fireEvent.click(screen.getByText('Play'));
    await waitFor(() => expect(songPlaying()).toBe(true));
    // Playing, the bar carries the stop control even with the panel closed.
    act(() => useTools.setState({ open: null }));
    fireEvent.click(screen.getByLabelText('Stop Song'));
    await waitFor(() => expect(songPlaying()).toBe(false));
  });

  it('every Play counts a press, even when the transport already reads playing (#344)', () => {
    const before = songPlays();
    setSongPlaying(true);
    setSongPlaying(true);
    setSongPlaying(false);
    expect(songPlays()).toBe(before + 2);
    expect(songPlaying()).toBe(false);
  });

  it('a new song stops the transport and replaces the old one', async () => {
    setSongHandle({ id: 'a', name: 'a.mp3', url: 'a.mp3', durationS: 1, grid: EMPTY_SONG_GRID });
    setSongPlaying(true);
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    expect(songHandle()?.name).toBe('que_calor_clicks.wav');
    expect(songPlaying()).toBe(false);
  });

  it('nothing of the song rides an instrument; its level and tempo persist per device', async () => {
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    setSongPlaying(true);
    const settings = toSettings(useControls.getState()) as unknown as Record<string, unknown>;
    for (const k of ['songHandle', 'songPlaying', 'songPrefs', 'song']) expect(settings[k], k).toBeUndefined();
    const persist = (useControls as unknown as { persist: { getOptions(): { partialize(s: unknown): Record<string, unknown> } } }).persist.getOptions();
    const saved = persist.partialize(useControls.getState());
    expect(saved.songPrefs).toEqual({ volume: 0.8, rate: 1, follow: false, followRange: 0.1, holdFadeS: 0, holdSlow: 0, alignStart: false });
    expect(saved.songHandle).toBeUndefined();
    expect(saved.songPlaying).toBeUndefined();
    // A hand-edited blob is healed; the transients never come back from storage.
    const merged = mergeControls({ songPrefs: { rate: 9 }, songPlaying: true, songHandle: { id: 'x' } } as never, useControls.getState());
    expect((merged as unknown as Record<string, unknown>).songPrefs).toEqual(songPrefs());
    expect(merged.songHandle).toBe(songHandle());
  });

  it('the level and tempo are commands too (the palette, the assistant), clamped by their schema', async () => {
    const r = songRegistry();
    expect((await r.dispatch('song.rate.set', { rate: 0.9 })).ok).toBe(true);
    expect((await r.dispatch('song.volume.set', { volume: 0.5 })).ok).toBe(true);
    expect(songPrefs()).toMatchObject({ volume: 0.5, rate: 0.9 });
    expect((await r.dispatch('song.rate.set', { rate: 5 })).ok).toBe(false);
    setSongPrefs({ volume: 0.8, rate: 1 });
  });

  it('song.play refuses with no song loaded, and names the way to load one', async () => {
    const r = await songRegistry().dispatch('song.play', {});
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/Song tool/);
    expect(songPlaying()).toBe(false);
  });

  it('says what the tracker found, in words', () => {
    expect(describeGrid({ id: 'x', name: 'x', url: '', durationS: 0, grid: EMPTY_SONG_GRID })).toMatch(/No steady beat/);
    expect(formatTime(187.4)).toBe('3:07');
  });
});
