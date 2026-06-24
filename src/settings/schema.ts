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
import { VOICINGS, RENDERINGS, type VoicingId, type RenderingId } from '@/music/voicing';
import { FACE_MAPPINGS, legacyFaceToMapping, type FaceMapping } from '@/nodes/domain';
import { OverlayParamsSchema } from '@/nodes/output/canvas_overlay';

const ScaleTypeEnum = z.enum(Object.keys(SCALE_TYPES) as [ScaleTypeId, ...ScaleTypeId[]]);
const InstrumentEnum = z.enum(INSTRUMENT_IDS as [InstrumentId, ...InstrumentId[]]);

/** What the player's facial expression controls (none / timbre / chord). */
export const FaceMappingSchema = z.enum(
  FACE_MAPPINGS as unknown as [FaceMapping, ...FaceMapping[]],
);

/** How the face chord sounds: instrument, volume, voicing, rendering, tempo. */
export const FaceChordSchema = z.object({
  instrument: InstrumentEnum,
  volume: z.number().min(0).max(1),
  voicing: z.enum(VOICINGS as unknown as [VoicingId, ...VoicingId[]]),
  rendering: z.enum(RENDERINGS as unknown as [RenderingId, ...RenderingId[]]),
  // 40..200 matches the Tempo slider (one source of truth for the bounds).
  bpm: z.number().min(40).max(200),
});
export type FaceChord = z.infer<typeof FaceChordSchema>;

/** The shipped defaults for the face chord (open voicing, sustained pad, 100 BPM). */
export const DEFAULT_FACE_CHORD: FaceChord = {
  instrument: 'warmPad',
  volume: 0.22,
  voicing: 'spread',
  rendering: 'sustained',
  bpm: 100,
};

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
  // `.default('none')` keeps presets saved before the face-mapping chooser valid
  // (the field is filled in on parse rather than failing validation).
  faceMapping: FaceMappingSchema.default('none'),
  // `.default(...)` keeps presets saved before the chord settings existed valid.
  faceChord: FaceChordSchema.default(DEFAULT_FACE_CHORD),
  overlay: OverlayParamsSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Migrate a raw settings blob saved with the old boolean `faceEnabled` (pre-#64):
 * a saved `faceEnabled: true` becomes `faceMapping: 'timbre'` so a returning
 * player keeps face control on rather than silently reverting to off. New blobs
 * (which already carry `faceMapping`) pass through untouched.
 */
function migrateLegacyFace(raw: unknown): unknown {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.faceMapping === undefined && r.faceEnabled !== undefined) {
      return { ...r, faceMapping: legacyFaceToMapping(r.faceEnabled as boolean | undefined) };
    }
  }
  return raw;
}

/** A named, persisted settings snapshot (one record in the presets collection). */
export const PresetSchema = z.object({
  /** Stable id (a slug of the name); the collection's idField. */
  id: z.string(),
  /** Human-facing name the player typed. */
  name: z.string(),
  /** Creation/last-save time (ms since epoch), for "most recent first" ordering. */
  createdAt: z.number(),
  // Preprocess migrates pre-#64 presets (boolean faceEnabled → faceMapping) on load.
  settings: z.preprocess(migrateLegacyFace, SettingsSchema),
});
export type Preset = z.infer<typeof PresetSchema>;

/** A preset without its (large) settings payload — for listing/picker UIs. */
export type PresetSummary = Pick<Preset, 'id' | 'name' | 'createdAt'>;
