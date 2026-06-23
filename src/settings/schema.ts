/**
 * Settings schema — the single source of truth for what a saved "preset" is: a
 * named snapshot of every tunable control (the two voices, sync, master volume,
 * and the overlay element config). Affordances are declared here as a Zod schema;
 * storage target and UI are derived from it (zodal), so the shape lives in one
 * place. See docs/design/component-model.md ("Settings & persistence").
 *
 * The voice fields mirror the live zustand control store (src/app/store.ts) so
 * loading a preset can hydrate it without translation; the overlay field reuses
 * the overlay node's own params schema (canvas_overlay.ts) so it can never drift.
 */
import { z } from 'zod';
import { SCALE_TYPES, type ScaleTypeId } from '@/music/theory';
import { INSTRUMENT_IDS, type InstrumentId } from '@/music/instruments';
import { OverlayParamsSchema } from '@/nodes/output/canvas_overlay';

const ScaleTypeEnum = z.enum(Object.keys(SCALE_TYPES) as [ScaleTypeId, ...ScaleTypeId[]]);
const InstrumentEnum = z.enum(INSTRUMENT_IDS as [InstrumentId, ...InstrumentId[]]);

/** One hand's musical settings — mirrors VoiceControl in src/app/store.ts. */
export const VoiceSettingsSchema = z.object({
  root: z.number().int().min(0).max(11),
  type: ScaleTypeEnum,
  octaves: z.number().int().min(1).max(4),
  baseOctave: z.number().int().min(0).max(8),
  instrument: InstrumentEnum,
});
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

/** A full snapshot of the tunable controls (what a preset stores). */
export const SettingsSchema = z.object({
  right: VoiceSettingsSchema,
  left: VoiceSettingsSchema,
  syncHands: z.boolean(),
  masterVolume: z.number().min(0).max(1),
  // `.default(false)` keeps presets saved before face control was added valid
  // (the field is filled in on parse rather than failing validation).
  faceEnabled: z.boolean().default(false),
  overlay: OverlayParamsSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

/** A named, persisted settings snapshot (one record in the presets collection). */
export const PresetSchema = z.object({
  /** Stable id (a slug of the name); the collection's idField. */
  id: z.string(),
  /** Human-facing name the player typed. */
  name: z.string(),
  /** Creation/last-save time (ms since epoch), for "most recent first" ordering. */
  createdAt: z.number(),
  settings: SettingsSchema,
});
export type Preset = z.infer<typeof PresetSchema>;

/** A preset without its (large) settings payload — for listing/picker UIs. */
export type PresetSummary = Pick<Preset, 'id' | 'name' | 'createdAt'>;
