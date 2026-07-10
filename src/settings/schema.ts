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
import { SOUND_IDS, type SoundId } from '@/music/sounds';
import { VOICINGS, RENDERINGS, type VoicingId, type RenderingId } from '@/music/voicing';
import { FACE_MAPPINGS, legacyFaceToMapping, type FaceMapping } from '@/nodes/domain';
import { OverlayParamsSchema } from '@/nodes/output/canvas_overlay';
import { DEFAULT_EXPRESSION_SENSITIVITY, DEFAULT_EXPRESSION_TO_DEGREE } from '@/music/expression';
import {
  EFFECTS,
  POSITION_SOURCES,
  FINGER_MODES,
  DEFAULT_HAND_MAP,
  type FingerTarget,
  type PositionSource,
  type FingerMode,
} from '@/nodes/mapping/hand_map';

const ScaleTypeEnum = z.enum(Object.keys(SCALE_TYPES) as [ScaleTypeId, ...ScaleTypeId[]]);
const InstrumentEnum = z.enum(SOUND_IDS as [SoundId, ...SoundId[]]);

// ---- Hand map (note source + finger→effect routing + once-static voice knobs) ----
const FingerTargetEnum = z.enum(['none', ...EFFECTS] as unknown as [FingerTarget, ...FingerTarget[]]);
const FingerRouteSchema = z.object({
  target: FingerTargetEnum,
  sensitivity: z.number().min(0).max(2),
  mode: z.enum(FINGER_MODES as unknown as [FingerMode, ...FingerMode[]]),
  invert: z.boolean(),
});
/** A saved hand→sound mapping. `.default(...)` keeps presets/instruments saved before
 *  the hand map existed valid (they get the classic index-note-source, no-routing map). */
export const HandMapSchema = z
  .object({
    positionSource: z.enum(POSITION_SOURCES as unknown as [PositionSource, ...PositionSource[]]),
    fingers: z.object({
      index: FingerRouteSchema,
      middle: FingerRouteSchema,
      ring: FingerRouteSchema,
      pinky: FingerRouteSchema,
    }),
    magnetism: z.number().min(0).max(1),
    maxGain: z.number().min(0).max(1),
    opennessGatesGain: z.boolean(),
    opennessControlsBrightness: z.boolean(),
    pinchControlsVibrato: z.boolean(),
    panByPosition: z.boolean(),
    panSpread: z.number().min(0).max(1),
  })
  // A fresh deep clone per parse — `.default(obj)` only shallow-copies, so nested
  // finger-route objects would otherwise be shared across every parse AND the constant.
  .default(() => structuredClone(DEFAULT_HAND_MAP));
export type HandMapSettings = z.infer<typeof HandMapSchema>;

/** What the player's facial expression controls (none / timbre / chord). */
export const FaceMappingSchema = z.enum(
  FACE_MAPPINGS as unknown as [FaceMapping, ...FaceMapping[]],
);

/** How the face chord sounds: sound, volume, voicing, rendering, tempo, and — since
 *  #75 — WHERE its chords are drawn from (the chord-source scale, decoupled from the
 *  right-hand melody scale). `chordSource: 'auto'` (the default) recomputes the source
 *  from the melody scale each tick via `defaultChordSpecFor` (so a pentatonic melody
 *  still gets chords, and a seven-note melody sounds exactly as before); `'custom'`
 *  pins it to `chordRoot`/`chordType` (any scale, even non-traditional). The
 *  `.default(...)` on the three new fields keeps presets saved before #75 valid — they
 *  resolve to auto → identical sound on the seven-note melodies they were saved with. */
export const FaceChordSchema = z.object({
  sound: InstrumentEnum,
  volume: z.number().min(0).max(1),
  voicing: z.enum(VOICINGS as unknown as [VoicingId, ...VoicingId[]]),
  rendering: z.enum(RENDERINGS as unknown as [RenderingId, ...RenderingId[]]),
  // 40..200 matches the Tempo slider (one source of truth for the bounds).
  bpm: z.number().min(40).max(200),
  // #75: chord-source scale (decoupled from the melody). auto = follow the melody
  // (smart default); custom = the chordRoot/chordType below. `.default(...)` keeps
  // pre-#75 presets valid (filled on parse) → auto → identical sound.
  chordSource: z.enum(['auto', 'custom']).default('auto'),
  chordRoot: z.number().int().min(0).max(11).default(0),
  chordType: ScaleTypeEnum.default('major'),
});
export type FaceChord = z.infer<typeof FaceChordSchema>;

/** The shipped defaults for the face chord (open voicing, sustained pad, 100 BPM,
 *  chord source following the melody). */
export const DEFAULT_FACE_CHORD: FaceChord = {
  sound: 'warmPad',
  volume: 0.22,
  voicing: 'spread',
  rendering: 'sustained',
  bpm: 100,
  chordSource: 'auto',
  chordRoot: 0,
  chordType: 'major',
};

/**
 * The face-expression mapping config: per-emotion firing `sensitivity` [0,1] (more
 * sensitive = more hits — see the classifier in music/expression.ts) and a
 * per-expression scale-`degrees` override (0..6) selecting which diatonic triad
 * each expression — including `neutral` — plays. Loose `record` shape + full
 * defaults; consumers heal any missing key, so a partial blob can't crash a reader.
 */
export const FaceExprSchema = z
  .object({
    sensitivity: z
      .record(z.string(), z.number().min(0).max(1))
      .default({ ...DEFAULT_EXPRESSION_SENSITIVITY }),
    // -1 = silence (SILENCE_DEGREE, play nothing); 0..6 = a scale degree.
    degrees: z
      .record(z.string(), z.number().int().min(-1).max(6))
      .default({ ...DEFAULT_EXPRESSION_TO_DEGREE }),
  })
  .default({
    sensitivity: { ...DEFAULT_EXPRESSION_SENSITIVITY },
    degrees: { ...DEFAULT_EXPRESSION_TO_DEGREE },
  });
export type FaceExpr = z.infer<typeof FaceExprSchema>;

/** The shipped defaults for the expression mapping (research-grounded sensitivity
 *  + the hand-picked degree assignment — one diatonic degree per emotion). */
export const DEFAULT_FACE_EXPR: FaceExpr = {
  sensitivity: { ...DEFAULT_EXPRESSION_SENSITIVITY },
  degrees: { ...DEFAULT_EXPRESSION_TO_DEGREE },
};

/** One hand's musical settings — mirrors VoiceControl in src/app/store.ts. */
export const VoiceSettingsSchema = z.object({
  root: z.number().int().min(0).max(11),
  type: ScaleTypeEnum,
  octaves: z.number().int().min(1).max(4),
  baseOctave: z.number().int().min(0).max(8),
  sound: InstrumentEnum,
});
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

/** A full snapshot of the tunable controls (what a preset stores). */
export const SettingsSchema = z.object({
  right: VoiceSettingsSchema,
  left: VoiceSettingsSchema,
  syncHands: z.boolean(),
  masterVolume: z.number().min(0).max(1),
  // Global octave transpose (all voices + chords + overlay) and scale-snap
  // magnetism. Keyboard-driven (#90) but modeled as dials so they are
  // command-dispatched (the single write path) and saved with an instrument.
  // `.default(...)` keeps presets saved before #90 valid (filled on parse).
  octaveShift: z.number().int().min(-2).max(2).default(0),
  magnetism: z.number().min(0).max(1).default(0.8),
  // `.default('none')` keeps presets saved before the face-mapping chooser valid
  // (the field is filled in on parse rather than failing validation).
  faceMapping: FaceMappingSchema.default('none'),
  // `.default(...)` keeps presets saved before the chord settings existed valid.
  faceChord: FaceChordSchema.default(DEFAULT_FACE_CHORD),
  // Per-emotion sensitivity + per-expression degree map; `.default(...)` keeps
  // presets saved before the expression-mapping editor valid.
  faceExpr: FaceExprSchema,
  overlay: OverlayParamsSchema,
  // Note source + finger→effect routing + the once-static voice-mapping knobs.
  handMap: HandMapSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

/** Rename a legacy `instrument` timbre field to `sound` on a settings sub-object,
 *  so a returning preset keeps its sound after the instrument → sound rename. */
function renameInstrumentField(obj: unknown): unknown {
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    if (o.instrument !== undefined && o.sound === undefined) {
      const { instrument, ...rest } = o;
      return { ...rest, sound: instrument };
    }
  }
  return obj;
}

/**
 * Migrate a raw settings blob from older saves: pre-#64 `faceEnabled` → `faceMapping`,
 * and the per-hand / chord timbre `instrument` → `sound`. New blobs (already carrying
 * `faceMapping` + `sound`) pass through untouched.
 */
function migrateLegacySettings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if (r.faceMapping === undefined && r.faceEnabled !== undefined) {
    r.faceMapping = legacyFaceToMapping(r.faceEnabled as boolean | undefined);
  }
  r.right = renameInstrumentField(r.right);
  r.left = renameInstrumentField(r.left);
  r.faceChord = renameInstrumentField(r.faceChord);
  return r;
}

/** A named, persisted settings snapshot (one record in the presets collection). */
export const PresetSchema = z.object({
  /** Stable id (a slug of the name); the collection's idField. */
  id: z.string(),
  /** Human-facing name the player typed. */
  name: z.string(),
  /** Creation/last-save time (ms since epoch), for "most recent first" ordering. */
  createdAt: z.number(),
  // Preprocess migrates older presets (faceEnabled → faceMapping; instrument → sound) on load.
  settings: z.preprocess(migrateLegacySettings, SettingsSchema),
});
export type Preset = z.infer<typeof PresetSchema>;

/** A preset without its (large) settings payload — for listing/picker UIs. */
export type PresetSummary = Pick<Preset, 'id' | 'name' | 'createdAt'>;
