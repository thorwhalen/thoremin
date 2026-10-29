/**
 * The lessons the games ship with: short, public-domain melodies and rhythms, written in the
 * compact note text of `notesFrom`. A first try in each game should take under a minute. Built
 * without Zod (a test validates every one against `LessonSchema`).
 */
import { notesFrom, type Lesson } from './lesson';

const lesson = (l: Omit<Lesson, 'notes' | 'countIn' | 'hint'> & { notes: string; countIn?: number; hint?: string }): Lesson => ({
  countIn: 4,
  hint: '',
  ...l,
  notes: notesFrom(l.notes),
});

export const LESSONS: readonly Lesson[] = [
  // Sing: a five-note scale up and down, then two public-domain tunes.
  lesson({ id: 'sing-five', title: 'Five notes up and down', game: 'sing', bpm: 80, notes: 'C4:2 D4:2 E4:2 F4:2 G4:4 F4:2 E4:2 D4:2 C4:4', hint: 'Sing "ah" on each note; any octave counts.' }),
  lesson({ id: 'sing-twinkle', title: 'Twinkle, twinkle', game: 'sing', bpm: 90, notes: 'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2' }),
  lesson({ id: 'sing-ode', title: 'Ode to Joy', game: 'sing', bpm: 100, notes: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:0.5 D4:2' }),
  // Play along: rhythms to clap or tap first (the rhythm trainer's level), then a melody.
  lesson({ id: 'rhythm-quarters', title: 'Clap on the beat', game: 'play-along', bpm: 90, notes: 'x x x x x x x x', hint: 'Clap or tap the table on every beat.' }),
  lesson({ id: 'rhythm-eighths', title: 'Eighths and rests', game: 'play-along', bpm: 90, notes: 'x x:0.5 x:0.5 x - x:0.5 x:0.5 x x x:0.5 x:0.5 x x:2' }),
  lesson({ id: 'rhythm-offbeat', title: 'Off the beat', game: 'play-along', bpm: 80, notes: '-:0.5 x:0.5 -:0.5 x:0.5 -:0.5 x:0.5 -:0.5 x:0.5 x x x:2' }),
  lesson({ id: 'play-mary', title: 'Mary had a little lamb', game: 'play-along', bpm: 80, notes: 'E4 D4 C4 D4 E4 E4 E4:2 D4 D4 D4:2 E4 G4 G4:2', hint: 'Sing it, hum it, or play it on any instrument.' }),
  // Match the note: hear it, find it, hold it.
  lesson({ id: 'match-triad', title: 'Find the notes of C major', game: 'match', bpm: 60, countIn: 0, notes: 'C4 E4 G4 C5 G4 E4 C4' }),
  lesson({ id: 'match-steps', title: 'Steps and leaps', game: 'match', bpm: 60, countIn: 0, notes: 'D4 E4 A4 F4 B3 G4 D4' }),
];

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);
export const lessonsFor = (game: Lesson['game']): Lesson[] => LESSONS.filter((l) => l.game === game);
