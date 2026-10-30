/**
 * A game as a file: which game, its settings, and (for every game that plays notes) the song, kept
 * apart from the settings so a song can be imported on its own and a spec shared with or without
 * one. What a player exports from a page and imports back, or hands to a friend; the formats a spec
 * travels in (JSON, YAML, TOML) and a song's (MIDI, MusicXML, ABC, the note text) are resolved by
 * formatcast (`play/src/spec_io.ts`), never here.
 *
 * A song feeds every game that plays notes: Sing Along, Play Along, Match the Note and the Pitch
 * Maze through a lesson (`lessonFromSong`), Echo through a level (`echoLevelFromSong`), Pop the
 * Notes through balloons at its pitches (`popCourseFromSong`). Vowels plays no notes.
 *
 * Pure, no Zod (the schema is `./spec_schema`), and imports no game at run time: every page loads
 * it up front (`play/src/spec_bar.ts`), so it must not pull another game's code in.
 */
import type { Song } from '@thoremin/sdk/score/song';
import type { Difficulty } from './difficulty';
import type { EchoLevel, Stack } from './echo';
import { seededRandom } from './field';
import type { GameKind, Lesson } from './lesson';
import type { NoteViewKind } from './note_view';
import type { StaffMode } from './staff';
import type { PopTarget } from './pop';

/** The games a spec can name: one per standalone page. */
export const GAME_IDS = ['match-the-note', 'pop-the-notes', 'pitch-maze', 'vowels', 'sing-along', 'play-along', 'echo'] as const;
export type GameId = (typeof GAME_IDS)[number];

/** What marks a file as a funfon game spec, and its version. */
export const SPEC_KIND = 'funfon-game';
export const SPEC_VERSION = 1;

/** Each game's settings a player can set and share (every field optional: absent is the page's default). */
export interface GameSettings {
  difficulty?: Difficulty;
  /** The shipped lesson, level or tune by id (ignored when the spec carries a song). */
  lesson?: string;
  /** Beats per minute, over the song's own. */
  bpm?: number;
  /** Count-in beats (the timed games). */
  countIn?: number;
  /** Sing Along and Play Along: how the notes are laid out (`note_view`). */
  view?: NoteViewKind;
  /** ...and whether a staff goes with them (`staff`). */
  staff?: StaffMode;
  /** Pitch Maze: the track level's id. */
  track?: string;
  /** Echo. */
  beatsPerBar?: number;
  stack?: Stack;
  barsPerPiece?: number;
  passAt?: number;
  retries?: number;
  clickWhileAnswering?: boolean;
  /** Pop the Notes: balloons in a round. */
  count?: number;
  /** Vowels: the mode and the vowels (IPA) of a Vowel Pop round. */
  mode?: string;
  vowels?: string[];
  /** Practice controls (`tuning`): targets' size (a scale), the hold, the cursor's smoothing (0..1), the in-tune band (cents). */
  size?: number;
  holdS?: number;
  smoothing?: number;
  tolerance?: number;
}

export interface GameSpec {
  kind: typeof SPEC_KIND;
  version: number;
  game: GameId;
  title?: string;
  settings: GameSettings;
  song?: Song;
}

/** A spec for a game, with its settings and song as given. */
export const gameSpec = (game: GameId, settings: GameSettings = {}, song?: Song, title?: string): GameSpec => ({
  kind: SPEC_KIND,
  version: SPEC_VERSION,
  game,
  ...(title ? { title } : {}),
  settings,
  ...(song ? { song } : {}),
});

/** The games whose notes a song can be: all but Vowels. */
export const takesSong = (game: GameId): boolean => game !== 'vowels';

/** What a game needs of a song, to say so when an imported one lacks it. */
export const SONG_NEEDS: Record<Exclude<GameId, 'vowels'>, 'pitch' | 'rhythm' | 'both'> = {
  'match-the-note': 'pitch',
  'pop-the-notes': 'pitch',
  'pitch-maze': 'pitch',
  'sing-along': 'both',
  'play-along': 'rhythm',
  echo: 'rhythm',
};

/** Why a song cannot be this game's notes, or null when it can. */
export function songProblem(game: GameId, song: Song): string | null {
  if (!takesSong(game)) return 'Vowels plays no songs.';
  if (song.notes.length === 0) return 'The song has no notes.';
  const need = SONG_NEEDS[game as Exclude<GameId, 'vowels'>];
  if ((need === 'pitch' || need === 'both') && !song.notes.every((n) => n.midi !== undefined)) return 'This game needs a melody (notes with pitches); the song is a rhythm.';
  return null;
}

const DEFAULT_BPM = 90;

/** The game kind a page's lesson is for. */
const KIND: Record<'match-the-note' | 'pitch-maze' | 'sing-along' | 'play-along', GameKind> = { 'match-the-note': 'match', 'pitch-maze': 'sing', 'sing-along': 'sing', 'play-along': 'play-along' };

/** A song as a lesson of one of the lesson games (its tempo, or the settings', or 90 bpm). */
export function lessonFromSong(song: Song, game: keyof typeof KIND, settings: GameSettings = {}): Lesson {
  return {
    id: 'imported',
    title: song.title ?? 'Your song',
    game: KIND[game],
    bpm: settings.bpm ?? song.bpm ?? DEFAULT_BPM,
    countIn: game === 'match-the-note' ? 0 : (settings.countIn ?? song.beatsPerBar ?? 4),
    notes: song.notes.map((n) => ({ ...n })),
    hint: '',
    ...(song.beatsPerBar ? { beatsPerBar: song.beatsPerBar } : {}),
  };
}

/** A song as an Echo level: its notes as the rhythm (pitches are played in the call), its bar. */
export function echoLevelFromSong(song: Song, settings: GameSettings = {}): EchoLevel {
  // The stack's name was checked by the schema when the spec came in (`spec_schema`).
  const stack = settings.stack;
  return {
    id: 'imported',
    title: song.title ?? 'Your rhythm',
    bpm: settings.bpm ?? song.bpm ?? DEFAULT_BPM,
    beatsPerBar: settings.beatsPerBar ?? song.beatsPerBar ?? 4,
    notes: song.notes.map((n) => ({ ...n })),
    ...(settings.barsPerPiece ? { barsPerPiece: settings.barsPerPiece } : {}),
    ...(stack ? { stack } : {}),
  };
}

/**
 * A song's pitches as Pop the Notes balloons, in the song's order: each on its pitch class's column
 * (the octave wraps), at a seeded height the loudness scale reaches, sizes mixed.
 */
export function popCourseFromSong(song: Song, opts: { rMin: number; rMax: number; seed?: number; yMin?: number; yMax?: number }): PopTarget[] {
  const rand = seededRandom(opts.seed ?? 1);
  const yMin = opts.yMin ?? 0.15;
  const yMax = opts.yMax ?? 0.85;
  return song.notes
    .filter((n) => n.midi !== undefined)
    .map((n) => {
      const pc = ((Math.round(n.midi!) % 12) + 12) % 12;
      return { x: (pc + 0.5) / 12, y: yMin + rand() * (yMax - yMin), r: opts.rMin + rand() * (opts.rMax - opts.rMin) };
    });
}

/** A lesson (a shipped one, say) as a song, for exporting what a page is playing. */
export const songFromLesson = (lesson: Pick<Lesson, 'title' | 'bpm' | 'notes'> & { countIn?: number }, beatsPerBar = lesson.countIn || undefined): Song => ({
  // A shipped lesson's count-in is one bar, so it is the song's bar (and comes back as its count-in).
  title: lesson.title,
  bpm: lesson.bpm,
  ...(beatsPerBar ? { beatsPerBar } : {}),
  notes: lesson.notes.map((n) => ({ ...n })),
});
