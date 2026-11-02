/**
 * The Song tool's sources (`src/slices/song/app/sources.ts`): a file, a link and a search hit all
 * become the loaded song through the registry, carrying their source item; the owned session drives
 * the song's hot-store transport; the active session is the one whose song is loaded; and an
 * embed-only session refuses analysis with a reason.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EMPTY_SONG_GRID } from '@thoremin/ictus';
import { useControls } from '@/app/store';
import { activeSession, analysisRefusal, closeMedia, openInput, openMedia, ownedSession, songSourceHost, SONG_TRANSPORT, SOURCES, useActiveSession } from '@/slices/song/app/sources';
import { loadSongFile } from '@/slices/song/app/host';
import { clearAnsweredSeek, setSongHandle, songHandle, songPlaying, songPrefs } from '@/slices/song/app/state';
import { useSongStatus } from '@/slices/song/app/songStatus';
import { OWNED_TRANSPORT, type MediaItem } from '@thoremin/sources';
import { SONG_RATE_MAX, SONG_RATE_MIN } from '@/slices/song/schema';
import { renderClickTrack, SR } from '../helpers/clicks';
import { fakeFetch, json, recorded } from '../sources/helpers';
import { SONG } from '../helpers/extensions';
import '@/slices/song/app/host';

const clicks = renderClickTrack({ bpm: 120, seconds: 10 }).samples;
const analyze = { decode: async () => ({ channels: [clicks], durationS: clicks.length / SR }), makeUrl: () => 'blob:test' };
const fileOf = (name: string) => Object.assign(new Blob([new Uint8Array(8)]), { name, arrayBuffer: async () => new ArrayBuffer(8) });

beforeEach(() => {
  setSongHandle(null);
  useActiveSession.setState({ session: null });
  useSongStatus.getState().reset();
});
afterEach(() => vi.unstubAllGlobals());

describe.runIf(SONG)('the Song tool opens every song through the sources', () => {
  it('states the song player\'s transport, the same figures the owned adapters declare', () => {
    expect(SONG_TRANSPORT).toEqual({ ...OWNED_TRANSPORT, rate: { min: SONG_RATE_MIN, max: SONG_RATE_MAX } });
    expect(SOURCES.list().map((a) => a.capabilities.transport)).toEqual(SOURCES.list().map(() => SONG_TRANSPORT));
  });

  it('a chosen file goes through the local-file adapter and carries its item', async () => {
    const song = await loadSongFile(fileOf('take.wav'), analyze);
    expect(songHandle()).toBe(song);
    expect(song.name).toBe('take.wav');
    expect(song.item).toMatchObject({ source: 'file', title: 'take.wav', rights: 'pcm_local' });
    expect(song.grid.bpm).toBeCloseTo(120, 0);
    expect(activeSession()?.item).toBe(song.item);
  });

  it('a pasted Internet Archive link fetches the track and loads it like a file', async () => {
    const f = fakeFetch(
      (u) => (u.pathname.startsWith('/metadata/') ? json(recorded('ia_metadata_open_goldberg.json')) : undefined),
      (u) => (u.pathname.startsWith('/download/') ? new Response(new Uint8Array(16)) : undefined),
    );
    vi.stubGlobal('fetch', f);
    const session = await openInput('https://archive.org/details/The_Open_Goldberg_Variations-11823/Kimiko_Ishizaka_-_05_-_Variatio_4_a_1_Clav.mp3', { analyze });
    expect(f.calls.at(-1)).toBe('https://archive.org/download/The_Open_Goldberg_Variations-11823/Kimiko_Ishizaka_-_05_-_Variatio_4_a_1_Clav.mp3');
    expect(songHandle()?.name).toBe('Variatio 4 a 1 Clav. (The Open Goldberg Variations)');
    expect(songHandle()?.item?.licence?.name).toBe('CC0 1.0');
    expect(session.capabilities).toBe(SONG_TRANSPORT);
  });

  it('a link that fails leaves the playing song and session in place', async () => {
    await loadSongFile(fileOf('take.wav'), analyze);
    const before = activeSession();
    vi.stubGlobal('fetch', fakeFetch());
    await expect(openInput('https://example.com/missing.mp3', { analyze })).rejects.toMatchObject({ reason: 'not-found' });
    expect(activeSession()).toBe(before);
    expect(songHandle()?.name).toBe('take.wav');
  });
});

describe.runIf(SONG)('overlapping opens', () => {
  it('the latest request wins, whichever finishes first; the earlier one rejects as superseded', async () => {
    let release!: () => void;
    const slow = { ...analyze, decode: async () => {
      await new Promise<void>((r) => (release = r));
      return { channels: [clicks], durationS: clicks.length / SR };
    } };
    const first = openMedia(await SOURCES.resolveInput(fileOf('slow.wav')), { analyze: slow });
    const second = await openMedia(await SOURCES.resolveInput(fileOf('quick.wav')), { analyze });
    release();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(songHandle()?.name).toBe('quick.wav');
    expect(activeSession()).toBe(second);
  });

  it('the file picker returns the song it opened', async () => {
    const song = await loadSongFile(fileOf('mine.wav'), analyze);
    expect(song.name).toBe('mine.wav');
  });
});

describe.runIf(SONG)('the host checks the rights itself', () => {
  it('never decodes an embed-only item, whatever the adapter did', async () => {
    const embed: MediaItem = { source: 'url', id: 'e', title: 'A video', rights: 'embed_only', media: { kind: 'embed', embedUrl: 'https://example.com/e' } };
    const decode = vi.fn(analyze.decode);
    await expect(songSourceHost({ ...analyze, decode }).openOwned(embed, new Blob([]))).rejects.toMatchObject({ reason: 'rights' });
    expect(decode).not.toHaveBeenCalled();
    expect(songHandle()).toBeNull();
  });
});

describe.runIf(SONG)('the owned session', () => {
  it('drives the song\'s transport, rate, volume and seek, and closing unloads the song', async () => {
    const session = await openMedia((await SOURCES.resolveInput(fileOf('a.wav'))), { analyze });
    session.play();
    expect(songPlaying()).toBe(true);
    session.pause();
    expect(songPlaying()).toBe(false);
    session.setRate!(9);
    expect(songPrefs().rate).toBe(SONG_RATE_MAX);
    session.setVolume!(0.25);
    expect(songPrefs().volume).toBe(0.25);
    session.seek!(4.5);
    expect(useControls.getState().songSeek).toMatchObject({ positionS: 4.5 });
    // The player answers it (its `seeked` output): the request is cleared, so it is never replayed.
    const asked = (useControls.getState().songSeek as { id: number }).id;
    clearAnsweredSeek(asked - 1);
    expect(useControls.getState().songSeek).not.toBeNull();
    clearAnsweredSeek(asked);
    expect(useControls.getState().songSeek).toBeNull();
    session.seek!(6);
    // A new song never inherits the request.
    await openMedia(await SOURCES.resolveInput(fileOf('b.wav')), { analyze });
    expect(useControls.getState().songSeek).toBeNull();
    closeMedia();
    expect(songHandle()).toBeNull();
    expect(activeSession()).toBeNull();
  });

  it('reports state, buffering and the end from the player\'s status', async () => {
    const session = await openMedia((await SOURCES.resolveInput(fileOf('a.wav'))), { analyze });
    const seen: string[] = [];
    for (const e of ['state', 'ended', 'buffering'] as const) session.on(e, () => seen.push(e));
    const report = useSongStatus.getState().report;
    const live = { beat: 0, bpm: 0, positionS: 0 };
    report({ phase: 'loading', message: 'Loading' }, live);
    report({ phase: 'active', message: 'Playing' }, live);
    expect(session.playing()).toBe(true);
    report({ phase: 'ready', reason: 'ended', message: 'Done' }, live);
    expect(seen).toEqual(['state', 'buffering', 'state', 'state', 'ended']);
  });

  it('is no longer active, and does nothing, once its song was replaced another way', async () => {
    const session = await openMedia((await SOURCES.resolveInput(fileOf('a.wav'))), { analyze });
    setSongHandle({ id: 'other', name: 'other', url: 'blob:o', durationS: 1, grid: EMPTY_SONG_GRID });
    expect(activeSession()).toBeNull();
    session.play();
    expect(songPlaying()).toBe(false);
    session.close();
    expect(songHandle()?.id).toBe('other');
  });
});

describe.runIf(SONG)('analysis follows the active session\'s rights', () => {
  it('is allowed with no session and with owned audio, refused with a reason for an embed', async () => {
    expect(analysisRefusal()).toBeNull();
    await loadSongFile(fileOf('a.wav'), analyze);
    expect(analysisRefusal()).toBeNull();
    const embed: MediaItem = { source: 'url', id: 'e', title: 'A video', rights: 'embed_only', media: { kind: 'embed', embedUrl: 'https://example.com/e' } };
    const song = { id: 'e', name: 'A video', url: '', durationS: 1, grid: EMPTY_SONG_GRID, item: embed };
    setSongHandle(song);
    useActiveSession.setState({ session: ownedSession(embed, song) });
    expect(analysisRefusal()).toBe('Listening is off while A video plays from Web address');
  });
});
