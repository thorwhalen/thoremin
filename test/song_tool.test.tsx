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
import ToolsBar from '@/app/ToolsBar';
import ToolsLauncher from '@/app/ToolsLauncher';
import SongPanel, { describeGrid, formatTime } from '@/app/SongPanel';
import { useTools } from '@/app/toolsStore';
import { useToolPins } from '@/app/toolPins';
import { TOOL_PINS_STORAGE_KEY } from '@/app/toolsCollection';
import { useControls, toSettings, mergeControls } from '@/app/store';
import { loadSongFile } from '@/app/song/host';
import { ANALYSIS_SAMPLE_RATE } from '@/app/song/load';
import { createThoreminRegistry } from '@/app/commands/registry';
import { EMPTY_SONG_GRID } from '@thoremin/ictus';
import { renderClickTrack, SR } from './helpers/clicks';

const Shell = () => (
  <>
    <ToolsBar />
    <ToolsLauncher />
    <SongPanel />
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
  useControls.getState().setSongHandle(null);
});
afterEach(cleanup);

describe('the Song tool', () => {
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
    const song = useControls.getState().songHandle!;
    expect(song.name).toBe('que_calor_clicks.wav');
    expect(Math.abs(song.grid.bpm - 129.2)).toBeLessThan(0.2);
    expect(screen.getByTestId('song-grid').textContent).toMatch(/129\.\d bpm/);

    fireEvent.click(screen.getByText('Play'));
    await waitFor(() => expect(useControls.getState().songPlaying).toBe(true));
    // Playing, the bar carries the stop control even with the panel closed.
    act(() => useTools.setState({ open: null }));
    fireEvent.click(screen.getByLabelText('Stop Song'));
    await waitFor(() => expect(useControls.getState().songPlaying).toBe(false));
  });

  it('every Play counts a press, even when the transport already reads playing (#344)', () => {
    const before = useControls.getState().songPlays;
    useControls.getState().setSongPlaying(true);
    useControls.getState().setSongPlaying(true);
    useControls.getState().setSongPlaying(false);
    expect(useControls.getState().songPlays).toBe(before + 2);
    expect(useControls.getState().songPlaying).toBe(false);
  });

  it('a new song stops the transport and replaces the old one', async () => {
    useControls.getState().setSongHandle({ id: 'a', name: 'a.mp3', url: 'a.mp3', durationS: 1, grid: EMPTY_SONG_GRID });
    useControls.getState().setSongPlaying(true);
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    expect(useControls.getState().songHandle?.name).toBe('que_calor_clicks.wav');
    expect(useControls.getState().songPlaying).toBe(false);
  });

  it('nothing of the song rides an instrument; its level and tempo persist per device', async () => {
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    useControls.getState().setSongPlaying(true);
    const settings = toSettings(useControls.getState()) as unknown as Record<string, unknown>;
    for (const k of ['songHandle', 'songPlaying', 'songPrefs', 'song']) expect(settings[k], k).toBeUndefined();
    const persist = (useControls as unknown as { persist: { getOptions(): { partialize(s: unknown): Record<string, unknown> } } }).persist.getOptions();
    const saved = persist.partialize(useControls.getState());
    expect(saved.songPrefs).toEqual({ volume: 0.8, rate: 1, follow: false, followRange: 0.1, holdFadeS: 0, holdSlow: 0, alignStart: false });
    expect(saved.songHandle).toBeUndefined();
    expect(saved.songPlaying).toBeUndefined();
    // A hand-edited blob is healed; the transients never come back from storage.
    const merged = mergeControls({ songPrefs: { rate: 9 }, songPlaying: true, songHandle: { id: 'x' } } as never, useControls.getState());
    expect(merged.songPrefs).toEqual(useControls.getState().songPrefs);
    expect(merged.songHandle).toBe(useControls.getState().songHandle);
  });

  it('the level and tempo are commands too (the palette, the assistant), clamped by their schema', async () => {
    const r = createThoreminRegistry();
    expect((await r.dispatch('song.rate.set', { rate: 0.9 })).ok).toBe(true);
    expect((await r.dispatch('song.volume.set', { volume: 0.5 })).ok).toBe(true);
    expect(useControls.getState().songPrefs).toMatchObject({ volume: 0.5, rate: 0.9 });
    expect((await r.dispatch('song.rate.set', { rate: 5 })).ok).toBe(false);
    useControls.getState().setSongPrefs({ volume: 0.8, rate: 1 });
  });

  it('song.play refuses with no song loaded, and names the way to load one', async () => {
    const r = await createThoreminRegistry().dispatch('song.play', {});
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/Song tool/);
    expect(useControls.getState().songPlaying).toBe(false);
  });

  it('says what the tracker found, in words', () => {
    expect(describeGrid({ id: 'x', name: 'x', url: '', durationS: 0, grid: EMPTY_SONG_GRID })).toMatch(/No steady beat/);
    expect(formatTime(187.4)).toBe('3:07');
  });
});
