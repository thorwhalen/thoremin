/**
 * What the sound mapper keeps (the zodal way: the schema first). A sound map is the player's
 * classes ("table, middle", "pot"), each with the kit sound it plays and the taps that taught it;
 * the taps are the raw audio around each onset (`@thoremin/sdk/audio/examples`: the SSOT, the
 * classifier is derived), stored as base64 16-bit PCM. Plus the few settings that shape how it
 * plays: the two analysis windows, velocity and gain.
 */
import { z } from 'zod';
import { KIT_SOUNDS } from '@thoremin/sdk/audio/kit';
import { SOUND_MAPPER_DEFAULTS } from '@thoremin/sdk/audio/mapper';

export const SOUND_MAPPER_LIMITS = {
  /** Classes a map may hold (one per kit sound is plenty for two hands). */
  classes: 8,
  /** Taught taps kept per class (the oldest go first). */
  examples: 24,
  windowMs: [2, 20],
  refineMs: [0, 40],
} as const;

export const TaughtTapSchema = z.object({
  id: z.string().min(1),
  sampleRate: z.number().int().min(8000).max(192000),
  /** Index of the onset inside the decoded PCM. */
  onset: z.number().int().min(0),
  /** Base64 of little-endian 16-bit PCM. */
  pcm: z.string(),
});
export type TaughtTap = z.infer<typeof TaughtTapSchema>;

export const SoundClassSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(40),
  sound: z.enum(KIT_SOUNDS),
  examples: z.array(TaughtTapSchema).max(SOUND_MAPPER_LIMITS.examples).default([]),
});
export type SoundClass = z.infer<typeof SoundClassSchema>;

export const SoundMapSchema = z.object({
  classes: z.array(SoundClassSchema).max(SOUND_MAPPER_LIMITS.classes).default([]),
  windowMs: z.number().min(SOUND_MAPPER_LIMITS.windowMs[0]).max(SOUND_MAPPER_LIMITS.windowMs[1]).default(SOUND_MAPPER_DEFAULTS.windowMs),
  /** 0 = decide once, on the fast window. */
  refineMs: z.number().min(SOUND_MAPPER_LIMITS.refineMs[0]).max(SOUND_MAPPER_LIMITS.refineMs[1]).default(SOUND_MAPPER_DEFAULTS.refineMs),
  velocity: z.number().min(0).max(1).default(SOUND_MAPPER_DEFAULTS.velocity),
  gain: z.number().min(0).max(1.5).default(SOUND_MAPPER_DEFAULTS.gain),
});
export type SoundMap = z.infer<typeof SoundMapSchema>;

export const EMPTY_SOUND_MAP: SoundMap = SoundMapSchema.parse({});

/** A saved map: a named record of the zodal collection. */
export const SoundMapRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number(),
  map: SoundMapSchema,
});
export type SoundMapRecord = z.infer<typeof SoundMapRecordSchema>;
