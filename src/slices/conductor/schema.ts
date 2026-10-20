/**
 * The conductor slice's dial and pref (#187; a slice since #600 S18b).
 *
 * The `conductor` dial is one object (its key unchanged, so saved instruments and the dial paths
 * `conductor.enabled`, `conductor.hand`, ... keep theirs): the conductor node's own params lifted
 * 1:1, plus `piece` (WHICH score to conduct: a shipped demo's id, a saved score's id, or
 * {@link BUILTIN_PIECE}), the sampled `orchestra`, and `parts`. Its version 2 is core's v20-to-v21
 * store step, moved here: an instrument or a stored state saved before the dial had a `prior` was
 * played by the oscillator and keeps it ({@link LEGACY_CONDUCTOR_PRIOR}); only one made from now on
 * takes the schema's default. Its version 3 (#600 S18c) moves the beat ring's show flag in from
 * core's overlay dial (`overlay.conductorHud`, now `hudOnVideo`): the ring is this slice's own
 * overlay element.
 *
 * `conductorPrefs` is a per-DEVICE pref (#427): the player's lead offset per joint, learned against a
 * click in the Conductor tool ("Learn my timing"), the same under every instrument.
 */
import { z } from 'zod';
import { ConductorDialSchema, LeadOffsetsSchema } from './nodes/conductor.schema';
import { DEFAULT_ORCHESTRA, OrchestraSettingsSchema } from './nodes/orchestra.schema';
import { movedFromOverlay } from '@thoremin/sdk/overlay/moved';

/** The piece id that means "the built-in demo scale" (no document loaded). */
export const BUILTIN_PIECE = 'builtin';
/** The default piece: the shipped Beethoven 5 opening (see `./score/library.ts`). */
export const DEFAULT_PIECE = 'beethoven-symphony-5-1';
/** What an instrument saved before the conductor dial had a `prior` field (#232) is played by: the
 *  oscillator, which is what it was played by when it was saved. The schema's default (`blend`) is
 *  for instruments made from now on. */
export const LEGACY_CONDUCTOR_PRIOR = 'oscillator' as const;

/** The conductor's beat ring drawn on the video (#187; core's `overlay.conductorHud` until #600 S18c). */
export const HudOnVideoSchema = z.object({ show: z.boolean().default(true) }).prefault({});

export const ConductorSettingsSchema = ConductorDialSchema.extend({
  piece: z.string().default(DEFAULT_PIECE),
  /** The sampled orchestra (#187 PR 5): on/off, overall and per-section level. Like `piece`, the
   *  conductor node never sees it (its `config` port strips it); the `orchestra` node reads it from
   *  the same dial. */
  orchestra: OrchestraSettingsSchema.default(() => structuredClone(DEFAULT_ORCHESTRA)),
  /** Which parts of the loaded piece play (#471): the ids, comma-separated, empty = all. Read by the
   *  `score` node and the `orchestra` from this one dial, so the two players cannot disagree. A
   *  string so the leaf stays a scalar dial path. */
  parts: z.string().default(''),
  /** Whether the beat ring shows on the video while conducting. */
  hudOnVideo: HudOnVideoSchema,
});
export type ConductorSettings = z.infer<typeof ConductorSettingsSchema>;
export const DEFAULT_CONDUCTOR: ConductorSettings = ConductorSettingsSchema.parse({});

/** Version 1 to 2 (core's store step v20 to v21 before #600 S18b): a conductor saved without a
 *  `prior` keeps the oscillator it was played by. A dial that has one is left as it is. */
export function migrateConductorV1(value: unknown): unknown {
  const cond = value as Record<string, unknown> | undefined;
  return cond && typeof cond === 'object' && cond.prior === undefined ? { ...cond, prior: LEGACY_CONDUCTOR_PRIOR } : value;
}

/** Version 2 to 3 (#600 S18c): the beat ring's show flag moves in from `overlay.conductorHud`. */
export const migrateConductorV2 = movedFromOverlay('conductorHud', 'hudOnVideo', HudOnVideoSchema);

export const ConductorPrefsSchema = z.object({
  leadOffsets: LeadOffsetsSchema.default({}),
});
export type ConductorPrefs = z.infer<typeof ConductorPrefsSchema>;
export const DEFAULT_CONDUCTOR_PREFS: ConductorPrefs = { leadOffsets: {} };
