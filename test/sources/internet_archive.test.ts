/**
 * The Internet Archive adapter on its recorded responses: the search a player types, an item's
 * tracks, and links in every shape the site uses.
 */
import { describe, it, expect } from 'vitest';
import { createInternetArchiveAdapter, iaTracks, parseIaLength, parseIaRef, INTERNET_ARCHIVE_ID } from '@thoremin/sources/adapters/internet_archive';
import { fakeFetch, json, recorded } from './helpers';

const GOLDBERG = 'The_Open_Goldberg_Variations-11823';
const Q = '(bach) AND mediatype:audio AND licenseurl:* AND NOT collection:(librivoxaudio OR audio_bookspoetry OR podcasts OR radioprograms OR oldtimeradio)';
const ia = (f = fakeFetch(
  (u) => (u.pathname === '/advancedsearch.php' ? json(recorded('ia_search_bach.json')) : undefined),
  (u) => (u.pathname === `/metadata/${GOLDBERG}` ? json(recorded('ia_metadata_open_goldberg.json')) : undefined),
)) => ({ f, a: createInternetArchiveAdapter({ fetch: f }) });

describe('Internet Archive search', () => {
  it('asks for licensed music items in the archive\'s relevance order, and maps each to a hit', async () => {
    const { f, a } = ia();
    const hits = await a.search!('bach', { limit: 12 });
    const asked = new URL(f.calls[0]);
    expect(asked.searchParams.get('q')).toBe(Q);
    expect(asked.searchParams.get('rows')).toBe('12');
    expect(asked.searchParams.getAll('sort[]')).toEqual([]);
    expect(hits).toHaveLength(12);
    expect(hits.find((h) => h.id === 'Toccata')).toEqual({
      source: INTERNET_ARCHIVE_ID,
      id: 'Toccata',
      title: 'Toccata',
      artist: 'Johann Sebastian Bach',
      pageUrl: 'https://archive.org/details/Toccata',
      artworkUrl: 'https://archive.org/services/img/Toccata',
      licence: { name: 'Public Domain Mark 1.0', url: 'http://creativecommons.org/publicdomain/mark/1.0/' },
    });
  });

  it('escapes the query language, so a colon or a bracket searches as text', async () => {
    const { f, a } = ia();
    await a.search!('BWV 988: (aria)');
    expect(new URL(f.calls[0]).searchParams.get('q')).toBe(Q.replace('(bach)', '(BWV 988\\: \\(aria\\))'));
  });

  it('can include items with no stated licence, and spoken word', async () => {
    const f = fakeFetch(() => json(recorded('ia_search_bach.json')));
    await createInternetArchiveAdapter({ fetch: f, licensedOnly: false, excludeCollections: [] }).search!('bach');
    expect(new URL(f.calls[0]).searchParams.get('q')).toBe('(bach) AND mediatype:audio');
  });

  it('raises, naming the source, when the answer is not the shape it reads', async () => {
    const a = createInternetArchiveAdapter({ fetch: fakeFetch(() => json({ error: 'busy' })) });
    await expect(a.search!('bach')).rejects.toMatchObject({ name: 'SourceError', reason: 'bad-response', source: INTERNET_ARCHIVE_ID });
  });
});

describe('Internet Archive items', () => {
  it('lists an album item as one playable track per original file, the first one resolved', async () => {
    const { a } = ia();
    const item = await a.resolve(GOLDBERG);
    expect(item.parts).toHaveLength(32);
    expect(item.parts![4]).toEqual({ id: `${GOLDBERG}/Kimiko_Ishizaka_-_05_-_Variatio_4_a_1_Clav.mp3`, title: 'Variatio 4 a 1 Clav.' });
    expect(item.title).toBe('Aria (The Open Goldberg Variations)');
    expect(item.rights).toBe('pcm_local');
    expect(item.durationS).toBeCloseTo(299.54);
    expect(item.media).toEqual({ kind: 'url', url: `https://archive.org/download/${GOLDBERG}/Kimiko_Ishizaka_-_01_-_Aria.mp3` });
  });

  it('resolves a named track, from its id or from a download link', async () => {
    const { a } = ia();
    const byId = await a.resolve(`${GOLDBERG}/Kimiko_Ishizaka_-_05_-_Variatio_4_a_1_Clav.mp3`);
    expect(byId.title).toBe('Variatio 4 a 1 Clav. (The Open Goldberg Variations)');
    const byLink = await a.resolve(`https://archive.org/download/${GOLDBERG}/Kimiko_Ishizaka_-_05_-_Variatio_4_a_1_Clav.mp3`);
    expect(byLink.media).toEqual(byId.media);
  });

  it('opens a one-track item directly, at its MP3 rather than its Ogg original', async () => {
    const a = createInternetArchiveAdapter({ fetch: fakeFetch((u) => (u.pathname === '/metadata/Toccata' ? json(recorded('ia_metadata_toccata.json')) : undefined)) });
    const item = await a.resolve('https://archive.org/details/Toccata');
    expect(item).toMatchObject({ id: 'Toccata/Toccata_et_Fugue_BWV565.mp3', title: 'Toccata', durationS: 513, media: { kind: 'url', url: 'https://archive.org/download/Toccata/Toccata_et_Fugue_BWV565.mp3' } });
    expect(item.parts).toBeUndefined();
  });

  it('plays a derivative instead of an original no browser decodes', () => {
    const tracks = iaTracks([
      { name: 'a.flac', source: 'original', format: 'Flac' },
      { name: 'a.mp3', source: 'derivative', format: 'VBR MP3', original: 'a.flac' },
      { name: 'a_64kb.mp3', source: 'derivative', format: '64Kbps MP3', original: 'a.flac' },
      { name: 'a.png', source: 'derivative', format: 'PNG', original: 'a.flac' },
    ]);
    expect(tracks.map((t) => t.name)).toEqual(['a.mp3']);
  });

  it('says so when an item has no audio, and refuses a file', async () => {
    const a = createInternetArchiveAdapter({ fetch: fakeFetch(() => json({ metadata: { identifier: 'x' }, files: [{ name: 'x.pdf', format: 'Text PDF' }] })) });
    await expect(a.resolve('x')).rejects.toMatchObject({ reason: 'not-found' });
    await expect(a.resolve(new Blob([]))).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('reads links and lengths in the shapes the site uses', () => {
    expect(a().matches!('https://archive.org/details/Toccata')).toBe(true);
    expect(a().matches!('https://www.archive.org/download/Toccata/x.mp3')).toBe(true);
    expect(a().matches!('https://example.com/details/Toccata')).toBe(false);
    expect(parseIaRef('https://archive.org/details/Toccata?tab=about')).toEqual({ id: 'Toccata', file: undefined });
    expect(parseIaRef('https://archive.org/download/a%20b/c%20d.mp3')).toEqual({ id: 'a b', file: 'c d.mp3' });
    expect(parseIaLength('08:33')).toBe(513);
    expect(parseIaLength('1:02:03')).toBe(3723);
    expect(parseIaLength('513.56')).toBeCloseTo(513.56);
    expect(parseIaLength('n/a')).toBeUndefined();
    function a() {
      return createInternetArchiveAdapter({ fetch: fakeFetch() });
    }
  });
});
