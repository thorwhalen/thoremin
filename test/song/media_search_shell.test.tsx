// @vitest-environment jsdom
/**
 * The Song tool's Media search, from a cold load (the shipping rule): Tools, Song, type "bach",
 * Find, choose a track; it becomes the loaded song with its beat tracked and its source, licence
 * and page shown. An album lists its tracks first. The network is the recorded responses
 * (`test/fixtures/sources/`); jsdom decodes nothing, so the decoder is a stand-in that returns a
 * click track.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import ToolsBar from '@/app/tools/ToolsBar';
import ToolsLauncher from '@/app/tools/ToolsLauncher';
import ExtensionToolPanels from '@/app/tools/ExtensionToolPanels';
import { useTools } from '@/app/tools/toolsStore';
import { useToolPins } from '@/app/tools/toolPins';
import { TOOL_PINS_STORAGE_KEY } from '@/app/tools/toolsCollection';
import { setSongHandle, songHandle } from '@/slices/song/app/state';
import { configureSourceReach, useActiveSession } from '@/slices/song/app/sources';
import { renderClickTrack, SR } from '../helpers/clicks';
import { fakeFetch, json, recorded } from '../sources/helpers';
import { SONG } from '../helpers/extensions';

const Shell = () => (
  <>
    <ToolsBar />
    <ToolsLauncher />
    <ExtensionToolPanels />
  </>
);

const clicks = renderClickTrack({ bpm: 96, seconds: 12 }).samples;
const network = () =>
  fakeFetch(
    (u) => (u.hostname === 'archive.org' && u.pathname === '/advancedsearch.php' ? json(recorded('ia_search_bach.json')) : undefined),
    (u) => (u.hostname === 'archive.org' && u.pathname === '/metadata/Toccata' ? json(recorded('ia_metadata_toccata.json')) : undefined),
    (u) => (u.hostname === 'archive.org' && u.pathname.startsWith('/metadata/') ? json(recorded('ia_metadata_open_goldberg.json')) : undefined),
    (u) => (u.hostname === 'archive.org' && u.pathname.startsWith('/download/') ? new Response(new Uint8Array(32)) : undefined),
    (u) => (u.hostname === 'api.audius.co' ? json(recorded('audius_search_bach.json')) : undefined),
  );

beforeEach(() => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  localStorage.removeItem(TOOL_PINS_STORAGE_KEY);
  useToolPins.setState({ choices: {} });
  setSongHandle(null);
  useActiveSession.setState({ session: null });
  // Deezer answers JSONP: its recorded answer, with no script tag.
  configureSourceReach({ jsonp: async () => recorded('deezer_search_bach.json') });
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      async decodeAudioData() {
        return { numberOfChannels: 1, duration: clicks.length / SR, getChannelData: () => clicks };
      }
    },
  );
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:media', revokeObjectURL: () => {} }));
  // jsdom's Blob has no arrayBuffer(); the decoder above ignores the bytes anyway.
  if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = async () => new ArrayBuffer(8);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  configureSourceReach({});
});

describe.runIf(SONG)('Media search in the Song tool', () => {
  it('Tools, Song, search "bach", a track: it loads like a file, with its source and licence', async () => {
    const f = network();
    vi.stubGlobal('fetch', f);
    render(<Shell />);
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Song', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    const box = screen.getByLabelText('Search music or paste a link');
    fireEvent.change(box, { target: { value: 'bach' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(screen.getByTestId('media-status').textContent).toBe('Searching Internet Archive, Audius and Deezer for "bach"...');
    const results = await screen.findByTestId('media-results');
    expect(within(results).getByRole('region', { name: 'Internet Archive' })).toBeTruthy();
    expect(within(results).getByRole('region', { name: 'Audius' })).toBeTruthy();
    expect(within(results).getByRole('region', { name: 'Deezer' })).toBeTruthy();
    fireEvent.click(within(results).getByText('Toccata'));
    await waitFor(() => expect(songHandle()?.name).toBe('Toccata'));
    expect(f.calls).toContain('https://archive.org/download/Toccata/Toccata_et_Fugue_BWV565.mp3');
    expect(songHandle()!.grid.bpm).toBeCloseTo(96, 0);
    const source = await screen.findByTestId('song-source');
    expect(source.textContent).toBe('Internet Archive · Johann Sebastian Bach · licence: Public Domain Mark 1.0 · page');
    expect(within(source).getByRole('link', { name: 'page' }).getAttribute('href')).toBe('https://archive.org/details/Toccata');
  });

  it('an album lists its tracks; the chosen one loads', async () => {
    const goldberg = { identifier: 'The_Open_Goldberg_Variations-11823', title: 'The Open Goldberg Variations', creator: 'Kimiko Ishizaka', licenseurl: 'http://creativecommons.org/publicdomain/zero/1.0/' };
    const f = network();
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.audius.co') return json({ data: [] });
      return url.pathname === '/advancedsearch.php' ? json({ response: { docs: [goldberg] } }) : f(input);
    }) as typeof fetch);
    useTools.setState({ open: 'song' });
    render(<Shell />);
    fireEvent.change(screen.getByLabelText('Search music or paste a link'), { target: { value: 'goldberg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    fireEvent.click(within(await screen.findByTestId('media-results')).getByText('The Open Goldberg Variations'));
    const tracks = await screen.findByTestId('media-tracks');
    expect(within(tracks).getByText('32 tracks: choose one')).toBeTruthy();
    expect(songHandle()).toBeNull();
    fireEvent.click(within(tracks).getByText('Variatio 4 a 1 Clav.'));
    await waitFor(() => expect(songHandle()?.name).toBe('Variatio 4 a 1 Clav. (The Open Goldberg Variations)'));
    expect(f.calls).toContain('https://archive.org/download/The_Open_Goldberg_Variations-11823/Kimiko_Ishizaka_-_05_-_Variatio_4_a_1_Clav.mp3');
  });

  it('a pasted link opens at once; one nothing can read says why', async () => {
    vi.stubGlobal('fetch', fakeFetch());
    useTools.setState({ open: 'song' });
    render(<Shell />);
    const box = screen.getByLabelText('Search music or paste a link');
    fireEvent.change(box, { target: { value: 'https://example.com/gone.mp3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect((await screen.findByTestId('media-error')).textContent).toBe('gone could not be fetched (HTTP 404)');
    expect(songHandle()).toBeNull();
  });

  it('says which catalogue could not be reached, and still shows the other\'s hits', async () => {
    vi.stubGlobal('fetch', fakeFetch((u) => (u.hostname === 'archive.org' ? json(recorded('ia_search_bach.json')) : new Response('', { status: 503 }))));
    useTools.setState({ open: 'song' });
    render(<Shell />);
    fireEvent.change(screen.getByLabelText('Search music or paste a link'), { target: { value: 'bach' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    const results = await screen.findByTestId('media-results');
    expect(within(results).getAllByTestId('media-hit').length).toBeGreaterThan(0);
    expect(within(results).getByText('Audius: Audius answered HTTP 503.')).toBeTruthy();
  });
});
