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
import { BODY_MODELS, FACE_MAPPINGS, legacyFaceToMapping, type FaceMapping } from '@/nodes/domain';
import { OverlayDialSchema } from '@/nodes/output/canvas_overlay';
import { FaceControlsDialSchema, DEFAULT_FACE_CONTROLS_DIAL } from '@/nodes/features/face_controls';
import { SteerConfigSchema, type SteerConfig } from '@/nodes/mapping/indirect_map';
// Re-exported so the `steer.*` commands (whose import allowlist stops at `@/settings`)
// validate against the node's own contract without reaching into `src/nodes`.
export { SteerConfigSchema, SteerStrainSchema, SteerDialSchema, STEER_SOURCES, STEER_HANDS, STEER_FEATURES, STEER_HAND_FEATURES, STEER_FACE_FEATURES, STEER_DIAL_NAMES } from '@/nodes/mapping/indirect_map';
export type { SteerConfig, SteerStrain, SteerDial } from '@/nodes/mapping/indirect_map';
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

/**
 * MIDI output settings (#137): whether the merged voices also drive a Web MIDI
 * output, and which port they target ('' = first available). Part of the
 * instrument (a hardware-synth instrument profile wants "plays over MIDI" saved
 * with it); the port NAME is device-specific, but a port that doesn't exist on
 * this machine degrades to an honest `no-ports` status, never an error. The
 * `.default(...)` keeps presets saved before MIDI reachability valid (off).
 */
export const MidiSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.string().default(''),
});
export type MidiSettings = z.infer<typeof MidiSettingsSchema>;

/** The shipped MIDI defaults: off, first available port. */
export const DEFAULT_MIDI: MidiSettings = { enabled: false, port: '' };

/** The body source (#186): on/off + which PoseLandmarker model to load. `BODY_MODELS`
 *  is the node's own list (`@/nodes/domain`), re-exported so the panel reads one SSOT. */
export { BODY_MODELS };
export const BodySettingsSchema = z.object({
  enabled: z.boolean(),
  model: z.enum(BODY_MODELS),
});
export type BodySettings = z.infer<typeof BodySettingsSchema>;

/** The shipped body defaults: off (the model is the most expensive in the graph), lite. */
export const DEFAULT_BODY: BodySettings = { enabled: false, model: 'lite' };
/**
 * The generative layer (#141 / #188): gesture features steering a cloud generative
 * engine (Lyria RealTime) through the `indirect-map → lyria` branch. A preset field:
 * "this instrument has a generative layer, at this level, driven by these strains"
 * is instrument identity, like "plays over MIDI". `config` is the node's own
 * {@link SteerConfigSchema}, imported rather than restated so the dial, the store and
 * the port can never disagree about the shape; `{}` means the branch's build-time
 * starter strains. The TRANSPORT (playing) is deliberately NOT here: a persisted
 * transport would ride a saved instrument and start a paid stream on load, so it is
 * transient hot-store state on the `muted` precedent (see `src/app/store.ts`).
 */
export const SteerSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  volume: z.number().min(0).max(1).default(0.7),
  config: SteerConfigSchema.default(() => defaultSteerConfig()),
});
export type SteerSettings = z.infer<typeof SteerSettingsSchema>;

/**
 * The default steering CONFIG — what the gestures mean until the player edits it:
 * the right hand's openness fades a pad in, raising the left hand brings in an
 * arpeggio, raising the right hand brightens the mix. The hand `y` feature is in IMAGE
 * coordinates (0 at the top), so "raise = more" is the inverted `inMin: 1, inMax: 0`,
 * exactly as `voice-mapping` inverts it for gain. COMPLETE (strains, dials, smoothing,
 * cadence) rather than partial, so the structured dial always fully specifies the
 * steering — the editor and the `steer.*` commands read and write one whole object,
 * and the scalar leaves resolve for `dial.setIn`. `graph.ts` hands the same object to
 * `indirect-map` as its build-time params, so an unset dial and the default agree.
 */
export const DEFAULT_STEER_CONFIG: SteerConfig = {
  strains: [
    { text: 'warm ambient pads', source: 'hand', hand: 'right', feature: 'openness', inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 },
    { text: 'bright plucked arpeggios', source: 'hand', hand: 'left', feature: 'y', inMin: 1, inMax: 0, weightMin: 0, weightMax: 2 },
  ],
  dials: [{ name: 'brightness', source: 'hand', hand: 'right', feature: 'y', inMin: 1, inMax: 0, outMin: 0.2, outMax: 0.9 }],
  smoothing: 0.6,
  throttleSec: 0.2,
};

/** A fresh, unshared copy of {@link DEFAULT_STEER_CONFIG} (its arrays must never be
 *  aliased between the defaults, the store and an instrument). */
export const defaultSteerConfig = (): SteerConfig => structuredClone(DEFAULT_STEER_CONFIG);

/** The shipped generative defaults: off, 0.7, the default steering config. */
export const DEFAULT_STEER: SteerSettings = { enabled: false, volume: 0.7, config: defaultSteerConfig() };

/** One hand's musical settings — mirrors VoiceControl in src/app/store.ts. */
export const VoiceSettingsSchema = z.object({
  root: z.number().int().min(0).max(11),
  type: ScaleTypeEnum,
  octaves: z.number().int().min(1).max(4),
  baseOctave: z.number().int().min(0).max(8),
  sound: InstrumentEnum,
  // #63 octave RANGE (fractional octaves below/above the locked middle octave). OPTIONAL
  // (NOT `.default(...)`): a pre-#63 preset parses WITHOUT them → the legacy `octaves`
  // scale path → byte-identical sound (even for octaves ≥ 3, which the 1..3 range can't
  // represent). New/edited voices carry them (set in the store + dials defaults).
  rangeLow: z.number().min(0).max(1).optional(),
  rangeHigh: z.number().min(0).max(1).optional(),
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
  overlay: OverlayDialSchema,
  // Note source + finger→effect routing + the once-static voice-mapping knobs.
  handMap: HandMapSchema,
  // MIDI output (#137). `.default(...)` keeps pre-MIDI presets valid (off).
  midi: MidiSettingsSchema.default(DEFAULT_MIDI),
  // The body source (#186). `.default(...)` keeps pre-body presets valid (off, lite).
  body: BodySettingsSchema.default(DEFAULT_BODY),
  // The generative layer (#141 / #188). `.default(...)` keeps pre-#188 presets valid (off).
  steer: SteerSettingsSchema.default(DEFAULT_STEER),
  // The head/face CONTROL axes (#76): per-axis gain / deadzone / zero / smoothing for
  // the `face-controls` node. The schema is the node's own params, imported rather
  // than restated (see FaceControlsDialSchema) so the two can never drift.
  // `.default(...)` keeps presets saved before #76's dials valid — they get the shipped
  // axis tuning, which is byte-identical to the build-time params they were played with.
  faceControls: FaceControlsDialSchema.default(DEFAULT_FACE_CONTROLS_DIAL),
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
