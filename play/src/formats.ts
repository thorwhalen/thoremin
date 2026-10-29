/**
 * Files in and out of the funfon pages, through formatcast: a registry with its text pack (JSON,
 * YAML, TOML, ...), thoremin's music pack (MIDI, MusicXML, .mxl, ABC, the note text; `score` and
 * `song`) and the game pack below (`data <-> game`, a spec validated by its schema). Loaded by a
 * dynamic import from `./spec_bar.ts` the first time a player imports or exports, so no page carries
 * formatcast, Zod or a parser up front; each parser loads only when its kind of file is opened.
 */
import { createRegistry, definePack } from 'formatcast';
import { musicPack } from '@thoremin/music-formats/pack';
import type { Song } from '@thoremin/sdk/score/song';
import { SPEC_KIND, type GameSpec } from '@thoremin/games/spec';
import { parseGameSpec } from '@thoremin/games/spec_schema';

const gamePack = definePack({
  name: 'funfon-game',
  transforms: [
    { from: 'data', to: 'game', convert: (data: unknown) => parseGameSpec(data) },
    { from: 'game', to: 'data', convert: (spec: GameSpec) => spec },
  ],
});

export const formats = createRegistry({ packs: [musicPack, gamePack] });

/** What a file turned out to be: a game spec (from JSON, YAML or TOML), or a song (from anything else, or a song kept as data). */
export type Read = { spec: GameSpec } | { song: Song };

export async function readFile(file: File): Promise<Read> {
  const first = await formats.decodeWithInfo(file);
  const v = first.value as { kind?: unknown } | null;
  if (v && typeof v === 'object' && v.kind === SPEC_KIND) return { spec: parseGameSpec(v) };
  // Carry what was decoded on to a song (a MIDI file's score is not parsed twice).
  const kind = first.route.length ? first.route[first.route.length - 1].to : first.format;
  return { song: kind === 'song' ? (first.value as Song) : await formats.decode<Song>(first.value, { format: kind, to: 'song' }) };
}

/** The ways out, each a formatcast format id: a game spec as data, a song as music or as data. */
export const GAME_OUT = { json: 'JSON', yaml: 'YAML', toml: 'TOML' } as const;
export const SONG_OUT = { midi: 'MIDI', notes: 'note text', json: 'JSON', yaml: 'YAML' } as const;

const EXT: Record<string, string> = { json: 'json', yaml: 'yaml', toml: 'toml', midi: 'mid', notes: 'notes' };
const TYPE: Record<string, string> = { json: 'application/json', yaml: 'application/yaml', toml: 'application/toml', midi: 'audio/midi', notes: 'text/plain' };

/** A spec or a song written in a format, as a file to save. */
export async function writeFile(value: GameSpec | Song, as: 'game' | 'song', format: string, name: string): Promise<File> {
  const out = await formats.encode<string | Uint8Array>(value, { format, from: as });
  const safe = name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-') || as;
  return new File([out as BlobPart], `${safe}.${EXT[format] ?? format}`, { type: TYPE[format] ?? 'application/octet-stream' });
}
