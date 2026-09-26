/**
 * The committed source lists are the only footage-related artefact this public repo
 * carries, so they are validated here: schema, unique ids, no local paths, a player per
 * source (the held-out unit), a vocabulary the audio labeller can spell, and that the
 * other instruments' lists parse today without guitar-specific fields.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GuitarSource, parseGuitarSources, parseSources, youtubeUrl } from '../../scripts/air/lib_sources';

const SOURCES_DIR = join(__dirname, '..', '..', 'scripts', 'air', 'sources');

describe('committed source lists', () => {
  const files = readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.json'));

  it('exist for guitar', () => {
    expect(files).toContain('guitar.json');
  });

  for (const f of files) {
    it(`${f} parses, and every source says why it is there and who plays`, () => {
      const doc = parseSources(readFileSync(join(SOURCES_DIR, f), 'utf8'));
      expect(doc.sources.length).toBeGreaterThan(0);
      for (const s of doc.sources) {
        expect(s.player.length).toBeGreaterThan(0);
        expect(youtubeUrl(s.id)).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);
      }
      expect(doc.dataDir).toBe(`videos/air/${doc.instrument}`);
    });
  }

  it('guitar has several players, a held-out probe, and a left-handed pick', () => {
    const doc = parseGuitarSources(readFileSync(join(SOURCES_DIR, 'guitar.json'), 'utf8'));
    expect(new Set(doc.sources.map((s) => s.player)).size).toBeGreaterThanOrEqual(4);
    expect(doc.sources.some((s) => s.holdout)).toBe(true);
    expect(doc.sources.some((s) => s.frettingHand.by === 'x' && s.frettingHand.side === 'min')).toBe(true);
  });
});

describe('source schema', () => {
  const ok = {
    id: 'MtFmLEQ1zoc',
    title: 't',
    channel: 'c',
    player: 'c',
    why: 'because the fretting hand is in frame the whole time',
    license: null,
    chords: ['C', 'G'],
    frettingHand: { by: 'x', side: 'max' },
  };
  const docOf = (sources: unknown[], instrument = 'guitar') => JSON.stringify({ instrument, dataDir: `videos/air/${instrument}`, sources });

  it('accepts a well-formed guitar source', () => {
    expect(GuitarSource.parse(ok).id).toBe('MtFmLEQ1zoc');
    expect(parseGuitarSources(docOf([ok])).sources[0].player).toBe('c');
  });

  it('rejects a bad id, an unknown chord, a missing player and an unknown field', () => {
    expect(() => GuitarSource.parse({ ...ok, id: 'nope' })).toThrow();
    expect(() => GuitarSource.parse({ ...ok, chords: ['H'] })).toThrow();
    expect(() => GuitarSource.parse({ ...ok, player: undefined })).toThrow();
    expect(() => GuitarSource.parse({ ...ok, extra: 1 })).toThrow();
  });

  it('rejects local paths of every common spelling', () => {
    for (const bad of ['/Users/someone/x.mp4', '/home/x/y', '/tmp/clip.mp4', '/Volumes/disk/x', '~/Downloads/x.mov', 'C:\\Users\\x']) {
      expect(() => parseSources(docOf([{ ...ok, notes: `see ${bad}` }])), bad).toThrow(/local path/);
    }
    expect(() => parseSources(docOf([{ ...ok, notes: 'app-data dir, ~/.local/share is generic' }]))).toThrow();
    expect(parseSources(docOf([{ ...ok, notes: 'the app-data dir' }])).sources.length).toBe(1);
  });

  it('rejects duplicate ids in a list', () => {
    expect(() => parseSources(docOf([ok, ok]))).toThrow(/duplicate/);
  });

  it('parses a flute list without guitar fields, and refuses guitar fields there', () => {
    const { chords: _c, frettingHand: _f, ...generic } = ok;
    const flute = parseSources(docOf([generic], 'flute'));
    expect(flute.instrument).toBe('flute');
    expect(() => parseSources(docOf([ok], 'flute'))).toThrow();
    expect(() => parseGuitarSources(docOf([generic], 'flute'))).toThrow(/guitar/);
    expect(() => parseSources(docOf([generic], 'guitar'))).toThrow();
  });
});
