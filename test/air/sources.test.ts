/**
 * The committed source lists are the only footage-related artefact this public repo
 * carries, so they are validated here: schema, unique ids, no local paths, and a
 * vocabulary the audio labeller can spell.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AirSource, parseSources, youtubeUrl } from '../../scripts/air/lib_sources';

const SOURCES_DIR = join(__dirname, '..', '..', 'scripts', 'air', 'sources');

describe('committed source lists', () => {
  const files = readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.json'));

  it('exist for guitar', () => {
    expect(files).toContain('guitar.json');
  });

  for (const f of files) {
    it(`${f} parses, and every source says why it is there`, () => {
      const doc = parseSources(readFileSync(join(SOURCES_DIR, f), 'utf8'));
      expect(doc.sources.length).toBeGreaterThan(0);
      for (const s of doc.sources) {
        expect(s.why.length).toBeGreaterThan(20);
        expect(youtubeUrl(s.id)).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);
      }
      expect(doc.dataDir).toBe(`videos/air/${doc.instrument}`);
    });
  }

  it('has at least one held-out domain-shift probe and one non-max fretting pick for guitar', () => {
    const doc = parseSources(readFileSync(join(SOURCES_DIR, 'guitar.json'), 'utf8'));
    expect(doc.sources.some((s) => s.holdout)).toBe(true);
    expect(doc.sources.some((s) => s.frettingHand.by === 'x' && s.frettingHand.side === 'min')).toBe(true);
  });
});

describe('AirSource schema', () => {
  const ok = {
    id: 'MtFmLEQ1zoc',
    title: 't',
    channel: 'c',
    why: 'because the fretting hand is in frame the whole time',
    license: null,
    chords: ['C', 'G'],
    frettingHand: { by: 'x', side: 'max' },
  };

  it('accepts a well-formed source', () => {
    expect(AirSource.parse(ok).id).toBe('MtFmLEQ1zoc');
  });

  it('rejects a bad id, an unknown chord, and a local path', () => {
    expect(() => AirSource.parse({ ...ok, id: 'nope' })).toThrow();
    expect(() => AirSource.parse({ ...ok, chords: ['H'] })).toThrow();
    expect(() => AirSource.parse({ ...ok, notes: 'see /Users/someone/Downloads/x.mp4' })).toThrow(/local path/);
    expect(() => AirSource.parse({ ...ok, extra: 1 })).toThrow();
  });

  it('rejects duplicate ids in a list', () => {
    const doc = { instrument: 'guitar', dataDir: 'videos/air/guitar', sources: [ok, ok] };
    expect(() => parseSources(JSON.stringify(doc))).toThrow(/duplicate/);
  });
});
