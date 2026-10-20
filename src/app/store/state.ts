/**
 * The hot store's state (#600 S19b, out of `store.ts`): the {@link ControlState} type, its
 * defaults, and the preset fields (the settings schema's keys) it snapshots and restores.
 */
import type { ScaleTypeId } from '@thoremin/sdk/music/theory';
import { OverlayDialSchema, type OverlayDialParams } from '@/nodes/output/canvas_overlay.schema';
import type { GesturePrefs } from '../gestures/gesturePrefs';
import type { VoiceParams, FaceMapping } from '@thoremin/sdk/nodes/domain';
import { SettingsSchema, type ExtensionDials, type ExtensionTransients, type FaceChord, type FaceExpr, type HandsSettings, type Settings } from '@/settings/schema';
import { DEFAULT_HAND_MAP, type HandMap } from '@/nodes/mapping/hand_map.schema';
import { DEFAULT_FACE_CONTROLS_DIAL, type FaceControlsDialParams } from '@/nodes/features/face_controls.schema';
import type { AudioPrefs } from '../timing/audioPrefs';

/** A fresh deep copy of the default hand map (nested fingers/routes), so the store's
 *  initializer and healers never share mutable sub-objects with the constant. */
export const defaultHandMap = (): HandMap => structuredClone(DEFAULT_HAND_MAP);

/** A fresh copy of the shipped face-control axis tuning (#76), for the same reason as
 *  {@link defaultHandMap}: the initializer and the healers must never hand out the
 *  module-level constant itself, or an edit in one instrument would mutate the default. */
export const defaultFaceControls = (): FaceControlsDialParams => ({ ...DEFAULT_FACE_CONTROLS_DIAL });

/** The preset keys (derived from the schema — the SSOT). Add a field to
 *  SettingsSchema (+ the store) and it is snapshotted, persisted, and restored
 *  automatically: no hand-edits to toSettings / applySettings / partialize. */
export const SETTINGS_KEYS = Object.keys(SettingsSchema.shape) as (keyof Settings)[];

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
   * unmute a player who had muted on purpose. An extension that hushes while it runs
   * does not claim here — its `hushes` rule is derived in `store-controls`, so it cannot leak.
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
   *  This is the DIAL-facing overlay: tooling prefs (the trainer HUD) are not in it. */
  overlay: OverlayDialParams;
  /** The hand→sound mapping: note source (index/wrist), finger→effect routing, and
   *  the once-static voice knobs. Read live by `voice-mapping` via
   *  `ctx.resources.controls`. See src/nodes/mapping/hand_map.ts. */
  handMap: HandMap;
  /** The hands reading (#148): the handedness dwell `hand-features` applies (0 = raw
   *  label). A preset field (in {@link SETTINGS_KEYS}); read live by `hand-features` via
   *  `store-controls` → its `handednessDwell` input. */
  hands: HandsSettings;
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
   * gesture → command binding map. A TOOLING preference like {@link faceCalibration} —
   * persisted per-device via `partialize`, NOT a preset field and NOT a dial:
   * gestures bind to commands the way the keyboard does, and keybindings are not
   * instrument state (loading an instrument must never rebind your hands). Read
   * each frame by the app-level gesture dispatcher (`gestureDispatch.ts`) and
   * edited from the Gestures shell tool.
   */
  gestures: GesturePrefs;
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
  /** Replace the composed graph's overlay element set (transient, see {@link graphElements}). */
  setGraphElements: (elements: string[] | null) => void;

  /** Replace an extension's transient field (a learned model, a pattern in play; see
   *  {@link ExtensionTransients}): never persisted, re-derived by the extension on load. */
  setTransient<K extends keyof ExtensionTransients & string>(field: K, value: ExtensionTransients[K]): void;
  setFaceMapping(v: FaceMapping): void;
  /** Patch the face-chord settings (e.g. setFaceChord({ voicing: 'spread' })). */
  setFaceChord(patch: Partial<FaceChord>): void;
  /** Set one emotion's firing sensitivity [0,1] (higher = more hits). */
  setExpressionSensitivity(emotion: string, value: number): void;
  /** Set the scale degree (0..6) an expression maps to. */
  setExpressionDegree(expr: string, degree: number): void;
  /** Patch one overlay element's options (e.g. setOverlayElement('indexGuide', { show: true })). */
  setOverlayElement<K extends keyof OverlayDialParams>(key: K, patch: Partial<OverlayDialParams[K]>): void;
  /** Shallow-patch the hand map (e.g. setHandMap({ positionSource: 'wrist' }), or a new
   *  `fingers` object for a route change). */
  setHandMap(patch: Partial<HandMap>): void;
  /** Store (or clear, with null) the per-device expression calibration. */
  setFaceCalibration(map: Record<string, number> | null): void;
  /** Shallow-patch the gesture-dispatch prefs (e.g. setGestures({ enabled: true }),
   *  or a whole new `bindings` record for a binding change). */
  setGestures(patch: Partial<GesturePrefs>): void;
  /** Shallow-patch the per-device audio pref (#240; e.g. setAudioPrefs({ lowLatency: true })). */
  setAudioPrefs(patch: Partial<AudioPrefs>): void;
  /** Replace an extension's per-device pref (#600 S9), validated by its slice's schema (an
   *  invalid value is ignored; an unknown key throws: it would silently create a store field). */
  setPref(key: string, value: unknown): void;
  /** Replace all live controls from a settings snapshot (loading a preset). */
  applySettings(s: Settings): void;
}

export const defaultVoice = (sound: VoiceParams['sound']): VoiceControl => ({
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
export const defaultOverlay = (): OverlayDialParams => OverlayDialSchema.parse({});

/** Pick exactly the preset fields ({@link SETTINGS_KEYS}) from a state-like object. */
export function pickSettings(s: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) out[k] = s[k];
  return out as unknown as Settings;
}

/** Snapshot the persistable settings from the live state (for saving a preset). */
export function toSettings(s: ControlState): Settings {
  return pickSettings(s as unknown as Record<string, unknown>);
}

