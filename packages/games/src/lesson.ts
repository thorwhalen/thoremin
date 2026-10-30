/**
 * A lesson: what a listening game asks the player to do, as data (the SSOT of the game's
 * targets). Notes are in BEATS at a tempo, after a count-in, so one lesson serves a slow first
 * try and a faster one, and a chart reads like music rather than like a list of milliseconds.
 *
 * One schema for the three games: Sing reads every note's pitch and length; Play along reads the
 * onsets, and the pitch when the lesson is pitched (an unpitched lesson is a rhythm to clap or
 * tap); Match the note reads the pitches one at a time, self-paced (its beats are ignored).
 *
 * Pure arithmetic, and no Zod: the schema that validates a lesson from outside (a file, a
 * player's own) is `./lesson_schema.ts`, so a page that only plays the shipped lessons does not
 * carry a validator.
 */

export const GAME_KINDS = ['sing', 'play-along', 'match'] as const;
export type GameKind = (typeof GAME_KINDS)[number];

export interface LessonNote {
  /** Where it starts, beats after the count-in. */
  beat: number;
  /** How long, beats. */
  beats: number;
  /** MIDI pitch; absent in a rhythm lesson. */
  midi?: number;
}

export interface Lesson {
  id: string;
  title: string;
  game: GameKind;
  /** Beats per minute. */
  bpm: number;
  /** Count-in clicks before beat 0. */
  countIn: number;
  /** Beats in a bar (a staff's barlines). Default 4. */
  beatsPerBar?: number;
  notes: LessonNote[];
  /** A line the player reads before starting. */
  hint: string;
}

/** A lesson note placed in engine seconds. */
export interface TimedNote {
  id: number;
  start: number;
  end: number;
  midi?: number;
}

/** The engine time of beat `b` when beat 0 (the first note's downbeat) is at `t0`. */
export const beatTime = (lesson: Pick<Lesson, 'bpm'>, t0: number, b: number): number => t0 + (b * 60) / lesson.bpm;

/**
 * Place a lesson on the engine clock: the count-in clicks start at `start`, beat 0 follows them.
 * `transpose` moves every pitch by semitones (a lesson sung in the player's range).
 */
export function placeLesson(lesson: Lesson, start: number, transpose = 0): { clicks: number[]; notes: TimedNote[]; t0: number; end: number } {
  const beat = 60 / lesson.bpm;
  const t0 = start + lesson.countIn * beat;
  const clicks = Array.from({ length: lesson.countIn }, (_, i) => start + i * beat);
  const notes = lesson.notes.map((n, id) => ({
    id,
    start: beatTime(lesson, t0, n.beat),
    end: beatTime(lesson, t0, n.beat + n.beats),
    ...(n.midi === undefined ? {} : { midi: n.midi + transpose }),
  }));
  return { clicks, notes, t0, end: Math.max(...notes.map((n) => n.end)) };
}

/**
 * The start of the bar time `t` falls in, for a lesson placed with beat 0 at `t0`: a view keeps
 * every note from there, so a staff spells a bar's accidentals from its first note even after that
 * note has scrolled away.
 */
export const barStart = (lesson: Pick<Lesson, 'bpm' | 'beatsPerBar'>, t0: number, t: number): number => {
  const barS = (60 / lesson.bpm) * (lesson.beatsPerBar ?? 4);
  return t0 + Math.floor((t - t0) / barS) * barS;
};

/** True when every note of the lesson has a pitch. */
export const isPitched = (lesson: Lesson): boolean => lesson.notes.every((n) => n.midi !== undefined);

/** The compact note text and pitch names are the song's (`@thoremin/sdk/score/song`); a lesson's notes are a song's notes. */
export { midiFromName, nameOf, notesFrom } from '@thoremin/sdk/score/song';
