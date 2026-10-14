/**
 * Zustand control store — the single source of truth for live UI controls.
 * The React control panel writes here; the `store-controls` DAG node reads
 * `getState()` each tick and emits the values onto the graph as port values.
 * This keeps UI state out of the graph spec, so changing scale/sound/overlay
 * never rebuilds the engine or reloads the ML model.
 *
 * The control *values* (not the setters) are persisted to localStorage via the
 * zustand `persist` middleware, so a player's choices survive a reload. In
 * non-browser environments (the Node test runtime) a no-op storage is used.
 *
 * This is the LIVE, synchronous hot layer (read every tick). Named *presets* are
 * a separate async persistence layer (src/settings) — load a preset by calling
 * `applySettings`, snapshot the current state with `toSettings`.
 */
import { create } from 'zustand';
import { provideControls } from '@thoremin/sdk-ui/host';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { ScaleTypeId } from '@thoremin/sdk/music/theory';
import { DEFAULT_SOUND_RIGHT, DEFAULT_SOUND_LEFT } from '@thoremin/sdk/music/sounds';
import { OverlayDialSchema, TrainerHudParamsSchema, type OverlayDialParams, type TrainerHudParams } from '@/nodes/output/canvas_overlay';
import { FeatureLabSchema, defaultFeatureLab, type FeatureLabConfig } from '@/features/labConfig';
import { GesturePrefsSchema, defaultGesturePrefs, type GesturePrefs } from './gesturePrefs';
import { FACE_MAPPINGS, legacyFaceToMapping, type VoiceParams, type FaceMapping } from '@/nodes';
import {
  DEFAULT_FACE_CHORD,
  DEFAULT_FACE_EXPR,
  DEFAULT_MIDI,
  DEFAULT_HANDS,
  HandsSettingsSchema,
  type HandsSettings,
  DEFAULT_BODY,
  BodySettingsSchema,
  type BodySettings,
  DEFAULT_STEER,
  defaultSteerConfig,
  FaceChordSchema,
  FaceExprSchema,
  HandMapSchema,
  MidiSettingsSchema,
  SteerSettingsSchema,
  SettingsSchema,
  type Settings,
  type FaceChord,
  type FaceExpr,
  type MidiSettings,
  type SteerSettings,
  SongSettingsSchema,
  DEFAULT_SONG,
  type SongSettings,
} from '@/settings/schema';
import { BodyMapSchema, DEFAULT_BODY_MAP, type BodyMap } from '@/nodes/mapping/body_map';
import { DEFAULT_HAND_MAP, type HandMap } from '@/nodes/mapping/hand_map';
import {
  FaceControlsDialSchema,
  DEFAULT_FACE_CONTROLS_DIAL,
  type FaceControlsDialParams,
} from '@/nodes/features/face_controls';
import { ConductorSettingsSchema, DEFAULT_CONDUCTOR, LEGACY_CONDUCTOR_PRIOR, type ConductorSettings, EXTENSION_DIAL_SCHEMAS, extensionDialDefaults, extensionTransientDefaults, type ExtensionDials, type ExtensionTransients } from '@/settings/schema';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import type { SongHandle } from '@/nodes/output/song_player';
import { AudioPrefsSchema, DEFAULT_AUDIO_PREFS, type AudioPrefs } from './timing/audioPrefs';

/** A fresh deep copy of the default hand map (nested fingers/routes), so the store's
 *  initializer and healers never share mutable sub-objects with the constant. */
const defaultHandMap = (): HandMap => structuredClone(DEFAULT_HAND_MAP);

/** A fresh copy of the shipped face-control axis tuning (#76), for the same reason as
 *  {@link defaultHandMap}: the initializer and the healers must never hand out the
 *  module-level constant itself, or an edit in one instrument would mutate the default. */
const defaultFaceControls = (): FaceControlsDialParams => ({ ...DEFAULT_FACE_CONTROLS_DIAL });
/** A fresh generative-layer default (the `config` object is cloned for the same reason). */
const defaultSteer = (): SteerSettings => ({ ...DEFAULT_STEER, config: structuredClone(DEFAULT_STEER.config) });
/** A fresh copy of the shipped conductor dial (#187): off. */
const defaultConductor = (): ConductorSettings => ({ ...DEFAULT_CONDUCTOR });

/** The preset keys (derived from the schema — the SSOT). Add a field to
 *  SettingsSchema (+ the store) and it is snapshotted, persisted, and restored
 *  automatically: no hand-edits to toSettings / applySettings / partialize. */
const SETTINGS_KEYS = Object.keys(SettingsSchema.shape) as (keyof Settings)[];

export interface VoiceControl {
  root: number; // 0..11
  type: ScaleTypeId;
  octaves: number;
  baseOctave: number;
  sound: VoiceParams['sound'];
  /** #63 octave RANGE — fractional octaves below/above the locked middle octave
   *  (`baseOctave`), each 0..1, so the playable span is 1..3 octaves. Present on new/
   *  edited voices (the double-thumb slider writes them, and keeps `octaves` synced as
   *  their integer shadow); absent on a returning pre-#63 voice → the legacy `octaves`
   *  scale path (identical sound). See {@link generateScale}. */
  rangeLow?: number;
  rangeHigh?: number;
}

/**
 * The live controls. The extensions' whole-object dials (`airDrum`, `airBass`, … in a build
 * with the air extension) are fields too, typed from the manifests ({@link ExtensionDials}),
 * defaulted, healed and persisted by folds over their slices: preset fields, fed live to
 * each extension node's `config` port through `store-controls`.
 */
export interface ControlState extends ExtensionDials, ExtensionTransients {
  right: VoiceControl;
  left: VoiceControl;
  syncHands: boolean;
  masterVolume: number; // 0..1
  /** Global octave transpose (−2..+2) applied to every voice + chord + overlay.
   *  Keyboard-driven (#90) but written via the dial command path (`dial.set`/
   *  `dial.patch`); read each tick by the mapping/chord/overlay nodes through
   *  `store-controls`. A preset field (in {@link SETTINGS_KEYS}). */
  octaveShift: number;
  /** Scale-snap magnetism (0 = free pitch … 1 = full snap). Keyboard-driven (#90)
   *  via commands; read by `voice-mapping` through `store-controls`. Preset field. */
  magnetism: number;
  /**
   * Master mute. When true the whole instrument is silent (hands AND both face-
   * chord instruments). Since #90 this is the SSOT for mute: the `m` key (via the
   * app-level keyboard handler) toggles it, and it flows OUT to the graph through
   * `store-controls` (→ voice-mapping + synth-merge), to the host master gain
   * (`useEngine`), and to the HUD cue (MutedBadge) — no more graph→store mirror.
   * Deliberately NOT persisted (not a musical preset, not in {@link SETTINGS_KEYS}
   * nor `partialize`), so a fresh reload always starts un-muted (unlike
   * `octaveShift`/`magnetism`, which are preset fields and DO persist).
   */
  muted: boolean;
  /**
   * Who is holding the instrument QUIET right now: tool surfaces that need the room
   * (the Trainer, whose click and spoken cues the theremin drowned out). Each entry
   * is a claimer id; the instrument is hushed while any claim is held and sounds
   * again the moment the last one is released, so "restore after" needs no memory of
   * what was playing. Distinct from {@link muted}: that is the PLAYER's switch (and
   * its badge says "press M"); a hush is the app's, and releasing it must never
   * unmute a player who had muted on purpose. The conductor does not claim here — its
   * hush is derived from `conductor.enabled` in `store-controls`, so it cannot leak.
   * Transient, like `muted`: never persisted.
   */
  hushedBy: readonly string[];
  /**
   * What the player's facial expression maps to: `none` (off, default), `timbre`
   * (smile→brightness, open mouth→vibrato), or `chord` (expression selects a
   * diatonic triad). Any non-`none` mode lazy-loads the `webcam-face` model — as does
   * the Feature Lab when it measures face groups (#136), so this is no longer the only
   * switch on the model. Read by the nodes each tick via `ctx.resources.controls`.
   */
  faceMapping: FaceMapping;
  /** How the face chord sounds (sound / volume / voicing / rendering / tempo).
   *  Read live by `expression-chord` via the `chordConfig` port. */
  faceChord: FaceChord;
  /** The expression-mapping config: per-emotion firing sensitivity (read live by
   *  `face-expression`) + per-expression scale-degree map (read live by
   *  `expression-chord`). */
  faceExpr: FaceExpr;
  /** Composable overlay element config (see canvas_overlay.ts). Live-controlled.
   *  This is the DIAL-facing overlay — the Feature Lab is deliberately not in it
   *  (see {@link featureLab}). */
  overlay: OverlayDialParams;
  /**
   * Feature Instrumentation Lab config (#119): which feature groups are measured,
   * how they are normalized, the derived formulas.
   *
   * A TOOLING preference, not an instrument parameter — like {@link faceCalibration},
   * it is persisted per-device but is NOT a preset field, so it never rides an
   * instrument. Before #136 it lived inside the `overlay` dial, which meant opening a
   * measuring tool marked the instrument dirty and loading an instrument silently
   * reconfigured the meters. `store-controls` composes it into the overlay node's
   * params each tick, and `webcam-face` reads it to decide whether the face model is
   * wanted (so you can measure the face without the face driving the sound).
   */
  featureLab: FeatureLabConfig;
  /** The hand→sound mapping: note source (index/wrist), finger→effect routing, and
   *  the once-static voice knobs. Read live by `voice-mapping` via
   *  `ctx.resources.controls`. See src/nodes/mapping/hand_map.ts. */
  handMap: HandMap;
  /** MIDI output (#137): on/off + target port ('' = first available). A preset
   *  field (in {@link SETTINGS_KEYS}); read live by the `midi-out` node via
   *  `store-controls` → its `enabled`/`port` inputs. */
  midi: MidiSettings;
  /** The hands reading (#148): the handedness dwell `hand-features` applies (0 = raw
   *  label). A preset field (in {@link SETTINGS_KEYS}); read live by `hand-features` via
   *  `store-controls` → its `handednessDwell` input. */
  hands: HandsSettings;
  /** The body source (#186): on/off + model. A preset field; read live by `webcam-body`
   *  through `ctx.resources.controls` (its gate, like the face's `faceMapping`). */
  body: BodySettings;
  /** The body→sound routing (#186 PR E). A preset field; flows to `body-route` through
   *  `store-controls` as the `bodyMap` port, so a route edit is live without a rebuild. */
  bodyMap: BodyMap;
  /** The song's level and rate, and whether it follows the dancer (#186 PR G, H): a per-DEVICE tooling pref like
   *  {@link audioPrefs}, persisted via `partialize`, NOT a preset field (the song plays
   *  under any instrument; loading one must not change its tempo). Flows to
   *  `song-player`'s `volume` / `rate` inputs through `store-controls`. */
  songPrefs: SongSettings;
  /**
   * The loaded song (#186 PR G, research map §9.5): the stable {@link SongHandle} the
   * Song tool writes after decoding a file and tracking its beats. TRANSIENT, like
   * {@link scoreDoc}: never persisted (its object URL dies with the page, and a beat grid
   * has no place in a saved instrument). `store-controls` emits the SAME object every
   * tick until another song loads, so `song-player` detects a new song by identity.
   */
  songHandle: SongHandle | null;
  /** The song's TRANSPORT, transient like {@link steerPlaying}: a saved instrument must
   *  never start playing on load. Written by the `song.play` / `song.pause` commands
   *  (through the song host), and back to false when the song plays to its end. */
  songPlaying: boolean;
  /** How many times Play was pressed (#344), transient with {@link songPlaying}: the
   *  `song-player` reads a change as a press even when the level never fell (a Play made
   *  in the frame the song ended, before the player saw the transport go off). */
  songPlays: number;
  /** The generative layer (#141 / #188): on/off, level, and what the gestures mean
   *  (`config`). A preset field (in {@link SETTINGS_KEYS}); read live by `indirect-map`
   *  / `lyria` via `store-controls` → their `steerConfig` / `enabled` / `volume` inputs. */
  steer: SteerSettings;
  /**
   * The generative TRANSPORT: is the engine streaming right now. Like {@link muted},
   * deliberately NOT a dial and NOT persisted: a dial rides saved instruments, and an
   * instrument saved while playing would start a paid cloud stream on load and flip
   * dirty on every play/pause. Toggled directly by the Generative panel's button (the
   * `m`-key precedent, #91); flows to the `lyria` node's `playing` input through
   * `store-controls`. Always false after a reload.
   */
  steerPlaying: boolean;
  /**
   * The head/face CONTROL axis tuning (#76): per-axis gain (negative flips a
   * direction), deadzone, neutral zero and shared smoothing for the `face-controls`
   * node. A preset field (in {@link SETTINGS_KEYS}) — unlike {@link faceCalibration},
   * which is a per-DEVICE property, an axis tuning is part of how an instrument plays,
   * so it rides the instrument. Read live by `face-controls` via `store-controls` →
   * its `config` input port, so a change takes effect on the next tick without a graph
   * rebuild or a face-model reload.
   */
  faceControls: FaceControlsDialParams;
  /** The conductor dial (#187): on/off, hand, point, servo horizon, fallback and
   *  dynamics ranges. A preset field, fed live to the `conductor` node's `config` port
   *  through store-controls, so conducting starts with no rebuild. */
  conductor: ConductorSettings;
  /**
   * The loaded score (#187 PR 3): the `ScoreDoc` the `score` node plays, handed to the
   * graph through `store-controls` as the live `scoreDoc` port. TRANSIENT, like
   * {@link muted}: never persisted (a parsed movement is hundreds of kilobytes; the
   * `conductor.piece` dial remembers WHICH piece, and the app reloads it on demand).
   */
  scoreDoc: ScoreDoc | null;
  /**
   * The overlay elements the CURRENT graph's branches asked for (transient, never
   * persisted): written by the engine host just before it applies a composed graph,
   * emitted by `store-controls` on its `graphElements` port, read by `canvas-overlay`,
   * which draws only these (and only those whose own `show` dial is on). `null` until the
   * first composition, which the overlay reads as "draw everything" (the pre-ADR behaviour,
   * and what headless tests without a host see).
   */
  graphElements: string[] | null;
  /** Per-DEVICE expression calibration: a per-emotion firing-sensitivity override
   *  produced by the calibration wizard, applied OVER `faceExpr.sensitivity` for every
   *  instrument (so calibration is global). Persisted to localStorage, NOT part of a
   *  preset — it is a device property, not a musical parameter. Null = uncalibrated. */
  faceCalibration: Record<string, number> | null;
  /**
   * Gesture dispatch config (#129): enable flag, hold/cooldown timing, and the
   * gesture → command binding map. A TOOLING preference like {@link featureLab} —
   * persisted per-device via `partialize`, NOT a preset field and NOT a dial:
   * gestures bind to commands the way the keyboard does, and keybindings are not
   * instrument state (loading an instrument must never rebind your hands). Read
   * each frame by the app-level gesture dispatcher (`gestureDispatch.ts`) and
   * edited from the Gestures shell tool.
   */
  gestures: GesturePrefs;
  /**
   * The trainer's on-video guidance HUD (#163): shown, and on which edge. A per-DEVICE
   * tooling pref like {@link featureLab} — the trainer is a shell tool, so hiding its
   * banner must not mark the instrument edited nor flip when an instrument loads.
   * `store-controls` composes it into the overlay node's params each tick.
   */
  trainerHud: TrainerHudParams;
  /** The per-device audio pref (#240): `lowLatency` asks for `latencyHint: 0` when the
   *  audio context is created (the first tap). Persisted with the tooling prefs, not a
   *  preset field: the hint belongs to the machine's audio device, not an instrument. */
  audioPrefs: AudioPrefs;
  setVoice(side: 'right' | 'left', patch: Partial<VoiceControl>): void;
  setSync(v: boolean): void;
  setMasterVolume(v: number): void;
  /** Set the master mute directly. */
  setMuted(v: boolean): void;
  /** Toggle the master mute — the `m` key (app-level keyboard handler, #90) calls this. */
  toggleMuted(): void;
  /** Take (`on`) or release a hush claim (see {@link hushedBy}). Idempotent per claimer. */
  setHush(claimer: string, on: boolean): void;
  /** Replace the loaded song (transient, see {@link songHandle}); releases the previous
   *  song's object URL and stops the transport. */
  setSongHandle(song: SongHandle | null): void;
  /** Start or stop the song (transient, see {@link songPlaying}); a start also counts a
   *  press ({@link songPlays}). */
  setSongPlaying(v: boolean): void;
  /** Patch the song's level / rate (see {@link songPrefs}); an out-of-range value is
   *  clamped by the schema's bounds, an invalid one ignored. */
  setSongPrefs(patch: Partial<SongSettings>): void;
  /** Replace the loaded score (transient, see {@link scoreDoc}). */
  setScoreDoc: (doc: ScoreDoc | null) => void;
  /** Replace the composed graph's overlay element set (transient, see {@link graphElements}). */
  setGraphElements: (elements: string[] | null) => void;

  /** Replace an extension's transient field (a learned model, a pattern in play; see
   *  {@link ExtensionTransients}): never persisted, re-derived by the extension on load. */
  setTransient<K extends keyof ExtensionTransients & string>(field: K, value: ExtensionTransients[K]): void;
  /** Set / toggle the generative transport (transient, see {@link steerPlaying}). */
  setSteerPlaying(v: boolean): void;
  toggleSteerPlaying(): void;
  setFaceMapping(v: FaceMapping): void;
  /** Patch the face-chord settings (e.g. setFaceChord({ voicing: 'spread' })). */
  setFaceChord(patch: Partial<FaceChord>): void;
  /** Set one emotion's firing sensitivity [0,1] (higher = more hits). */
  setExpressionSensitivity(emotion: string, value: number): void;
  /** Set the scale degree (0..6) an expression maps to. */
  setExpressionDegree(expr: string, degree: number): void;
  /** Patch one overlay element's options (e.g. setOverlayElement('indexGuide', { show: true })). */
  setOverlayElement<K extends keyof OverlayDialParams>(key: K, patch: Partial<OverlayDialParams[K]>): void;
  /** Patch the Feature Lab config (e.g. setFeatureLab({ show: true })). */
  setFeatureLab(patch: Partial<FeatureLabConfig>): void;
  /** Shallow-patch the hand map (e.g. setHandMap({ positionSource: 'wrist' }), or a new
   *  `fingers` object for a route change). */
  setHandMap(patch: Partial<HandMap>): void;
  /** Store (or clear, with null) the per-device expression calibration. */
  setFaceCalibration(map: Record<string, number> | null): void;
  /** Shallow-patch the gesture-dispatch prefs (e.g. setGestures({ enabled: true }),
   *  or a whole new `bindings` record for a binding change). */
  setGestures(patch: Partial<GesturePrefs>): void;
  /** Shallow-patch the trainer HUD pref (e.g. setTrainerHud({ show: false })). */
  setTrainerHud(patch: Partial<TrainerHudParams>): void;
  /** Shallow-patch the per-device audio pref (#240; e.g. setAudioPrefs({ lowLatency: true })). */
  setAudioPrefs(patch: Partial<AudioPrefs>): void;
  /** Replace all live controls from a settings snapshot (loading a preset). */
  applySettings(s: Settings): void;
}

const defaultVoice = (sound: VoiceParams['sound']): VoiceControl => ({
  root: 0,
  // Pentatonic by default: every snapped note sounds consonant, so the
  // sound is forgiving and musical out of the box.
  type: 'pentatonic',
  octaves: 2,
  baseOctave: 3,
  sound,
  // #63: the middle octave plus a full octave above (== octaves: 2, today's default),
  // so a fresh install sounds identical while using the range representation.
  rangeLow: 0,
  rangeHigh: 1,
});

/** The overlay element defaults (all on except the opt-in index-finger guide). */
const defaultOverlay = (): OverlayDialParams => OverlayDialSchema.parse({});

/** Pick exactly the preset fields ({@link SETTINGS_KEYS}) from a state-like object. */
function pickSettings(s: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) out[k] = s[k];
  return out as unknown as Settings;
}

/** Snapshot the persistable settings from the live state (for saving a preset). */
export function toSettings(s: ControlState): Settings {
  return pickSettings(s as unknown as Record<string, unknown>);
}

/** A copy of a settings sub-object with its legacy `instrument` timbre field renamed to
 *  `sound`, so a returning player keeps their selection after the rename. A copy, never an
 *  edit: the object belongs to the caller's persisted blob. */
function migrateInstrumentField(o: Record<string, unknown>): Record<string, unknown> {
  const { instrument, ...rest } = o;
  return instrument !== undefined && rest.sound === undefined ? { ...rest, sound: instrument } : rest;
}

/** The MIDI block healed field by field against its schema: a field that parses is kept,
 *  one that is absent or corrupt takes `fallback`'s value (the shipped default on a first
 *  load). Never throws, never undefined. */
function healMidi(stored: unknown, fallback: MidiSettings): MidiSettings {
  const raw = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_MIDI, ...fallback };
  for (const [key, field] of Object.entries(MidiSettingsSchema.shape)) {
    if (!(key in raw)) continue;
    const r = field.safeParse(raw[key]);
    if (r.success) out[key] = r.data;
  }
  return out as MidiSettings;
}

/**
 * One step of the persist migration: a blob written at version `n` becomes a version `n + 1`
 * blob. A step returns a NEW blob and never edits its argument or anything nested in it: the
 * blob belongs to the caller (zustand's rehydrated value), and `migrateControls` is tested
 * directly for exactly that (test/store_migrate_no_mutation.test.ts).
 */
type ControlsMigration = (s: Record<string, unknown>) => Record<string, unknown>;

/**
 * The persist version this build writes, and its history. Only some versions carry a data
 * transform (they are the steps in {@link CONTROLS_MIGRATIONS}, which repeat the reason
 * beside the code); the rest are ADDITIVE schema growth that {@link mergeControls} heals
 * (a field an older blob lacks takes its default), so the bump is only the version marker.
 *
 * - v2 (#64): the face-mapping chooser replaced the boolean `faceEnabled` with the
 *   tri-state `faceMapping`. Step.
 * - v3: the per-hand / chord timbre field was renamed `instrument` → `sound`. Step.
 * - v4: added the `handMap`.
 * - v5: the abstention retune raised the fearful/disgusted sensitivity default 0.5 → 0.7,
 *   delivered to a returning player who never customized it. Step.
 * - v6: #75 (decoupled chord-source scale — faceChord.chordSource/chordRoot/chordType) +
 *   #63 (per-voice octave RANGE — right/left.rangeLow/rangeHigh). Both ADDITIVE with
 *   defaults: mergeControls re-parses faceChord through FaceChordSchema (filling
 *   chordSource='auto' etc. for returning users → identical sound on their seven-note
 *   melodies), and the range fields are optional (absent → the legacy `octaves` scale path,
 *   byte-identical).
 * - v7 (#136): the Feature Lab moved out of the `overlay` dial onto its own per-device
 *   `featureLab` field (a tooling pref, like `faceCalibration`). Step.
 * - v8 (#137): the `midi` preset field (enabled/port), default off / first available port.
 * - v9 (#129): the `gestures` per-device tooling pref (enable flag, hold/cooldown timing,
 *   gesture → command bindings), defaults disabled; fist → silence, pinch → restore
 *   volume, open unbound.
 * - v10 (#76): the `faceControls` preset field (per-axis gain / deadzone / neutral zero /
 *   smoothing for the head-pose control mode). Its default is the shipped tuning, which is
 *   byte-identical to the build-time params the node used before the dial existed, so a
 *   returning player's `controls` mode sounds and feels exactly as it did.
 * - v11 (#188): the `steer` preset field (the generative layer: enabled / volume /
 *   config), default off. The transport (`steerPlaying`) is transient and not persisted,
 *   like `muted`.
 * - v12 (#187): the `conductor` preset field (the conductor node's params: off by default,
 *   hand/point, servo horizon, fallback + dynamics ranges).
 * - v13 (#186): `body` + `bodyMap` (a pre-#186 blob reads as off / no routes).
 * - v14 (#233): `airDrum` (the air-drum node's params, off by default).
 * - v15 (#249): `airBass`, the same way. v16: `airGuitar`. v17: `airFlute`.
 * - v18: the trainer HUD pref's default flipped to off (the Trainer's banner is the
 *   on-screen instruction now). Step.
 * - v19 (#263): `airFlute.prior` (the fingering-chart prior: on, the flute chart, strength
 *   10, C4..C#6).
 * - v20 (#269): `airDrum.pattern` (the trained pattern in play, '' for none).
 * - v21 (#232): the conductor dial gained `prior`; a returning player's conductor stays on
 *   the oscillator (LEGACY_CONDUCTOR_PRIOR). Step.
 * - v22 (#148): `hands` (the handedness dwell, default 0 = the raw per-frame label every
 *   earlier blob played by); healed after the v21 step runs.
 * - v23 (#168 Q3): `midi.muteFollowsMaster` (default true = the master mute silences MIDI,
 *   as every earlier blob played), healed field by field by healMidi.
 * - v24 (#240): `audioPrefs`, a per-device tooling pref (not a preset field): `lowLatency`,
 *   default off = the `interactive` hint every earlier blob ran with.
 *   Then, WITHOUT a bump (#336, #187 PR 5): `conductor.orchestra` (the sampled orchestra:
 *   on/off, overall and per-section level), default DEFAULT_ORCHESTRA. ADDITIVE and nested
 *   in the conductor dial, so the conductor heal (the schema parse over the current
 *   conductor) fills it for any earlier blob; no transform was ever needed, and this line
 *   is its history entry. A later bump is not owed for it.
 * - v25 (#186 PR G): `songPrefs`, a per-device tooling pref (not a preset field): the
 *   song's level and rate, defaults 0.8 / 1. The song itself and its transport are
 *   transient and never persisted.
 * - v26 (#186 PR H): `songPrefs` gained `follow` (default off: the song plays at its own
 *   tempo, as every earlier blob did) and `followRange` (0.1), healed over DEFAULT_SONG.
 *   Then, WITHOUT a bump (#375): `conductor.source` (`hands`) and `conductor.bodyPoint`
 *   (`impact`), additive in the conductor dial like `conductor.orchestra`; `hands` is what
 *   every earlier blob conducted with, so the conductor heal fills both and no transform
 *   is owed. And, WITHOUT a bump (#376): `conductor.markLevel` (`beat`), additive in the
 *   same way; `beat` is what every earlier blob marked. And, WITHOUT a bump (#377):
 *   `conductor.transport` (the body's start / hold / stop rules, `rules` on), additive and
 *   nested like `conductor.orchestra`; it acts only while the source is `body` (#375, the
 *   day before), so no earlier blob's hand conductor changes and no transform is owed.
 *
 * Bump this and, if the change needs a transform, add `CONTROLS_MIGRATIONS[old]` together.
 */
const CONTROLS_VERSION = 26;

/**
 * The persist migration steps, keyed by the version they READ (like
 * `CATEGORIZER_MIGRATIONS`): `CONTROLS_MIGRATIONS[n]` takes a version-n blob to n + 1. A
 * version with no entry needs no transform (see {@link CONTROLS_VERSION}'s history).
 */
const CONTROLS_MIGRATIONS: Readonly<Record<number, ControlsMigration>> = {
  // → v2 (#64): `faceEnabled` (boolean) → `faceMapping` (tri-state); an explicit
  // `faceMapping` wins over the legacy flag.
  1: ({ faceEnabled, ...rest }) =>
    rest.faceMapping === undefined ? { ...rest, faceMapping: legacyFaceToMapping(faceEnabled as boolean | undefined) } : rest,
  // → v3: the timbre field `instrument` → `sound`, so a returning player keeps their sound.
  2: (s) => {
    const out = { ...s };
    for (const key of ['right', 'left', 'faceChord'] as const) {
      const sub = s[key];
      if (sub && typeof sub === 'object') out[key] = migrateInstrumentField(sub as Record<string, unknown>);
    }
    return out;
  },
  // → v5: the abstention retune raised the fearful/disgusted firing default 0.5 → 0.7.
  // Deliver it to a returning player who never customized those two (persisted value
  // still === the OLD default), while preserving any value they DID set.
  4: (s) => {
    const fe = s.faceExpr as { sensitivity?: Record<string, number> } | undefined;
    if (!fe?.sensitivity) return s;
    const sensitivity = { ...fe.sensitivity };
    for (const e of ['fearful', 'disgusted'] as const) {
      if (sensitivity[e] === 0.5) sensitivity[e] = 0.7;
    }
    return { ...s, faceExpr: { ...fe, sensitivity } };
  },
  // → v7 (#136): the Feature Lab moved OUT of the `overlay` dial (an instrument parameter)
  // and onto its own per-device tooling field. Carry a returning player's lab config across
  // rather than dropping it on the floor: `overlay` is re-parsed through the lab-free
  // OverlayDialSchema in mergeControls, which would strip it silently (and drop the key
  // anyway; removing it here keeps the directly-tested migrate honest).
  6: (s) => {
    const ov = s.overlay as Record<string, unknown> | undefined;
    if (ov?.featureLab === undefined) return s;
    const { featureLab: lifted, ...overlay } = ov;
    return { ...s, featureLab: s.featureLab === undefined ? lifted : s.featureLab, overlay };
  },
  // → v18: the Trainer's running banner moved above every panel (it is now the on-screen
  // instruction), so painting the same words into the video is opt-in. A returning
  // player's persisted `show: true` is the OLD default, not a choice (nothing ever asked),
  // so it follows the new default once; re-ticking it in the panel sticks.
  17: (s) => {
    const hud = s.trainerHud as Record<string, unknown> | undefined;
    return hud && hud.show === true ? { ...s, trainerHud: { ...hud, show: false } } : s;
  },
  // → v21 (#232): the conductor dial gained `prior`, whose default (`blend`) is a behaviour
  // change. A returning player's conductor was the oscillator; it stays so (as a saved
  // instrument's does in `normalizeLayer`), and the panel's chooser is how they move.
  20: (s) => {
    const cond = s.conductor as Record<string, unknown> | undefined;
    return cond && typeof cond === 'object' && cond.prior === undefined ? { ...s, conductor: { ...cond, prior: LEGACY_CONDUCTOR_PRIOR } } : s;
  },
};

/** The steps as `[readVersion, step]`, oldest first: the order a chain must run in. */
const MIGRATION_CHAIN = Object.entries(CONTROLS_MIGRATIONS)
  .map(([from, step]) => [Number(from), step] as const)
  .sort((a, b) => a[0] - b[0]);

/**
 * Persist migration: run every step whose target version (`from + 1`) is above the blob's
 * (a version-`version` blob needs each step that produces a later version), oldest first.
 * Written as `version < from + 1`, not `version <= from`, so a non-integer version (1.5)
 * runs the same steps the original `version < n` chain did. The result is a new object
 * even when no step runs; the caller's blob is never edited. Exported for direct testing.
 */
export function migrateControls(persisted: unknown, version: number): ControlState {
  let s = { ...(persisted as Record<string, unknown>) };
  for (const [from, step] of MIGRATION_CHAIN) if (version < from + 1) s = step(s);
  return s as unknown as ControlState;
}

/**
 * How one whole-object field of a rehydrated blob is healed: re-parsed through `schema`,
 * after `complete` (when given) builds the parse input from the stored value (filling what
 * an older blob lacks), and `finish` (when given) post-processes the parse. Typed per field,
 * so a schema whose output is not that field's type fails the typecheck.
 */
interface HealRule<T> {
  schema: { parse(input: unknown): T };
  complete?: (stored: unknown, current: T) => unknown;
  finish?: (parsed: T) => T;
}

/**
 * Heal one stored field: a falsy stored value (absent from an older blob) keeps `current`;
 * otherwise the rule's parse, and anything that throws on the way (a corrupt blob) falls
 * back to `current` whole, so a newer reader never binds a control to undefined.
 */
function heal<T>(stored: unknown, current: T, rule: HealRule<T>): T {
  if (!stored) return current;
  try {
    const parsed = rule.schema.parse(rule.complete ? rule.complete(stored, current) : stored);
    return rule.finish ? rule.finish(parsed) : parsed;
  } catch {
    return current;
  }
}

/** Complete a partial stored object from a shipped default before the parse. Generic in the
 *  field's type, so a rule pointed at another field's default fails the typecheck. */
const overDefaults =
  <T>(defaults: T) =>
  (stored: unknown, _current: T): unknown => ({ ...defaults, ...(stored as object) });

/** Complete a partial stored object from the current (initializer) value before the parse. */
const overCurrent = (stored: unknown, current: unknown): unknown => ({ ...(current as object), ...(stored as object) });

/**
 * The core fields {@link mergeControls} heals, one rule each. Three completions are in use
 * and they are NOT interchangeable: a raw parse (the schema's own `.default`s complete a
 * partial blob), the shipped default spread under the blob, or the current value spread
 * under it. On a real rehydrate `current` is the initializer, which equals the defaults; the
 * difference shows only when `mergeControls` is called with some other `current`, and each
 * rule keeps the completion its field has always had.
 */
type CoreHealRules = { [K in keyof ControlState]?: HealRule<ControlState[K]> };
export const HEAL_RULES: CoreHealRules = {
  // Fills defaults for overlay elements added since the blob was written (e.g. `chordGuide`
  // in #64, whose absence would otherwise throw in `overlay.chordGuide.show`).
  overlay: { schema: OverlayDialSchema },
  // An older blob has no lab config → the default meters.
  featureLab: { schema: FeatureLabSchema },
  // The trainer HUD pref (#163).
  trainerHud: { schema: TrainerHudParamsSchema },
  // Completed from the defaults, then validated, so a UI control never binds to an
  // undefined/corrupt field (parity with overlay).
  faceChord: { schema: FaceChordSchema, complete: overDefaults(DEFAULT_FACE_CHORD) },
  // The sensitivity/degrees maps are filled from the defaults key by key, so a returning
  // user's older blob can't leave an emotion's slider unbound.
  faceExpr: {
    schema: FaceExprSchema,
    complete: (stored) => {
      const pe = stored as Partial<FaceExpr>;
      return {
        sensitivity: { ...DEFAULT_FACE_EXPR.sensitivity, ...(pe.sensitivity ?? {}) },
        degrees: { ...DEFAULT_FACE_EXPR.degrees, ...(pe.degrees ?? {}) },
      };
    },
  },
  // Older blobs lack it entirely → the default index-source, no-routing map, so a returning
  // user can never leave a finger route or knob unbound.
  handMap: { schema: HandMapSchema },
  // The hands reading (#148): a pre-#148 blob has none → dwell 0 (the raw label).
  hands: { schema: HandsSettingsSchema, complete: overDefaults(DEFAULT_HANDS) },
  // The body settings (#186): a pre-body blob has none → off, lite.
  body: { schema: BodySettingsSchema, complete: overDefaults(DEFAULT_BODY) },
  // The per-device song pref (#186 PR G): a pre-song blob has none → the defaults.
  songPrefs: { schema: SongSettingsSchema, complete: overDefaults(DEFAULT_SONG) },
  // The body map (#186): a pre-routing blob has none → no routes.
  bodyMap: { schema: BodyMapSchema },
  // The generative layer (#188): a pre-#188 blob has none → off / 0.7 / starter strains; a
  // partial one is completed; a corrupt one falls back whole.
  steer: {
    schema: SteerSettingsSchema,
    complete: overDefaults(DEFAULT_STEER),
    // A PARTIAL config (the shape #202 persisted: smoothing + cadence, no arrays) is
    // completed from the default. Absent arrays already meant "the starter strains" to the
    // node, so this is sound-identical; it exists so the working layer and a saved
    // instrument (which `normalizeLayer` completes the same way) can never differ by a key
    // nobody edited and flag a phantom "unsaved edits".
    finish: (parsed) => ({ ...parsed, config: { ...defaultSteerConfig(), ...parsed.config } }),
  },
  // The face-control axes (#76): a pre-#76-dials blob has none → the shipped tuning; a
  // partial one is completed; a corrupt one falls back whole rather than leaving the panel to
  // dereference an undefined into a NaN slider.
  //
  // Parsed RAW, unlike the `faceChord` rule above which pre-spreads its defaults. That is not
  // an inconsistency to tidy up later: EVERY field of this schema carries a `.default(...)`,
  // so `parse` already completes a partial blob, and the spread would be dead code that a
  // reader would mistake for load-bearing. The invariant it relies on is enforced at import
  // time, not by convention — `DEFAULT_FACE_CONTROLS_DIAL` is built by
  // `FaceControlsDialSchema.parse({})`, which throws on the day someone adds a field without
  // a default. (A mutation test caught the spread: removing it left the suite fully green,
  // which is the definition of a guard that guards nothing.)
  faceControls: { schema: FaceControlsDialSchema },
  // The conductor dial (#187): a pre-conductor blob has none → off; completed over the
  // current value (which is how `conductor.orchestra`, #336, reaches an older blob).
  conductor: { schema: ConductorSettingsSchema, complete: overCurrent },
  // The gesture prefs (#129), completed over the current (default) prefs. The blob's
  // `bindings` record replaces the default wholesale (an unbound-by-the-user gesture must
  // STAY unbound, not be re-seeded every load).
  gestures: { schema: GesturePrefsSchema, complete: overCurrent },
  // The per-device audio pref (#240): a pre-#240 blob has none → the default hint.
  audioPrefs: { schema: AudioPrefsSchema, complete: overCurrent },
};

/** The extensions' whole-object dials (the air instruments' today), each healed through its
 *  own slice schema over the current value, like the conductor. */
const EXTENSION_HEAL_RULES: Readonly<Record<string, HealRule<unknown>>> = Object.fromEntries(
  Object.entries(EXTENSION_DIAL_SCHEMAS).map(([key, schema]) => [key, { schema, complete: overCurrent }]),
);

/** Every rule of `rules` applied to `stored` over `current`: the healed fields only. */
function healAll(stored: Record<string, unknown>, current: Record<string, unknown>, rules: Readonly<Record<string, HealRule<unknown> | undefined>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, rule] of Object.entries(rules)) if (rule) out[field] = heal(stored[field], current[field], rule);
  return out;
}

/**
 * Merge a rehydrated blob over the current (initializer) state. Beyond zustand's default
 * shallow merge it HEALS the whole-object fields so an older/corrupt blob can't crash newer
 * readers: each field in {@link HEAL_RULES} (and each extension dial) is re-parsed through its
 * schema, keeping the current value when absent or corrupt; `midi` is healed field by field
 * ({@link healMidi}); and `faceMapping` is clamped to a known mode (unknown values → derived
 * from any legacy `faceEnabled`, else `none`). Exported for direct testing.
 */
export function mergeControls(persisted: unknown, current: ControlState): ControlState {
  const p = (persisted ?? {}) as Partial<ControlState> & { faceEnabled?: boolean };
  const stored = p as Record<string, unknown>;
  const cur = current as unknown as Record<string, unknown>;
  const healed = {
    ...healAll(stored, cur, HEAL_RULES as Readonly<Record<string, HealRule<unknown> | undefined>>),
    ...healAll(stored, cur, EXTENSION_HEAL_RULES),
  } as Partial<ControlState>;
  const faceMapping = (FACE_MAPPINGS as readonly string[]).includes(p.faceMapping as string)
    ? (p.faceMapping as FaceMapping)
    : legacyFaceToMapping(p.faceEnabled);
  // The MIDI settings (#137): a pre-MIDI blob has none → off / first port. Field by field
  // (#168 Q3): one corrupt field (a `muteFollowsMaster` of null or "yes" from a bad write)
  // takes its default alone and must not reset the player's `enabled` and `port`.
  const midi = healMidi(p.midi, current.midi);
  // The transport never resumes from storage (it is not persisted; `current` wins even
  // over a hand-edited blob), so a reload can never start a paid stream by itself.
  return { ...current, ...p, ...healed, faceMapping, midi, steerPlaying: current.steerPlaying, scoreDoc: current.scoreDoc, songHandle: current.songHandle, songPlaying: current.songPlaying, songPlays: current.songPlays, ...keptTransients(current) };
}

/** Release a replaced song's object URL (a local file's bytes stay alive until it is). */
function releaseSongUrl(song: SongHandle | null): void {
  if (song?.url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(song.url);
}

/** The extensions' transient fields as they are now: a rehydrated blob never carries them
 *  (they are not persisted), and a hand-edited one must not override them. */
function keptTransients(current: ControlState): Partial<ControlState> {
  const c = current as unknown as Record<string, unknown>;
  return Object.fromEntries(Object.keys(extensionTransientDefaults()).map((f) => [f, c[f]])) as Partial<ControlState>;
}

// localStorage in the browser; a no-op elsewhere (Node test runtime) so the
// persist middleware never references a missing `window`/`localStorage`.
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
const controlsStorage = (): StateStorage =>
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : noopStorage;

export const useControls = create<ControlState>()(
  persist(
    (set) => ({
      right: defaultVoice(DEFAULT_SOUND_RIGHT),
      left: defaultVoice(DEFAULT_SOUND_LEFT),
      syncHands: true,
      masterVolume: 0.4,
      octaveShift: 0,
      magnetism: 0.8,
      muted: false,
      hushedBy: [],
      faceMapping: 'none',
      faceChord: { ...DEFAULT_FACE_CHORD },
      faceExpr: {
        sensitivity: { ...DEFAULT_FACE_EXPR.sensitivity },
        degrees: { ...DEFAULT_FACE_EXPR.degrees },
      },
      overlay: defaultOverlay(),
      featureLab: defaultFeatureLab(),
      handMap: defaultHandMap(),
      midi: { ...DEFAULT_MIDI },
      hands: { ...DEFAULT_HANDS },
      body: { ...DEFAULT_BODY },
      songPrefs: { ...DEFAULT_SONG },
      songHandle: null,
      songPlaying: false,
      songPlays: 0,
      bodyMap: structuredClone(DEFAULT_BODY_MAP),
      steer: defaultSteer(),
      steerPlaying: false,
      scoreDoc: null,
      graphElements: null,
      faceControls: defaultFaceControls(),
      conductor: defaultConductor(),
      ...extensionDialDefaults(),
      ...extensionTransientDefaults(),
      faceCalibration: null,
      gestures: defaultGesturePrefs(),
      trainerHud: TrainerHudParamsSchema.parse({}),
      audioPrefs: { ...DEFAULT_AUDIO_PREFS },
      setVoice: (side, patch) =>
        set((s) => {
          const next = { ...s[side], ...patch };
          if (s.syncHands) {
            // When synced, both hands share settings — including the patched
            // sound on the *addressed* hand — but each hand keeps its OWN
            // sound otherwise, so the two voices stay timbrally distinct.
            const other = side === 'right' ? 'left' : 'right';
            return {
              [side]: next,
              [other]: { ...next, sound: s[other].sound },
            } as Pick<ControlState, 'right' | 'left'>;
          }
          return { [side]: next } as Pick<ControlState, 'right' | 'left'>;
        }),
      setSync: (v) => set({ syncHands: v }),
      setMasterVolume: (v) => set({ masterVolume: v }),
      setMuted: (v) => set({ muted: v }),
      toggleMuted: () => set((s) => ({ muted: !s.muted })),
      setHush: (claimer, on) =>
        set((s) => {
          const held = s.hushedBy.includes(claimer);
          if (on === held) return s;
          return { hushedBy: on ? [...s.hushedBy, claimer] : s.hushedBy.filter((c) => c !== claimer) };
        }),
      setSteerPlaying: (v) => set({ steerPlaying: v }),
      setSongHandle: (song) =>
        set((s) => {
          if (s.songHandle === song) return s;
          releaseSongUrl(s.songHandle);
          return { songHandle: song, songPlaying: false };
        }),
      setSongPlaying: (v) => set((s) => (v ? { songPlaying: true, songPlays: s.songPlays + 1 } : { songPlaying: false })),
      setSongPrefs: (patch) =>
        set((s) => {
          const r = SongSettingsSchema.safeParse({ ...s.songPrefs, ...patch });
          return r.success ? { songPrefs: r.data } : s;
        }),
      setScoreDoc: (doc) => set({ scoreDoc: doc }),
      setGraphElements: (elements) => set({ graphElements: elements }),

      setTransient: (field, value) => set({ [field]: value } as Partial<ControlState>),
      toggleSteerPlaying: () => set((s) => ({ steerPlaying: !s.steerPlaying })),
      setFaceMapping: (v) => set({ faceMapping: v }),
      setFaceChord: (patch) => set((s) => ({ faceChord: { ...s.faceChord, ...patch } })),
      setExpressionSensitivity: (emotion, value) =>
        set((s) => ({
          faceExpr: { ...s.faceExpr, sensitivity: { ...s.faceExpr.sensitivity, [emotion]: value } },
        })),
      setExpressionDegree: (expr, degree) =>
        set((s) => ({
          faceExpr: { ...s.faceExpr, degrees: { ...s.faceExpr.degrees, [expr]: degree } },
        })),
      setOverlayElement: (key, patch) =>
        set((s) => ({
          overlay: { ...s.overlay, [key]: { ...s.overlay[key], ...patch } } as OverlayDialParams,
        })),
      setFeatureLab: (patch) => set((s) => ({ featureLab: { ...s.featureLab, ...patch } })),
      setHandMap: (patch) => set((s) => ({ handMap: { ...s.handMap, ...patch } })),
      setFaceCalibration: (map) => set({ faceCalibration: map ? { ...map } : null }),
      setGestures: (patch) => set((s) => ({ gestures: { ...s.gestures, ...patch } })),
      setTrainerHud: (patch) => set((s) => ({ trainerHud: { ...s.trainerHud, ...patch } })),
      setAudioPrefs: (patch) => set((s) => ({ audioPrefs: { ...s.audioPrefs, ...patch } })),
      // Restore exactly the schema fields (the setters are left untouched). Derived
      // from SETTINGS_KEYS, so a new preset field needs no edit.
      applySettings: (st) =>
        set((s) => {
          const next = pickSettings(st as unknown as Record<string, unknown>);
          // Switching the generative layer OFF pauses its transport (#188): a stale
          // `steerPlaying` would otherwise auto-start a paid stream on the next enable,
          // with no Play press — within a session, the very thing "not a dial" prevents.
          const steerOff = next.steer?.enabled === false && s.steer.enabled !== false;
          return steerOff ? { ...next, steerPlaying: false } : next;
        }),
    }),
    {
      name: 'thoremin-controls',
      // The version and its history live beside the migration steps (CONTROLS_VERSION).
      version: CONTROLS_VERSION,
      migrate: migrateControls,
      merge: mergeControls,
      storage: createJSONStorage(controlsStorage),
      // Persist the preset fields (schema-derived) + the per-device tooling prefs
      // (calibration, feature lab, gesture bindings), never the setter functions.
      partialize: (s) => ({
        ...pickSettings(s as unknown as Record<string, unknown>),
        faceCalibration: s.faceCalibration,
        featureLab: s.featureLab,
        gestures: s.gestures,
        trainerHud: s.trainerHud,
        audioPrefs: s.audioPrefs,
        songPrefs: s.songPrefs,
      }),
    },
  ),
);

// The extension SDK's controls seam (`@thoremin/sdk-ui/host`): an extension's React side reads
// and writes the hot store through this, never by importing it. Installed when this module
// loads, which every running app and every test that touches the store does first.
const TRANSIENT_FIELDS = new Set(Object.keys(extensionTransientDefaults()));
provideControls({
  get: () => useControls.getState() as unknown as Readonly<Record<string, unknown>>,
  setTransient: (field, value) => {
    // The type-level check (`setTransient`'s keys) does not reach an extension typed against
    // the SDK, so the field is checked here: a typo must not silently create a store key.
    if (!TRANSIENT_FIELDS.has(field)) throw new Error(`setTransient: "${field}" is not a transient field any listed extension declares`);
    useControls.setState({ [field]: value } as Partial<ControlState>);
  },
  setHush: (claimer, on) => useControls.getState().setHush(claimer, on),
  subscribe: (listener) => useControls.subscribe(listener),
});

