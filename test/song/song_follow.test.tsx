// @vitest-environment jsdom
/**
 * "Follow the dancer" in the Song tool (#186 PR H): reachable from a cold load, and does
 * what it says. The shipping rule's test: Tools, Song, Choose a song, then the toggle
 * (four clicks) turns following on through the `song.follow.set` command; with a song
 * loaded that composes the pace branch and the body source it needs; the panel says what
 * the pace controller is doing, read off the engine by the song reporter.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ToolsLauncher from '@/app/ToolsLauncher';
import { describePace, describeRatio } from '@/slices/song/panels/SongPanel';
// The Song tool's panel, in the frame the shell opens an extension's tool in (#600 S15).
import ExtensionToolPanels from '@/app/ExtensionToolPanels';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { loadSongFile } from '@/slices/song/app/host';
import { makeSongReporter, useSongStatus, PACE_NODE_ID } from '@/slices/song/app/songStatus';
import { createThoreminRegistry } from '@/app/commands/registry';
import { branchIdsFor } from '@/app/graph';
import type { DerivationSettings } from '@/instruments/derive';
import { DEFAULT_SONG } from '@/slices/song/schema';
import { renderClickTrack, SR } from '../helpers/clicks';
import { setSongHandle, setSongPlaying, setSongPrefs, songPrefs } from '@/slices/song/app/state';
import { SONG_COMMANDS } from '@/slices/song/app/songCommands';
import { SONG } from '../helpers/extensions';

/** Core's registry with the song slice's commands (#600 S15: they are the slice's, registered by the shell's fold point). */
const songRegistry = () => {
  const r = createThoreminRegistry();
  r.registerAll(SONG_COMMANDS as never);
  return r;
};

/** The branch set the engine derives from the live store (as `useEngine` does). */
const derived = () => branchIdsFor(useControls.getState() as unknown as DerivationSettings);

const Shell = () => (
  <>
    <ToolsBar />
    <ToolsLauncher />
    <ExtensionToolPanels />
  </>
);

function clickFile() {
  const { samples } = renderClickTrack({ bpm: 129.2, seconds: 12 });
  const file = Object.assign(new Blob([new Uint8Array(8)], { type: 'audio/wav' }), {
    name: 'clicks.wav',
    arrayBuffer: async () => new ArrayBuffer(8),
  });
  const decode = async () => ({ channels: [samples], durationS: samples.length / SR });
  return { file, opts: { decode, makeUrl: () => 'blob:test-follow' } };
}

beforeEach(() => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  setSongHandle(null);
  setSongPrefs({ ...DEFAULT_SONG });
  useSongStatus.getState().reset();
});
afterEach(cleanup);

describe.runIf(SONG)('Follow the dancer', () => {
  it('four clicks from a cold load: Tools, Song, Choose a song, Follow the dancer', async () => {
    render(<Shell />);
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Song', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    // The file picker's click (the third) cannot run in jsdom; its handler's work can.
    expect(screen.getByText('Choose a song...')).toBeTruthy();
    const { file, opts } = clickFile();
    await act(async () => {
      await loadSongFile(file, opts);
    });
    expect(songPrefs().follow).toBe(false);
    expect(derived()).not.toContain('song-pace');

    fireEvent.click(screen.getByLabelText('Follow the dancer'));
    await waitFor(() => expect(songPrefs().follow).toBe(true));
    // The engine's derivation now composes the controller and the body it follows.
    expect(derived()).toEqual(expect.arrayContaining(['song-pace', 'body-source']));
    expect(screen.getByTestId('song-pace').textContent).toMatch(/once the song plays/);

    // Unloading the song takes the branch (and the body camera) away again.
    act(() => setSongHandle(null));
    expect(derived()).not.toContain('song-pace');
  });

  it('"Start on your step" is under Follow the dancer, off by default, and writes the per-device pref through its command (#346)', async () => {
    useTools.setState({ open: 'song' });
    setSongPrefs({ follow: true, alignStart: false });
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    render(<Shell />);
    const box = screen.getByLabelText('Start on your step') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(songPrefs().alignStart).toBe(true));
    fireEvent.click(box);
    await waitFor(() => expect(songPrefs().alignStart).toBe(false));
    setSongPrefs({ follow: false });
  });

  it('says what the controller is doing, from the engine through the reporter', async () => {
    useTools.setState({ open: 'song' });
    setSongPrefs({ follow: true });
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    setSongPlaying(true);
    render(<Shell />);
    const outputs: Record<string, Record<string, unknown>> = {
      songPlayer: { status: { phase: 'active', message: 'Playing' }, position: 3 },
      [PACE_NODE_ID]: { pace: { t: 3, mode: 'following', rate: 1.0612, ratio: 4, target: 1.06, phaseError: 0.01, nudge: 0 } },
    };
    const tick = makeSongReporter({ getOutput: (n, p) => outputs[n]?.[p] }, useSongStatus.getState());
    act(() => tick());
    expect(screen.getByTestId('song-pace').textContent).toBe('Following: 4 song beats per step, tempo 106%, in step.');
    outputs[PACE_NODE_ID].pace = { t: 4, mode: 'holding', rate: 1.06, ratio: 4, target: NaN, phaseError: NaN, nudge: 0 };
    act(() => tick());
    expect(screen.getByTestId('song-pace').textContent).toMatch(/Holding the tempo at 106%/);
    setSongPlaying(false);
  });

  it('the follow toggle and range are commands (the palette, the assistant), checked by their schema', async () => {
    const r = songRegistry();
    expect((await r.dispatch('song.follow.set', { follow: true })).ok).toBe(true);
    expect((await r.dispatch('song.followRange.set', { range: 0.2 })).ok).toBe(true);
    expect(songPrefs()).toMatchObject({ follow: true, followRange: 0.2 });
    expect((await r.dispatch('song.followRange.set', { range: 0.9 })).ok).toBe(false);
  });

  it('the hold fade is a command and a slider in the Song tool, off (a cut) by default (#366)', async () => {
    const r = songRegistry();
    expect(songPrefs().holdFadeS).toBe(0);
    expect((await r.dispatch('song.holdFade.set', { seconds: 0.8 })).ok).toBe(true);
    expect(songPrefs().holdFadeS).toBe(0.8);
    expect((await r.dispatch('song.holdFade.set', { seconds: 9 })).ok).toBe(false);
    useTools.setState({ open: 'song' });
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    render(<Shell />);
    expect(screen.getByTestId('song-hold-fade').textContent).toMatch(/0\.8 s/);
    act(() => setSongPrefs({ holdFadeS: 0 }));
  });

  it('the hold slowdown is a command, off by default, and its slider shows only with a fade (#573)', async () => {
    const r = songRegistry();
    expect(songPrefs().holdSlow).toBe(0);
    expect((await r.dispatch('song.holdSlow.set', { fraction: 0.6 })).ok).toBe(true);
    expect(songPrefs().holdSlow).toBe(0.6);
    expect((await r.dispatch('song.holdSlow.set', { fraction: 2 })).ok).toBe(false);
    useTools.setState({ open: 'song' });
    const { file, opts } = clickFile();
    await loadSongFile(file, opts);
    render(<Shell />);
    expect(screen.queryByTestId('song-hold-slow')).toBeNull();
    act(() => setSongPrefs({ holdFadeS: 0.8 }));
    expect(screen.getByTestId('song-hold-slow').textContent).toMatch(/60 %/);
    act(() => setSongPrefs({ holdFadeS: 0, holdSlow: 0 }));
  });

  it('describes the relation in words', () => {
    expect(describeRatio(4)).toBe('4 song beats per step');
    expect(describeRatio(1)).toBe('one song beat per step');
    expect(describeRatio(0.5)).toBe('2 steps per song beat');
    expect(describePace(null, false)).toMatch(/once the song plays/);
    expect(describePace({ mode: 'waiting', ratio: NaN, rate: 1, nudge: 0 }, true)).toMatch(/Waiting for the dancer/);
    expect(describePace({ mode: 'locking', ratio: 4, rate: 1, nudge: 0 }, true)).toMatch(/locking on/);
    expect(describePace({ mode: 'following', ratio: 4, rate: 0.95, nudge: -1 }, true)).toMatch(/bringing the beat into step/);
    // A new step persisting is not an unclear pulse.
    expect(describePace({ mode: 'switching', ratio: 2, rate: 1.02, nudge: 0 }, true)).toMatch(/changed step \(2 song beats per step\)/);
  });
});
