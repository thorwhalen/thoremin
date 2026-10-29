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

/** True when every note of the lesson has a pitch. */
export const isPitched = (lesson: Lesson): boolean => lesson.notes.every((n) => n.midi !== undefined);

/**
 * Notes from a compact text: space-separated tokens, each `<pitch>[:<beats>]` or `-[:<beats>]`
 * for a rest, `x[:<beats>]` for an unpitched hit; beats default to 1. Pitches are MIDI numbers
 * or names (`C4`, `F#3`, `Bb4`). Consecutive, so `C4 D4 E4:2` is three notes on beats 0, 1, 2.
 */
export function notesFrom(text: string): LessonNote[] {
  const out: LessonNote[] = [];
  let beat = 0;
  for (const token of text.trim().split(/\s+/)) {
    const [head, len] = token.split(':');
    const beats = len === undefined ? 1 : Number(len);
    if (!(beats > 0)) throw new Error(`lesson notes: bad length in "${token}"`);
    if (head !== '-') out.push(head === 'x' ? { beat, beats } : { beat, beats, midi: midiFromName(head) });
    beat += beats;
  }
  return out;
}

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `C4` = 60, `A4` = 69, `F#3`, `Bb4`; a bare number is a MIDI number. */
export function midiFromName(name: string): number {
  if (/^\d+(\.\d+)?$/.test(name)) return Number(name);
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`lesson notes: "${name}" is not a pitch (C4, F#3, Bb4 or a MIDI number)`);
  const pc = PITCH_CLASS[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 12 * (Number(m[3]) + 1) + pc;
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** The nearest note's name for a (fractional) MIDI pitch: 60 -> C4. */
export function nameOf(midi: number): string {
  const r = Math.round(midi);
  return `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}
