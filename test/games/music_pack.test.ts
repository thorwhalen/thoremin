/**
 * The music formats through formatcast (`@thoremin/music-formats/pack`): every supported file found
 * by name, type or content and read to a song; a song written as MIDI, note text, JSON, YAML and
 * TOML and read back; the detection traps the pack is built to avoid (a zip that is not MusicXML,
 * ABC's `K:` line that looks like YAML).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRegistry } from 'formatcast';
import { musicPack } from '@thoremin/music-formats/pack';
import { nameOf, songFromText, type Song } from '@thoremin/sdk/score/song';

const formats = createRegistry({ packs: [musicPack] });
const ODE: Song = songFromText('bpm=100 bar=4 E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:0.5 D4:2', 'Ode to Joy');
const ABC = ['X:1', 'T:Scale', 'M:4/4', 'L:1/4', 'Q:1/4=120', 'K: C', 'C D E F | G2 G2 |'].join('\n');
const names = (s: Song) => s.notes.map((n) => nameOf(n.midi!));

describe('reading a song from a file', () => {
  it('MIDI and compressed MusicXML, by name and by content alone', async () => {
    const mid = new Uint8Array(readFileSync('public/scores/beethoven-symphony-5-1.mid'));
    const mxl = new Uint8Array(readFileSync('public/scores/haydn-op76-3.mxl'));
    for (const [bytes, filename] of [
      [mid, 'symphony.mid'],
      [mid, undefined],
      [mxl, 'quartet.mxl'],
      [mxl, undefined],
    ] as const) {
      const r = await formats.decodeWithInfo<Song>(bytes, { to: 'song', ...(filename ? { filename } : {}) });
      expect(r.value.notes.length, `${filename ?? 'unnamed'}`).toBeGreaterThan(20);
      expect(r.format).toBe(bytes === mid ? 'midi' : 'mxl');
    }
  });

  it('ABC by its header (not taken for YAML), and the note text', async () => {
    const abc = await formats.decodeWithInfo<Song>(ABC, { to: 'song' });
    expect(abc.format).toBe('abc');
    expect(names(abc.value)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'G4']);
    const text = await formats.decode<Song>('bpm=90 C4 D4:2 - E4', { filename: 'my tune.notes', to: 'song' });
    expect(text.title).toBe('my tune');
    expect(text.notes.map((n) => n.beat)).toEqual([0, 1, 4]);
    // Note text saved as .txt, or with no name at all, is found by its content (not taken for TOML).
    for (const opts of [{ filename: 'tune.txt' }, {}]) expect((await formats.decodeWithInfo('bpm=100 C4 D4 F#4', opts)).format).toBe('notes');
  });

  it('a song kept as JSON, YAML or TOML, validated on the way in', async () => {
    const yaml = 'title: Two notes\nbpm: 80\nnotes:\n  - { beat: 0, beats: 1, midi: 60 }\n  - { beat: 1, beats: 2, midi: 67 }\n';
    const song = await formats.decode<Song>(yaml, { filename: 'two.yaml', to: 'song' });
    expect(song).toEqual({ title: 'Two notes', bpm: 80, notes: [{ beat: 0, beats: 1, midi: 60 }, { beat: 1, beats: 2, midi: 67 }] });
    await expect(formats.decode('{"notes": []}', { filename: 'empty.json', to: 'song' })).rejects.toThrow();
  });
});

describe('writing a song', () => {
  it('to MIDI, the note text, JSON, YAML and TOML, each reading back as the same song', async () => {
    for (const [format, filename] of [
      ['midi', 'x.mid'],
      ['notes', 'x.notes'],
      ['json', 'x.json'],
      ['yaml', 'x.yaml'],
      ['toml', 'x.toml'],
    ] as const) {
      const out = await formats.encode(ODE, { format, from: 'song' });
      const back = await formats.decode<Song>(out as string | Uint8Array, { filename, to: 'song' });
      expect(back.notes, format).toEqual(ODE.notes);
      expect(back.bpm, format).toBe(100);
    }
  });
});

describe('detection traps', () => {
  it('a zip that is not MusicXML is not taken for one', async () => {
    // A minimal zip local header with a different first entry (what a .docx starts like).
    const head = new TextEncoder().encode('PK\u0003\u0004' + '\u0000'.repeat(26) + '[Content_Types].xml');
    const ranked = await formats.detect(head);
    expect(ranked.find((c) => c.format === 'mxl')?.score ?? 0).toBe(0);
    // The same header with MusicXML's container entry first is one.
    const mxl = new TextEncoder().encode('PK\u0003\u0004' + '\u0000'.repeat(26) + 'META-INF/container.xml');
    expect((await formats.detect(mxl))[0].format).toBe('mxl');
  });
});
