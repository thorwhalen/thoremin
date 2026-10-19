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
import { SCALE_TYPES, type ScaleTypeId } from '@thoremin/sdk/music/theory';
import { SOUND_IDS, type SoundId } from '@thoremin/sdk/music/sounds';
import { VOICINGS, RENDERINGS, type VoicingId, type RenderingId } from '@/music/voicing';
import { BODY_MODELS, FACE_MAPPINGS, legacyFaceToMapping, type FaceMapping } from '@thoremin/sdk/nodes/domain';
import { DEFAULT_HANDEDNESS_DWELL_FRAMES, MAX_HANDEDNESS_DWELL_FRAMES } from '@thoremin/sdk/features/handedness';
import { BodyMapSchema, DEFAULT_BODY_MAP } from '@/nodes/mapping/body_map.schema';
import { OverlayDialSchema } from '@/nodes/output/canvas_overlay.schema';
import { FaceControlsDialSchema, DEFAULT_FACE_CONTROLS_DIAL } from '@/nodes/features/face_controls.schema';
import { SteerConfigSchema, defaultSteerConfig } from '@/nodes/mapping/indirect_map.schema';
// Re-exported so the `steer.*` commands (whose import allowlist stops at `@/settings`)
// validate against the node's own contract without reaching into `src/nodes`.
export { SteerConfigSchema, SteerStrainSchema, SteerDialSchema, STEER_SOURCES, STEER_HANDS, STEER_FEATURES, STEER_HAND_FEATURES, STEER_FACE_FEATURES, STEER_DIAL_NAMES } from '@/nodes/mapping/indirect_map.schema';
export type { SteerConfig, SteerStrain, SteerDial } from '@/nodes/mapping/indirect_map.schema';
import { ConductorDialSchema, LeadOffsetsSchema } from '@/nodes/features/conductor.schema';
import { DEFAULT_ORCHESTRA, OrchestraSettingsSchema } from '@/nodes/output/orchestra.schema';
// The extensions' dials (today the air instruments') are folded in from the manifests:
// the runtime shape from the injected list, the TYPE from its generated declaration
// (`src/extensions/virtual.d.ts`), so core never imports an extension to know its keys.
import { assertNoCoreClash, CONTRIBUTIONS, SETTINGS_SHAPE, type ExtensionTransients } from '@/host/contributions';

/** The piece id that means "the built-in demo scale" (no document loaded). */
export const BUILTIN_PIECE = 'builtin';
/** The default piece: the shipped Beethoven 5 opening (see `src/score/library.ts`). */
export const DEFAULT_PIECE = 'beethoven-symphony-5-1';
/** What an instrument saved before the conductor dial had a `prior` field (#232) is
 *  played by: the oscillator, which is what it was played by when it was saved. The
 *  schema's default (`blend`) is for instruments made from now on; `normalizeLayer`
 *  and the hot store's migration fill this one into a `conductor` object that lacks
 *  the key, so adding the field changed no saved instrument's behaviour. */
export const LEGACY_CONDUCTOR_PRIOR = 'oscillator' as const;

/**
 * The conductor settings (#187): the node's own params (lifted 1:1, the `faceControls`
 * pattern) plus `piece` — WHICH score to conduct (a shipped demo's id, a saved score's
 * id, or {@link BUILTIN_PIECE}). `piece` is an app-level selection the node never sees
 * (the node's `config` port strips it): the app's `ScoreLoader` watches it and hands the
 * loaded `ScoreDoc` to the graph.
 */
export const ConductorSettingsSchema = ConductorDialSchema.extend({
  piece: z.string().default(DEFAULT_PIECE),
  /** The sampled orchestra (#187 PR 5): on/off, overall and per-section level. Like
   *  `piece`, the conductor node never sees it (its `config` port strips it); the
   *  `orchestra` node reads it from the same dial. */
  orchestra: OrchestraSettingsSchema.default(() => structuredClone(DEFAULT_ORCHESTRA)),
  /** Which parts of the loaded piece play (#471): the ids, comma-separated, empty = all.
   *  Read by the `score` node and the `orchestra` from this one dial, so the two players
   *  cannot disagree (`parsePartsSelection`). A string so the leaf stays a scalar dial path. */
  parts: z.string().default(''),
});
export type ConductorSettings = z.infer<typeof ConductorSettingsSchema>;
export const DEFAULT_CONDUCTOR: ConductorSettings = ConductorSettingsSchema.parse({});
import { DEFAULT_EXPRESSION_SENSITIVITY, DEFAULT_EXPRESSION_TO_DEGREE, EXPRESSIONS } from '@/music/expression';
import {
  EFFECTS,
  POSITION_SOURCES,
  FINGER_MODES,
  DEFAULT_HAND_MAP,
  type FingerTarget,
  type PositionSource,
  type FingerMode,
} from '@/nodes/mapping/hand_map.schema';

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

/** No expression has a target beyond its degree until a player sets one (every key listed, so the
 *  command layer can address each by path: `faceExpr.targets.happy`). */
export const DEFAULT_EXPRESSION_TARGETS: Readonly<Record<string, string>> = Object.fromEntries(EXPRESSIONS.map((e) => [e, '']));

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
    // What an expression stands for beyond its degree (H6 of #613, `@thoremin/sdk/harmony/target`
    // strings): '' or absent = its degree (every instrument saved before this plays as it did),
    // 'move:<relation>' a move from the chord in force, 'fn:T|S|D' a function, 'ctl:seventh'.
    targets: z.record(z.string(), z.string()).default({ ...DEFAULT_EXPRESSION_TARGETS }),
  })
  .default({
    sensitivity: { ...DEFAULT_EXPRESSION_SENSITIVITY },
    degrees: { ...DEFAULT_EXPRESSION_TO_DEGREE },
    targets: { ...DEFAULT_EXPRESSION_TARGETS },
  });
export type FaceExpr = z.infer<typeof FaceExprSchema>;

/** The shipped defaults for the expression mapping (research-grounded sensitivity
 *  + the hand-picked degree assignment — one diatonic degree per emotion). */
export const DEFAULT_FACE_EXPR: FaceExpr = {
  sensitivity: { ...DEFAULT_EXPRESSION_SENSITIVITY },
  degrees: { ...DEFAULT_EXPRESSION_TO_DEGREE },
  targets: { ...DEFAULT_EXPRESSION_TARGETS },
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
  /** Whether the master mute (M) silences the MIDI stream too (#168 Q3). On is what the
   *  instrument always did; off keeps the notes flowing to a DAW while the local monitor
   *  is quiet. `.default(true)` heals pre-dial presets to the behaviour they were played
   *  with (through the existing `midi` heal in the store; the store's v23 bump records it). */
  muteFollowsMaster: z.boolean().default(true),
});
export type MidiSettings = z.infer<typeof MidiSettingsSchema>;

/** The shipped MIDI defaults: off, first available port, the master mute silences MIDI too. */
export const DEFAULT_MIDI: MidiSettings = { enabled: false, port: '', muteFollowsMaster: true };

/** The hands source's reading (#148): how many frames a new Left/Right label is held
 *  before a field instrument's hand voice re-routes (the switch lands on the next frame).
 *  0 (the default) = the raw per-frame label, exactly what the instrument played before
 *  the dial existed; the Lab keeps its own dwell. Rides the instrument (a preset field):
 *  the trade-off is musical. */
export const HandsSettingsSchema = z.object({
  handednessDwell: z.number().int().min(0).max(MAX_HANDEDNESS_DWELL_FRAMES),
});
export type HandsSettings = z.infer<typeof HandsSettingsSchema>;
export const DEFAULT_HANDS: HandsSettings = { handednessDwell: DEFAULT_HANDEDNESS_DWELL_FRAMES };

/** The body source (#186): on/off + which PoseLandmarker model to load. `BODY_MODELS`
 *  is the node's own list (`@thoremin/sdk/nodes/domain`), re-exported so the panel reads one SSOT. */
export { BODY_MODELS };
export const BodySettingsSchema = z.object({
  enabled: z.boolean(),
  model: z.enum(BODY_MODELS),
});
export type BodySettings = z.infer<typeof BodySettingsSchema>;

/** The shipped body defaults: off (the model is the most expensive in the graph), lite. */
export const DEFAULT_BODY: BodySettings = { enabled: false, model: 'lite' };

/** The song's rate range: the native media element's quality range (research map §6.1),
 *  and the `song-player` node's default clamp. */
export const SONG_RATE_MIN = 0.5;
export const SONG_RATE_MAX = 2;
/**
 * The song the player dances to (#186 PR G): its level and the rate it plays at, pitch
 * preserved. A per-DEVICE tooling pref like `audioPrefs`, NOT a preset field: the song
 * plays under whatever instrument is loaded, so switching instrument must not change its
 * tempo, and moving its slider must not mark the instrument edited. Persisted through
 * the store's `partialize`; the palette and the assistant reach it through the
 * `song.volume.set` / `song.rate.set` commands. The song ITSELF (`songHandle`) and its
 * transport (`songPlaying`) are transient and never persisted.
 */
export const SONG_FOLLOW_RANGE_MIN = 0.02;
export const SONG_FOLLOW_RANGE_MAX = 0.3;
export const SONG_HOLD_FADE_MAX = 2;
/** The song beat the conductor may start on (#364): well past any intro. */
export const SONG_START_BEAT_MAX = 2000;
export const SongSettingsSchema = z.object({
  volume: z.number().min(0).max(1),
  rate: z.number().min(SONG_RATE_MIN).max(SONG_RATE_MAX),
  /** The song follows the dancer (#186 PR H): its tempo is pulled toward the dancer's
   *  pulse by the pace controller, around `rate`. Per device, like the rest: an
   *  instrument load must not change how the song follows. Off by default; turning it on
   *  starts the body camera while a song is loaded. */
  follow: z.boolean().default(false),
  /** How far from `rate` following may pull the song, a fraction (0.1 = +-10 %, the
   *  D-Jogger default; the native element sounds clean well past it). */
  followRange: z.number().min(SONG_FOLLOW_RANGE_MIN).max(SONG_FOLLOW_RANGE_MAX).default(0.1),
  /** Seconds the song fades out when the conductor holds it and back in on the release
   *  (#366). 0 = a cut, what every earlier version did (the default until the length is
   *  decided on #168). Per device like the rest; additive, so no store bump. */
  holdFadeS: z.number().min(0).max(SONG_HOLD_FADE_MAX).default(0),
  /** How far toward the slowest rate the song slows during that fade-out, a fraction, so
   *  the held note stretches instead of ending (#573). 0 = the rate holds, what every
   *  earlier version did (the default until ears decide it on #168). Needs `holdFadeS` > 0. */
  holdSlow: z.number().min(0).max(1).default(0),
  /** Following the dancer, a Play moves the song once so its beat lands on the dancer's cycle start, instead of
   *  closing the phase error through the rate nudge over several seconds (#346 item 1). A seek of at most
   *  half a beat in the song's first moments, so off by default until it has been heard (#168). Per device;
   *  additive. */
  alignStart: z.boolean().default(false),
});
export type SongSettings = z.infer<typeof SongSettingsSchema>;
export const DEFAULT_SONG: SongSettings = { volume: 0.8, rate: 1, follow: false, followRange: 0.1, holdFadeS: 0, holdSlow: 0, alignStart: false };
/**
 * The body conductor's per-device prefs (#427): the player's lead offset per joint,
 * learned against a click in the Conductor tool ("Learn my timing"). Per DEVICE like
 * {@link SongSettingsSchema}, not an instrument field: the lag is how this player's body
 * rides a stroke, the same under every instrument. Empty by default: no joint is
 * corrected, which is what every conductor played before.
 */
export const ConductorPrefsSchema = z.object({
  leadOffsets: LeadOffsetsSchema.default({}),
});
export type ConductorPrefs = z.infer<typeof ConductorPrefsSchema>;
export const DEFAULT_CONDUCTOR_PREFS: ConductorPrefs = { leadOffsets: {} };
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

// The default steering config is the `indirect-map` node's own (it lives beside
// `SteerConfigSchema`, below the settings, so `src/instruments/branches.ts` can name it
// without importing the settings, which fold the extension list in).
export { DEFAULT_STEER_CONFIG, defaultSteerConfig } from '@/nodes/mapping/indirect_map.schema';

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
/** The settings core owns: everything but the extensions' dials. */
export const CoreSettingsSchema = z.object({
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
  // The hands reading (#148). `.default(...)` keeps every earlier preset valid (dwell 0).
  hands: HandsSettingsSchema.default(DEFAULT_HANDS),
  // The body source (#186). `.default(...)` keeps pre-body presets valid (off, lite).
  body: BodySettingsSchema.default(DEFAULT_BODY),
  // The body→sound routing (#186 PR E): four route slots over the catalog. `.default`
  // keeps pre-routing presets valid (no routes = byte-identical sound).
  bodyMap: BodyMapSchema.default(() => structuredClone(DEFAULT_BODY_MAP)),
  // The generative layer (#141 / #188). `.default(...)` keeps pre-#188 presets valid (off).
  steer: SteerSettingsSchema.default(DEFAULT_STEER),
  // The head/face CONTROL axes (#76): per-axis gain / deadzone / zero / smoothing for
  // the `face-controls` node. The schema is the node's own params, imported rather
  // than restated (see FaceControlsDialSchema) so the two can never drift.
  // `.default(...)` keeps presets saved before #76's dials valid — they get the shipped
  // axis tuning, which is byte-identical to the build-time params they were played with.
  faceControls: FaceControlsDialSchema.default(DEFAULT_FACE_CONTROLS_DIAL),
  // The conductor (#187): the node's params lifted 1:1 as a structured dial, like
  // `faceControls`. `.default(...)` keeps pre-conductor presets valid (off).
  conductor: ConductorSettingsSchema.default(DEFAULT_CONDUCTOR),
});

/**
 * The whole settings: core's, extended with every listed extension's whole-object dials
 * (today the air instruments'). Each slice carries its own `.default(...)`, which keeps
 * older presets valid (off). Which keys exist is the build's extension list: a build
 * without `air` has no `airDrum`, in the schema and in the {@link Settings} type alike.
 */
// An extension dial must not shadow a core settings key (`extend` would silently replace it).
assertNoCoreClash('settings key', Object.keys(CoreSettingsSchema.shape), CONTRIBUTIONS.dialSlices.map((d) => d.key));
export const SettingsSchema = CoreSettingsSchema.extend(SETTINGS_SHAPE);
export type Settings = z.infer<typeof SettingsSchema>;
/** The settings core owns, as values. */
export type CoreSettings = z.infer<typeof CoreSettingsSchema>;
/** The settings the listed extensions own (`{ airDrum, airBass, ... }` in a build with `air`;
 *  `{}` in a build without extensions). Typed from the generated list declaration. */
export type ExtensionDials = Omit<Settings, keyof CoreSettings>;

/** The extensions' dial schemas by settings key (each with its `.default(...)`): what the hot
 *  store and the instruments heal an extension dial through, without naming one. */
export const EXTENSION_DIAL_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = SETTINGS_SHAPE;

/** The hot-store fields the listed extensions declare as transient (a learned model, a pattern
 *  in play): never persisted, never a preset field, `null` when absent. Typed from the
 *  manifests, so the hot store carries them without naming one. */
export type { ExtensionTransients };
/** Every extension transient field at its absent value (`null`). */
export function extensionTransientDefaults(): ExtensionTransients {
  return Object.fromEntries(CONTRIBUTIONS.transientFields.map((f) => [f, null])) as ExtensionTransients;
}

/** Fresh defaults of every extension dial: deep copies, so a store or a layer never shares
 *  a mutable sub-object with the default (the HandMap lesson). */
export function extensionDialDefaults(): ExtensionDials {
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(EXTENSION_DIAL_SCHEMAS)) out[key] = structuredClone(schema.parse(undefined));
  return out as ExtensionDials;
}

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
