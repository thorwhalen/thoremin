/**
 * The Zod schema of a lesson (`./lesson.ts`): what validates a lesson that comes from outside
 * the code (a file, a player's own). Kept apart so the sessions and a page that plays the shipped
 * lessons never load Zod; the `satisfies` lines keep the schema and the hand-written types equal.
 */
import { z } from 'zod';
import { GAME_KINDS, type Lesson, type LessonNote } from './lesson';

export const LessonNoteSchema = z.object({
  beat: z.number().nonnegative(),
  beats: z.number().positive(),
  midi: z.number().optional(),
}) satisfies z.ZodType<LessonNote>;

export const LessonSchema = z.object({
  id: z.string(),
  title: z.string(),
  game: z.enum(GAME_KINDS),
  bpm: z.number().positive(),
  beatsPerBar: z.number().positive().max(16).optional(),
  countIn: z.number().int().nonnegative().default(4),
  notes: z.array(LessonNoteSchema).min(1),
  hint: z.string().default(''),
}) satisfies z.ZodType<Lesson, unknown>;
