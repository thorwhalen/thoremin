/**
 * Note events (#249) — discrete pitched notes on the engine clock, the currency between
 * an air instrument that decides WHEN a note should sound (predicted ahead of the frame
 * that shows the pluck or strum) and `pluck-out`, which sounds it on the audio clock.
 *
 * Kept apart from any one instrument: the air bass emits one note per pluck, the air
 * guitar a strum of several. `voice` is what lets a polyphonic instrument damp only its
 * own previous note on the same string, as a real string is re-plucked.
 */
import { z } from 'zod';

export const NoteEventSchema = z.object({
  /** When it should SOUND, engine seconds (in the future for a predicted pluck). */
  t: z.number(),
  midi: z.number(),
  /** 0..1. */
  velocity: z.number(),
  /** Predicted ahead of the pluck (true) or sounded late on confirmation (false). */
  predicted: z.boolean(),
  /** `t` minus the decision's engine time, seconds (negative = late). */
  lead: z.number(),
  /** The string (voice) this note is played on: a new note on the same voice damps the
   *  one still ringing there. Absent = its own voice, never damped by another note
   *  (unless the sink is mono, where every note shares one voice). */
  voice: z.number().int().nonnegative().optional(),
});
export type NoteEvent = z.infer<typeof NoteEventSchema>;
export const NoteEventsSchema = z.array(NoteEventSchema);
