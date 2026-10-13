/**
 * The `asl` dial's schema: the sign reader's node params lifted into the settings. Its own
 * module, importing only Zod, because the extension's EAGER stub (`./index.ts`, `./dials.ts`)
 * must carry the dial (settings typing, hydration, the palette) without pulling the node and
 * the recogniser into the main chunk (`docs/design/lazy-extensions.md`).
 */
import { z } from 'zod';

const Params = z.object({
  /** The sign reader is on. Off by default: nothing new happens for a player who never asks. */
  enabled: z.boolean().default(false),
  /** Also read the movement signs (J, Z and the words); off = the 24 held letters only. */
  motion: z.boolean().default(true),
  /** A sign is named only above this smoothed score. */
  minConfidence: z.number().min(0.2).max(0.95).default(0.45),
  /** Smoothing time constant, seconds (0 = none: every frame's reading as is). */
  smoothing: z.number().min(0).max(0.5).default(0.12),
  /** A..G play chords of the key (the ASL chords instrument). */
  chords: z.boolean().default(false),
  /** Chords: keep the last chord sounding while the hand signs other things (off = only while A..G is held). */
  holdChord: z.boolean().default(true),
});
export const AslDialSchema = Params;
export type AslDialParams = z.infer<typeof Params>;
export const DEFAULT_ASL_DIAL: AslDialParams = AslDialSchema.parse({});
