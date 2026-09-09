/**
 * The score pipeline (#187 PR 3) on the two shipped demo pieces (`public/scores/`, both
 * redistributable — see the LICENSES.md there): a 13-track Standard MIDI file through
 * `@tonejs/midi`, and a compressed MusicXML quartet through `musicxml-io`. What is
 * asserted is the `ScoreDoc` contract the rest of the app relies on — beats as quarter
 * notes, parts with notes, tempo map and time signatures where the source states them,
 * written dynamics and fermatas from MusicXML — plus the sniffing, the lazy seam (the
 * parser modules are reached only through `loadScore`) and the flattening the `score`
 * node consumes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  beatsPerBarAt,
  DEMO_SCORES,
  fetchDemo,
  flattenNotes,
  loadScore,
  loadScoreWithStatus,
  ScoreDocSchema,
  sniffFormat,
  timeSignatureAt,
  titleFromFilename,
  type ScoreDoc,
} from '@/score';
import type { LoadStatus } from '@/lazy';

const PUBLIC = join(__dirname, '..', 'public');
const readPublic = async (path: string) => new Uint8Array(readFileSync(join(PUBLIC, path)));

describe('sniffFormat', () => {
  it('recognises MIDI, zipped MusicXML and plain XML by their bytes, then by extension', () => {
    expect(sniffFormat(new TextEncoder().encode('MThd\0\0\0\x06'))).toBe('midi');
    expect(sniffFormat(new TextEncoder().encode('PK\x03\x04'))).toBe('musicxml');
    expect(sniffFormat(new TextEncoder().encode('  <?xml version="1.0"?><score-partwise/>'))).toBe('musicxml');
    expect(sniffFormat(new Uint8Array([1, 2, 3]), 'piece.mid')).toBe('midi');
    expect(sniffFormat(new Uint8Array([1, 2, 3]), 'piece.musicxml')).toBe('musicxml');
    expect(sniffFormat(new Uint8Array([1, 2, 3]), 'piece.txt')).toBeNull();
  });

  it('titleFromFilename strips the extension and separators', () => {
    expect(titleFromFilename('beethoven-symphony-5-1.mid')).toBe('beethoven symphony 5 1');
  });
});

describe('Beethoven 5 (Standard MIDI file, Mutopia)', () => {
  let doc: ScoreDoc;
  it('loads through the lazy MIDI parser into a valid ScoreDoc', async () => {
    doc = await fetchDemo(DEMO_SCORES[0], readPublic);
    expect(() => ScoreDocSchema.parse(doc)).not.toThrow();
    expect(doc.source).toBe('midi');
    expect(doc.title).toBe(DEMO_SCORES[0].title);
    // 13 tracks, of which the ones carrying notes become parts.
    expect(doc.parts.length).toBeGreaterThanOrEqual(10);
    expect(doc.parts.every((p) => p.notes.length > 0)).toBe(true);
    // Unique part ids.
    expect(new Set(doc.parts.map((p) => p.id)).size).toBe(doc.parts.length);
  });

  it('carries the tempo map, a 2/4 time signature, and a length in the thousands of beats', () => {
    expect(doc.tempoMap.length).toBeGreaterThan(0);
    expect(doc.tempoMap[0].bpm).toBeGreaterThan(60);
    expect(timeSignatureAt(doc, 0)).toMatchObject({ numerator: 2, denominator: 4 });
    expect(beatsPerBarAt(doc, 0)).toBe(2);
    // The first movement is ~500 bars of 2/4: well over a thousand quarter-note beats.
    expect(doc.lengthBeats).toBeGreaterThan(900);
    // Notes are in beats: the famous opening starts within the first bar.
    const first = flattenNotes(doc)[0];
    expect(first.start).toBeLessThan(2);
    expect(first.duration).toBeGreaterThan(0);
  });

  it('flattens the selected parts in onset order for the score node', () => {
    const all = flattenNotes(doc);
    for (let i = 1; i < all.length; i++) expect(all[i].start).toBeGreaterThanOrEqual(all[i - 1].start);
    const one = flattenNotes(doc, [doc.parts[0].id]);
    expect(one.length).toBe(doc.parts[0].notes.length);
    expect(one.every((n) => n.velocity >= 0 && n.velocity <= 1)).toBe(true);
  });
});

describe('Haydn Op. 76 No. 3 (compressed MusicXML, OpenScore)', () => {
  let doc: ScoreDoc;
  it('loads through the lazy MusicXML parser into a valid ScoreDoc with four parts', async () => {
    doc = await fetchDemo(DEMO_SCORES[1], readPublic);
    expect(() => ScoreDocSchema.parse(doc)).not.toThrow();
    expect(doc.source).toBe('musicxml');
    expect(doc.parts.length).toBe(4);
    expect(doc.parts.every((p) => p.notes.length > 50)).toBe(true);
    expect(doc.lengthBeats).toBeGreaterThan(100);
  });

  it('reads the written dynamics with positions in beats, attributed to parts', () => {
    expect(doc.dynamics.length).toBeGreaterThan(0);
    for (const d of doc.dynamics) {
      expect(d.beat).toBeGreaterThanOrEqual(0);
      expect(d.beat).toBeLessThanOrEqual(doc.lengthBeats + 1e-6);
      expect(d.value).toBeGreaterThan(0);
      expect(d.value).toBeLessThanOrEqual(1);
      if (d.part) expect(doc.parts.some((p) => p.id === d.part)).toBe(true);
    }
    for (let i = 1; i < doc.dynamics.length; i++) expect(doc.dynamics[i].beat).toBeGreaterThanOrEqual(doc.dynamics[i - 1].beat);
  });

  it('states the time signature and a tempo', () => {
    const ts = timeSignatureAt(doc, 0);
    expect(ts.numerator).toBeGreaterThan(0);
    expect(ts.denominator).toBeGreaterThan(0);
    expect(doc.tempoMap.length).toBeGreaterThan(0);
  });
});

describe('loadScore facade', () => {
  it('rejects bytes that are neither format with a readable message', async () => {
    await expect(loadScore(new TextEncoder().encode('hello'), 'notes.txt')).rejects.toThrow(/Not a MIDI or MusicXML file/);
  });

  it('narrates the shared LoadStatus phases, ending in ready or error', async () => {
    const phases: LoadStatus['phase'][] = [];
    const bytes = await readPublic(DEMO_SCORES[0].file);
    const doc = await loadScoreWithStatus(bytes, DEMO_SCORES[0].file, (s) => phases.push(s.phase));
    expect(doc).not.toBeNull();
    expect(phases).toEqual(['loading', 'ready']);
    const bad: LoadStatus[] = [];
    const none = await loadScoreWithStatus(new TextEncoder().encode('nope'), 'nope.txt', (s) => bad.push(s));
    expect(none).toBeNull();
    expect(bad[bad.length - 1].phase).toBe('error');
    expect(bad[bad.length - 1].message).toMatch(/Not a MIDI/);
  });

  it('the parsers are reached only through the lazy seam (no static import from the facade)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'score', 'load.ts'), 'utf8');
    expect(src).not.toMatch(/^import .*from '(\.\/midi|\.\/musicxml|@tonejs\/midi|musicxml-io)/m);
    expect(src).toMatch(/import\('\.\/midi'\)/);
    expect(src).toMatch(/import\('\.\/musicxml'\)/);
    const index = readFileSync(join(__dirname, '..', 'src', 'score', 'index.ts'), 'utf8');
    expect(index).not.toMatch(/\.\/midi'|\.\/musicxml'/);
  });
});
