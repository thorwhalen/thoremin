/**
 * The music formats as a formatcast pack: what lets any thoremin page say "open this file as a
 * song" (or "save this song as MIDI") and have the format found and the parser loaded only then.
 *
 * Two in-memory kinds and the edges between them and the files:
 *
 *   midi ──┐                               ┌── midi        (encode: score -> bytes)
 *   musicxml ─┤                            │
 *   mxl ───┼──> score <──> song <──> data <──> json / yaml / toml  (formatcast's text pack)
 *   abc ───┘               ^
 *   notes (the compact note text) ─┘
 *
 * - `score` is the conductor's `ScoreDoc` (every part, the tempo map); `song` is the games' one
 *   line (`songFromScore` takes the busiest pitched part, or the `part` param).
 * - Detection: MIDI by its `MThd` magic; MusicXML by its root element, not a leading `<`; a
 *   compressed `.mxl` by the MusicXML mimetype entry near the zip's start, or by the
 *   `META-INF/container.xml` first entry when it has none (`PK` alone is also every .docx); ABC by its `X:` and `K:` header lines, scored above YAML's sniff,
 *   which a `K: C` line would otherwise satisfy.
 * - A song in JSON, YAML or TOML (`{ notes: [...] }`) is `data -> song`, validated by its schema.
 *
 * The pack itself is small; each codec module (and its parser) is a dynamic import.
 */
import { definePack, type Ctx } from 'formatcast';
import { songFromScore, songFromText, songToText, type Song } from '@thoremin/sdk/score/song';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';

/** A title from a file name: the name without its extension, separators as spaces. */
export const titleOf = (ctx: Ctx): string | undefined => ctx.filename?.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || undefined;

export const musicPack = definePack({
  name: 'thoremin-music',
  formats: [
    {
      id: 'midi',
      label: 'MIDI',
      kind: 'score',
      binary: true,
      extensions: ['mid', 'midi', 'smf'],
      mimeTypes: ['audio/midi', 'audio/x-midi', 'audio/mid'],
      magic: 'MThd',
      load: async () => {
        const m = await import('./midi');
        return { decode: (bytes: Uint8Array, _p: unknown, ctx: Ctx) => m.midiToScoreDoc(bytes, titleOf(ctx)), encode: (doc: ScoreDoc) => m.scoreToMidi(doc) };
      },
      requires: ['@tonejs/midi'],
    },
    {
      id: 'musicxml',
      label: 'MusicXML',
      kind: 'score',
      extensions: ['musicxml', 'xml'],
      mimeTypes: ['application/vnd.recordare.musicxml+xml'],
      sniff: (_head, text) => (text && /<score-(partwise|timewise)[\s>]/.test(text) ? 1 : 0),
      encodes: false,
      load: async () => {
        const m = await import('./musicxml');
        return { decode: (text: string, _p: unknown, ctx: Ctx) => m.musicxmlToScoreDoc(text, titleOf(ctx)) };
      },
      requires: ['musicxml-io'],
    },
    {
      id: 'mxl',
      label: 'MusicXML (compressed)',
      kind: 'score',
      binary: true,
      extensions: ['mxl'],
      mimeTypes: ['application/vnd.recordare.musicxml'],
      sniff: (head) => {
        // A zip (PK): its MusicXML mimetype entry, or, in files that have none, the container
        // entry MusicXML requires as the first file (a .docx starts with [Content_Types].xml,
        // an EPUB or ODF file with its own mimetype).
        const start = String.fromCharCode(...head.subarray(0, 120));
        if (!start.startsWith('PK')) return 0;
        return start.includes('application/vnd.recordare.musicxml') ? 1 : start.slice(30, 52) === 'META-INF/container.xml' ? 0.8 : 0;
      },
      encodes: false,
      load: async () => {
        const m = await import('./musicxml');
        return { decode: (bytes: Uint8Array, _p: unknown, ctx: Ctx) => m.musicxmlToScoreDoc(bytes, titleOf(ctx)) };
      },
      requires: ['musicxml-io'],
    },
    {
      id: 'abc',
      label: 'ABC notation',
      kind: 'score',
      extensions: ['abc'],
      mimeTypes: ['text/vnd.abc'],
      sniff: (_head, text) => (text && /^X:\s*\d+/m.test(text) && /^K:/m.test(text) ? 0.9 : 0),
      encodes: false,
      load: async () => {
        const m = await import('./abc');
        return { decode: (text: string, _p: unknown, ctx: Ctx) => m.abcToScoreDoc(text, titleOf(ctx)) };
      },
      requires: ['musicxml-io'],
    },
    {
      id: 'notes',
      label: 'Note text',
      kind: 'song',
      extensions: ['notes'],
      mimeTypes: ['text/x-thoremin-notes'],
      decode: (text: string, _p, ctx) => songFromText(text, titleOf(ctx)),
      encode: (song: Song) => songToText(song),
    },
  ],
  transforms: [
    { from: 'score', to: 'song', convert: (doc: ScoreDoc, p) => songFromScore(doc, typeof p.part === 'string' || typeof p.part === 'number' ? { part: p.part } : {}) },
    { from: 'song', to: 'score', load: async () => ({ convert: (await import('./song_score')).scoreFromSong }) },
    { from: 'data', to: 'song', cost: 2, load: async () => ({ convert: (await import('@thoremin/sdk/score/song_schema')).SongSchema.parse }) },
    { from: 'song', to: 'data', cost: 2, convert: (song: Song) => song },
  ],
});
