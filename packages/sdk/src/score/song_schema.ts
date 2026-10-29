/**
 * The Zod schema of a song (`./song`): what validates a song that comes from outside (an imported
 * file, a game's exported spec). Kept apart so a page that only plays a song never loads Zod; the
 * `satisfies` lines keep the schema and the hand-written types equal.
 */
import { z } from 'zod';
import type { Song, SongNote } from './song';

export const SongNoteSchema = z.object({
  beat: z.number().nonnegative(),
  beats: z.number().positive(),
  midi: z.number().min(0).max(127).optional(),
}) satisfies z.ZodType<SongNote>;

export const SongSchema = z.object({
  title: z.string().optional(),
  bpm: z.number().positive().optional(),
  beatsPerBar: z.number().positive().optional(),
  notes: z.array(SongNoteSchema).min(1),
}) satisfies z.ZodType<Song>;
