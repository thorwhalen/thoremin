/**
 * The Zod schema of a game spec (`./spec`): what validates a spec imported from a file. Kept apart
 * so a page loads Zod only when the player imports; `satisfies` keeps the schema and the types equal.
 * `parseGameSpec` says in words what is wrong with a file that is not a spec.
 */
import { z } from 'zod';
import { SongSchema } from '@thoremin/sdk/score/song_schema';
import { DIFFICULTIES } from './difficulty';
import { STACKS } from './echo';
import { TUNING_RANGES } from './tuning';
import { GAME_IDS, SPEC_KIND, type GameSettings, type GameSpec } from './spec';

export const GameSettingsSchema = z
  .object({
    difficulty: z.enum(DIFFICULTIES).optional(),
    lesson: z.string().optional(),
    bpm: z.number().positive().max(400).optional(),
    countIn: z.number().int().min(0).max(16).optional(),
    track: z.string().optional(),
    beatsPerBar: z.number().positive().max(16).optional(),
    stack: z.enum(STACKS).optional(),
    barsPerPiece: z.number().int().positive().max(16).optional(),
    passAt: z.number().min(0).max(1).optional(),
    retries: z.number().int().min(0).max(5).optional(),
    clickWhileAnswering: z.boolean().optional(),
    count: z.number().int().positive().max(200).optional(),
    mode: z.string().optional(),
    vowels: z.array(z.string()).optional(),
    size: z.number().min(TUNING_RANGES.size.min).max(TUNING_RANGES.size.max).optional(),
    holdS: z.number().min(TUNING_RANGES.holdS.min).max(TUNING_RANGES.holdS.max).optional(),
    smoothing: z.number().min(TUNING_RANGES.smoothing.min).max(TUNING_RANGES.smoothing.max).optional(),
    tolerance: z.number().min(TUNING_RANGES.tolerance.min).max(TUNING_RANGES.tolerance.max).optional(),
  })
  .strict() satisfies z.ZodType<GameSettings>;

export const GameSpecSchema = z.object({
  kind: z.literal(SPEC_KIND),
  version: z.number().int().positive(),
  game: z.enum(GAME_IDS),
  title: z.string().optional(),
  settings: GameSettingsSchema.default({}),
  song: SongSchema.optional(),
}) satisfies z.ZodType<GameSpec, unknown>;

/** A spec from decoded data (a parsed JSON, YAML or TOML file), or an error saying what is wrong. */
export function parseGameSpec(data: unknown): GameSpec {
  const r = GameSpecSchema.safeParse(data);
  if (r.success) return r.data;
  const issues = r.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || 'the file'}: ${i.message}`);
  throw new Error(`Not a funfon game: ${issues.join('; ')}`);
}
