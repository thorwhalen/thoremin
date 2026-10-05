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
} from '@/settings/schema';
import { BodyMapSchema, DEFAULT_BODY_MAP, type BodyMap } from '@/nodes/mapping/body_map';
import { DEFAULT_HAND_MAP, type HandMap } from '@/nodes/mapping/hand_map';
import {
  FaceControlsDialSchema,
  DEFAULT_FACE_CONTROLS_DIAL,
  type FaceControlsDialParams,
} from '@/nodes/features/face_controls';
import { ConductorSettingsSchema, DEFAULT_CONDUCTOR, type ConductorSettings, EXTENSION_DIAL_SCHEMAS, extensionDialDefaults, extensionTransientDefaults, type ExtensionDials, type ExtensionTransients } from '@/settings/schema';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';

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
  /** The body source (#186): on/off + model. A preset field; read live by `webcam-body`
   *  through `ctx.resources.controls` (its gate, like the face's `faceMapping`). */
  body: BodySettings;
  /** The body→sound routing (#186 PR E). A preset field; flows to `body-route` through
   *  `store-controls` as the `bodyMap` port, so a route edit is live without a rebuild. */
  bodyMap: BodyMap;
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
  setVoice(side: 'right' | 'left', patch: Partial<VoiceControl>): void;
  setSync(v: boolean): void;
  setMasterVolume(v: number): void;
  /** Set the master mute directly. */
  setMuted(v: boolean): void;
  /** Toggle the master mute — the `m` key (app-level keyboard handler, #90) calls this. */
  toggleMuted(): void;
  /** Take (`on`) or release a hush claim (see {@link hushedBy}). Idempotent per claimer. */
  setHush(claimer: string, on: boolean): void;
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

/** Rename a legacy `instrument` timbre field to `sound` on a settings sub-object,
 *  so a returning player keeps their selection after the rename. */
function migrateInstrumentField(obj: unknown): void {
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    if (o.instrument !== undefined && o.sound === undefined) o.sound = o.instrument;
    delete o.instrument;
  }
}

/**
 * Persist migration. v1 → v2: the #64 face-mapping chooser replaced the boolean
 * `faceEnabled` with the tri-state `faceMapping`. v2 → v3: the per-hand / chord
 * timbre field was renamed `instrument` → `sound`; a returning player's saved
 * `instrument` becomes `sound` so they keep their sound. Exported for direct testing.
 */
export function migrateControls(persisted: unknown, version: number): ControlState {
  const s = { ...(persisted as Record<string, unknown>) };
  if (version < 2) {
    if (s.faceMapping === undefined) {
      s.faceMapping = legacyFaceToMapping(s.faceEnabled as boolean | undefined);
    }
    delete s.faceEnabled;
  }
  if (version < 3) {
    migrateInstrumentField(s.right);
    migrateInstrumentField(s.left);
    migrateInstrumentField(s.faceChord);
  }
  if (version < 5) {
    // The abstention retune raised the fearful/disgusted firing default 0.5 → 0.7.
    // Deliver it to a returning player who never customized those two (persisted value
    // still === the OLD default), while preserving any value they DID set.
    const fe = s.faceExpr as { sensitivity?: Record<string, number> } | undefined;
    if (fe?.sensitivity) {
      for (const e of ['fearful', 'disgusted'] as const) {
        if (fe.sensitivity[e] === 0.5) fe.sensitivity[e] = 0.7;
      }
    }
  }
  if (version < 7) {
    // #136: the Feature Lab moved OUT of the `overlay` dial (an instrument parameter)
    // and onto its own per-device tooling field. Carry a returning player's lab config
    // across rather than dropping it on the floor — `overlay` is re-parsed through the
    // lab-free OverlayDialSchema in mergeControls, which would strip it silently.
    const ov = s.overlay as Record<string, unknown> | undefined;
    if (ov?.featureLab !== undefined) {
      if (s.featureLab === undefined) s.featureLab = ov.featureLab;
      // Copy rather than `delete` on the caller's object: `persisted` is only shallow-
      // copied above, so `s.overlay` IS their object. (mergeControls re-parses `overlay`
      // through the lab-free schema and would drop the key anyway — this keeps the
      // directly-tested migrate honest about not mutating its input.)
      const { featureLab: _lifted, ...rest } = ov;
      s.overlay = rest;
    }
  }
  if (version < 18) {
    // The Trainer's running banner moved above every panel (it is now the on-screen
    // instruction), so painting the same words into the video is opt-in. A returning
    // player's persisted `show: true` is the OLD default, not a choice (nothing ever
    // asked), so it follows the new default once; re-ticking it in the panel sticks.
    const hud = s.trainerHud as Record<string, unknown> | undefined;
    if (hud && hud.show === true) s.trainerHud = { ...hud, show: false };
  }
  return s as unknown as ControlState;
}

/**
 * Merge a rehydrated blob over the current (initializer) state. Beyond zustand's
 * default shallow merge it HEALS two things so an older/corrupt blob can't crash
 * newer readers: it re-parses `overlay` through the schema (filling defaults for
 * overlay elements added since the blob was written — e.g. `chordGuide` in #64,
 * whose absence would otherwise throw in `overlay.chordGuide.show`), and clamps
 * `faceMapping` to a known mode (unknown values → derived from any legacy
 * `faceEnabled`, else `none`). Exported for direct testing.
 */
export function mergeControls(persisted: unknown, current: ControlState): ControlState {
  const p = (persisted ?? {}) as Partial<ControlState> & { faceEnabled?: boolean };
  let overlay = current.overlay;
  if (p.overlay) {
    try {
      overlay = OverlayDialSchema.parse(p.overlay);
    } catch {
      overlay = current.overlay;
    }
  }
  // Heal the lab config the same way (an older blob has none → the default meters).
  let featureLab = current.featureLab;
  if (p.featureLab) {
    try {
      featureLab = FeatureLabSchema.parse(p.featureLab);
    } catch {
      featureLab = current.featureLab;
    }
  }
  // And the trainer HUD pref (#163), the same way.
  let trainerHud = current.trainerHud;
  if (p.trainerHud) {
    try {
      trainerHud = TrainerHudParamsSchema.parse(p.trainerHud);
    } catch {
      trainerHud = current.trainerHud;
    }
  }
  // Re-parse faceChord: complete a partial blob from the defaults, then validate,
  // so a UI control never binds to an undefined/corrupt field (parity with overlay).
  let faceChord = current.faceChord;
  if (p.faceChord) {
    try {
      faceChord = FaceChordSchema.parse({ ...DEFAULT_FACE_CHORD, ...p.faceChord });
    } catch {
      faceChord = current.faceChord;
    }
  }
  // Heal faceExpr the same way: fill the sensitivity/degrees maps from the defaults
  // so a returning user's older blob can't leave an emotion's slider unbound.
  let faceExpr = current.faceExpr;
  if (p.faceExpr) {
    try {
      const pe = p.faceExpr as Partial<FaceExpr>;
      faceExpr = FaceExprSchema.parse({
        sensitivity: { ...DEFAULT_FACE_EXPR.sensitivity, ...(pe.sensitivity ?? {}) },
        degrees: { ...DEFAULT_FACE_EXPR.degrees, ...(pe.degrees ?? {}) },
      });
    } catch {
      faceExpr = current.faceExpr;
    }
  }
  const faceMapping = (FACE_MAPPINGS as readonly string[]).includes(p.faceMapping as string)
    ? (p.faceMapping as FaceMapping)
    : legacyFaceToMapping(p.faceEnabled);
  // Heal the hand map: re-parse through the schema (older blobs lack it entirely →
  // fall back to the default index-source, no-routing map), so a returning user can
  // never leave a finger route or knob unbound.
  let handMap = current.handMap;
  if (p.handMap) {
    try {
      handMap = HandMapSchema.parse(p.handMap);
    } catch {
      handMap = current.handMap;
    }
  }
  // Heal the MIDI settings (#137): a pre-MIDI blob has none → off / first port.
  let midi = current.midi;
  if (p.midi) {
    try {
      midi = MidiSettingsSchema.parse({ ...DEFAULT_MIDI, ...p.midi });
    } catch {
      midi = current.midi;
    }
  }
  // Heal the body settings (#186): a pre-body blob has none → off, lite.
  // Heal the body map (#186): a pre-routing blob has none → no routes.
  let bodyMap = current.bodyMap;
  if (p.bodyMap) {
    try {
      bodyMap = BodyMapSchema.parse(p.bodyMap);
    } catch {
      bodyMap = current.bodyMap;
    }
  }
  let body = current.body;
  if (p.body) {
    try {
      body = BodySettingsSchema.parse({ ...DEFAULT_BODY, ...p.body });
    } catch {
      body = current.body;
    }
  }
  // Heal the generative layer (#188): a pre-#188 blob has none → off / 0.7 / starter
  // strains; a partial one is completed; a corrupt one falls back whole.
  let steer = current.steer;
  if (p.steer) {
    try {
      const parsed = SteerSettingsSchema.parse({ ...DEFAULT_STEER, ...p.steer });
      // A PARTIAL config (the shape #202 persisted: smoothing + cadence, no arrays) is
      // completed from the default. Absent arrays already meant "the starter strains" to
      // the node, so this is sound-identical; it exists so the working layer and a saved
      // instrument (which `normalizeLayer` completes the same way) can never differ by a
      // key nobody edited and flag a phantom "unsaved edits".
      steer = { ...parsed, config: { ...defaultSteerConfig(), ...parsed.config } };
    } catch {
      steer = current.steer;
    }
  }
  // Heal the face-control axes (#76): a pre-#76-dials blob has none → the shipped tuning;
  // a partial one is completed; a corrupt one falls back whole rather than leaving the
  // panel to dereference an undefined into a NaN slider.
  //
  // Parsed RAW, unlike the `midi`/`faceChord` healers above which pre-spread their
  // defaults. That is not an inconsistency to tidy up later: EVERY field of this schema
  // carries a `.default(...)`, so `parse` already completes a partial blob, and the spread
  // would be dead code that a reader would mistake for load-bearing. The invariant it
  // relies on is enforced at import time, not by convention — `DEFAULT_FACE_CONTROLS_DIAL`
  // is built by `FaceControlsDialSchema.parse({})`, which throws on the day someone adds a
  // field without a default. (A mutation test caught the spread: removing it left the
  // suite fully green, which is the definition of a guard that guards nothing.)
  let faceControls = current.faceControls;
  if (p.faceControls) {
    try {
      faceControls = FaceControlsDialSchema.parse(p.faceControls);
    } catch {
      faceControls = current.faceControls;
    }
  }
  // Heal the gesture prefs (#129) the same way as the other tooling prefs: complete
  // a partial blob from the current (default) prefs, then validate — a pre-#129 blob
  // has none → the defaults; a corrupt blob falls back rather than crashing a newer
  // reader. Note the blob's `bindings` record replaces the default wholesale (an
  // unbound-by-the-user gesture must STAY unbound, not be re-seeded every load).
  // Heal the conductor dial (#187) exactly like faceControls: a pre-conductor blob has
  // none → off; a corrupt one falls back rather than crashing a newer reader.
  let conductor = current.conductor;
  if (p.conductor) {
    try {
      conductor = ConductorSettingsSchema.parse({ ...current.conductor, ...p.conductor });
    } catch {
      conductor = current.conductor;
    }
  }
  // Heal the extensions' whole-object dials (the air instruments' today) the same way:
  // each re-parsed through its own slice schema over the current value, kept on failure.
  const extensionDials: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(EXTENSION_DIAL_SCHEMAS)) {
    const cur = (current as unknown as Record<string, unknown>)[key];
    const patch = (p as Record<string, unknown>)[key];
    if (!patch) {
      extensionDials[key] = cur;
      continue;
    }
    try {
      extensionDials[key] = schema.parse({ ...(cur as object), ...(patch as object) });
    } catch {
      extensionDials[key] = cur;
    }
  }
  let gestures = current.gestures;
  if (p.gestures) {
    try {
      gestures = GesturePrefsSchema.parse({ ...current.gestures, ...p.gestures });
    } catch {
      gestures = current.gestures;
    }
  }
  // The transport never resumes from storage (it is not persisted; `current` wins even
  // over a hand-edited blob), so a reload can never start a paid stream by itself.
  return { ...current, ...p, overlay, featureLab, trainerHud, faceMapping, faceChord, faceExpr, handMap, midi, body, bodyMap, steer, faceControls, conductor, ...extensionDials, gestures, steerPlaying: current.steerPlaying, scoreDoc: current.scoreDoc, ...keptTransients(current) };
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
      body: { ...DEFAULT_BODY },
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
      // Version 6: #75 (decoupled chord-source scale — faceChord.chordSource/chordRoot/
      // chordType) + #63 (per-voice octave RANGE — right/left.rangeLow/rangeHigh). Both are
      // ADDITIVE with defaults, so no data transform is needed: mergeControls re-parses
      // faceChord through FaceChordSchema (filling chordSource='auto' etc. for returning
      // users → identical sound on their seven-note melodies), and the range fields are
      // optional (absent → the legacy `octaves` scale path, byte-identical). The bump is the
      // version marker for the schema growth.
      // Version 5: the abstention retune — deliver the raised fearful/disgusted
      // sensitivity default (0.5 → 0.7) to a returning player who never customized it.
      // v4: added the `handMap`. v3: `instrument` → `sound` rename. v2: the face-mapping
      // chooser (#64). See migrateControls (field renames/bumps) and mergeControls (heals
      // stale nested `overlay`/`faceChord`/`faceExpr`/`handMap` + clamps `faceMapping`).
      // Version 7: #136 lifted the Feature Lab out of the `overlay` dial onto its own
      // per-device `featureLab` field (a tooling pref, like `faceCalibration`). The
      // migrate carries a returning player's lab config across before mergeControls
      // re-parses `overlay` through the now lab-free OverlayDialSchema.
      // Version 8: #137 added the `midi` preset field (enabled/port). ADDITIVE with a
      // default (off / first available port), healed by mergeControls, so no data
      // transform is needed — the bump is the version marker for the schema growth.
      // Version 9: #129 added the `gestures` per-device tooling pref (enable flag,
      // hold/cooldown timing, gesture → command bindings). ADDITIVE with defaults
      // (disabled; fist → silence, pinch → restore volume, open unbound), healed by
      // mergeControls like featureLab, so no data transform is needed — the bump is
      // the version marker for the schema growth.
      // Version 10: #76 added the `faceControls` preset field (per-axis gain / deadzone /
      // neutral zero / smoothing for the head-pose control mode). ADDITIVE with the
      // shipped tuning as its default — which is byte-identical to the build-time params
      // the node used before the dial existed, so a returning player's `controls` mode
      // sounds and feels exactly as it did. Healed by mergeControls, so no data transform
      // is needed; the bump is the version marker for the schema growth.
      // Version 11: #188 added the `steer` preset field (the generative layer: enabled /
      // volume / config). ADDITIVE with a default (off), healed by mergeControls, so no
      // data transform is needed — the bump is the version marker for the schema growth.
      // The transport (`steerPlaying`) is transient and not persisted, like `muted`.
      // Version 12: #187 added the `conductor` preset field (the conductor node's params:
      // off by default, hand/point, servo horizon, fallback + dynamics ranges). ADDITIVE
      // with a default, healed by mergeControls; the bump marks the schema growth.
      // v13 (#186): `body` + `bodyMap` added to the preset fields; both heal in mergeControls
      // (a pre-#186 blob reads as off / no routes), so no data transform is needed — the
      // bump is the version marker for the schema growth.
      // v14 (#233): `airDrum` added to the preset fields (the air-drum node's params, off
      // by default); heals in mergeControls, so no data transform is needed.
      // v15 (#249): `airBass` added the same way (off by default, healed in mergeControls).
      // v16 (#249): `airGuitar` added the same way.
      // v17 (#249): `airFlute` added the same way.
      // v18: the trainer HUD pref's default flipped to off (the Trainer's banner is the
      // on-screen instruction now); migrateControls carries a returning player across.
      // v19 (#263): `airFlute.prior` added (the fingering-chart prior: on, the flute
      // chart, strength 10, C4..C#6). ADDITIVE with a default, healed by mergeControls'
      // schema parse, so no data transform is needed; the bump marks the schema growth.
      // v20 (#269): `airDrum.pattern` added (the trained pattern in play, '' for none).
      // ADDITIVE with a default, healed by mergeControls' schema parse; the bump marks it.
      version: 20,
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

