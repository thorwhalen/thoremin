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
import { OverlayDialSchema, TrainerHudParamsSchema, type OverlayDialParams, type TrainerHudParams } from '@/nodes/output/canvas_overlay.schema';
import { GesturePrefsSchema, defaultGesturePrefs, type GesturePrefs } from './gesturePrefs';
import { FACE_MAPPINGS, legacyFaceToMapping, type VoiceParams, type FaceMapping } from '@thoremin/sdk/nodes/domain';
import {
  DEFAULT_FACE_CHORD,
  DEFAULT_FACE_EXPR,
  DEFAULT_HANDS,
  HandsSettingsSchema,
  type HandsSettings,
  FaceChordSchema,
  FaceExprSchema,
  HandMapSchema,
  SettingsSchema,
  type Settings,
  type FaceChord,
  type FaceExpr,
} from '@/settings/schema';
import { DEFAULT_HAND_MAP, type HandMap } from '@/nodes/mapping/hand_map.schema';
import {
  FaceControlsDialSchema,
  DEFAULT_FACE_CONTROLS_DIAL,
  type FaceControlsDialParams,
} from '@/nodes/features/face_controls.schema';
import { EXTENSION_DIAL_SCHEMAS, extensionDialDefaults, extensionTransientDefaults, type ExtensionDials, type ExtensionTransients } from '@/settings/schema';
import { AudioPrefsSchema, DEFAULT_AUDIO_PREFS, type AudioPrefs } from './timing/audioPrefs';
import { CONTROLS_VERSION, migrateCoreControls } from './storeMigrations';
import { assertNoCoreClash, CONTRIBUTIONS } from '@/host/contributions';
import type { PrefSlice } from '@thoremin/sdk/instruments/extension';
import { flatFields, migrateSlices, sliceChains, sliceVersionsToWrite, SLICE_VERSIONS_KEY } from '@/host/slices';
import type { DialSlice } from '@thoremin/sdk/instruments/extension';

/** A fresh deep copy of the default hand map (nested fingers/routes), so the store's
 *  initializer and healers never share mutable sub-objects with the constant. */
const defaultHandMap = (): HandMap => structuredClone(DEFAULT_HAND_MAP);

/** A fresh copy of the shipped face-control axis tuning (#76), for the same reason as
 *  {@link defaultHandMap}: the initializer and the healers must never hand out the
 *  module-level constant itself, or an edit in one instrument would mutate the default. */
const defaultFaceControls = (): FaceControlsDialParams => ({ ...DEFAULT_FACE_CONTROLS_DIAL });
/** A fresh generative-layer default (the `config` object is cloned for the same reason). */

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
  /**
   * The trainer's on-video guidance HUD (#163): shown, and on which edge. A per-DEVICE
   * tooling pref like {@link faceCalibration} — the trainer is a shell tool, so hiding its
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
  /** Shallow-patch the trainer HUD pref (e.g. setTrainerHud({ show: false })). */
  setTrainerHud(patch: Partial<TrainerHudParams>): void;
  /** Shallow-patch the per-device audio pref (#240; e.g. setAudioPrefs({ lowLatency: true })). */
  setAudioPrefs(patch: Partial<AudioPrefs>): void;
  /** Replace an extension's per-device pref (#600 S9), validated by its slice's schema (an
   *  invalid value is ignored; an unknown key throws: it would silently create a store field). */
  setPref(key: string, value: unknown): void;
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


/**
 * Persist migration of the CORE fields: every step whose target version is above the blob's,
 * oldest first (the chain, the version and its history are in `./storeMigrations.ts`). The result
 * is a new object; the caller's blob is never edited. Exported for direct testing.
 */
export function migrateControls(persisted: unknown, version: number): ControlState {
  return migrateCoreControls(persisted, version) as unknown as ControlState;
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
  // The trainer HUD pref (#163).
  trainerHud: { schema: TrainerHudParamsSchema },
  // Completed from the defaults, then validated, so a UI control never binds to an
  // undefined/corrupt field (parity with overlay).
  faceChord: { schema: FaceChordSchema, complete: overDefaults(DEFAULT_FACE_CHORD) },
  // The sensitivity/degrees maps are filled from the defaults key by key, so a returning
  // user's older blob can't leave an emotion's slider unbound; the targets map is empty unless set.
  faceExpr: {
    schema: FaceExprSchema,
    complete: (stored) => {
      const pe = stored as Partial<FaceExpr>;
      return {
        sensitivity: { ...DEFAULT_FACE_EXPR.sensitivity, ...(pe.sensitivity ?? {}) },
        degrees: { ...DEFAULT_FACE_EXPR.degrees, ...(pe.degrees ?? {}) },
        // H6 of #613: absent on every blob saved before targets existed = no targets (degrees).
        // Only string values survive (a malformed one is dropped, not the whole face map).
        targets: { ...DEFAULT_FACE_EXPR.targets, ...Object.fromEntries(Object.entries((pe.targets ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) },
      };
    },
  },
  // Older blobs lack it entirely → the default index-source, no-routing map, so a returning
  // user can never leave a finger route or knob unbound.
  handMap: { schema: HandMapSchema },
  // The hands reading (#148): a pre-#148 blob has none → dwell 0 (the raw label).
  hands: { schema: HandsSettingsSchema, complete: overDefaults(DEFAULT_HANDS) },
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
  // The gesture prefs (#129), completed over the current (default) prefs. The blob's
  // `bindings` record replaces the default wholesale (an unbound-by-the-user gesture must
  // STAY unbound, not be re-seeded every load).
  gestures: { schema: GesturePrefsSchema, complete: overCurrent },
  // The per-device audio pref (#240): a pre-#240 blob has none → the default hint.
  audioPrefs: { schema: AudioPrefsSchema, complete: overCurrent },
};

/** A flat slice's heal (#600 S13): field by field, as each field is a dial of its own: a field that
 *  parses is kept (one the stored object lacks parses to its default, as core's `healMidi` did), a
 *  corrupt one keeps the current value alone and never resets its siblings. */
const overCurrentFields = (slice: DialSlice) => (stored: unknown, current: unknown): unknown => {
  const out: Record<string, unknown> = { ...(current as object) };
  for (const [field, schema] of flatFields(slice)) {
    const parsed = schema.safeParse((stored as Record<string, unknown> | undefined)?.[field]);
    if (parsed.success) out[field] = parsed.data;
  }
  // A partial field value completed from the default (#600 S14), as a saved instrument's is.
  for (const [field, complete] of Object.entries(slice.complete ?? {})) out[field] = complete(out[field]);
  return out;
};

/** The extensions' dials, each healed through its own slice schema over the current value, like
 *  the conductor; a flat one field by field. */
const EXTENSION_HEAL_RULES: Readonly<Record<string, HealRule<unknown>>> = Object.fromEntries([
  ...CONTRIBUTIONS.dialSlices.map((slice) => [slice.key, { schema: EXTENSION_DIAL_SCHEMAS[slice.key], complete: slice.layout === 'flat' ? overCurrentFields(slice) : overCurrent }]),
  // The extensions' per-device prefs (#600 S9), healed the same way.
  ...CONTRIBUTIONS.prefSlices.map((p) => [p.key, { schema: p.schema, complete: overCurrent }]),
]);

/** Each extension dial's and pref's migration chain (#600 S9), run on rehydrate before the heal. */
const SLICE_CHAINS = sliceChains([...CONTRIBUTIONS.dialSlices, ...CONTRIBUTIONS.prefSlices]);

/** The slices the last rehydrated blob had that no listed extension claims (an extension removed
 *  from the build), with their stored versions: carried through every write untouched. */
let foreignSlices: Readonly<Record<string, number>> = {};

/**
 * The initial state with the extensions' per-device prefs added at their schema defaults (a first
 * load). A pref named like a core field (or a dial, or a transient) would replace that field's
 * default and its heal rule, and a returning player's value would be healed through the wrong
 * schema: refused, loudly, when the store is built. Exported for direct testing.
 */
export function withExtensionPrefs<S extends object>(state: S, prefSlices: readonly PrefSlice[] = CONTRIBUTIONS.prefSlices): S {
  assertNoCoreClash('hot-store field (as a pref)', Object.keys(state), prefSlices.map((p) => p.key));
  return { ...state, ...Object.fromEntries(prefSlices.map((p) => [p.key, structuredClone(p.schema.parse(undefined))])) };
}

/**
 * The three groups of {@link ControlState} (#600 S9), declared once so what is saved is computed,
 * never hand-kept: PRESET dials (the settings schema's keys, saved in an instrument too), DEVICE
 * prefs (core's below and every extension's pref slice: persisted, never in an instrument), and
 * the SESSION (everything else: transients, the transport, the loaded song; never persisted).
 */
const CORE_DEVICE_PREF_KEYS = ['faceCalibration', 'gestures', 'trainerHud', 'audioPrefs'] as const satisfies readonly (keyof ControlState)[];
const PERSISTED_KEYS: readonly string[] = [...SETTINGS_KEYS, ...CORE_DEVICE_PREF_KEYS, ...CONTRIBUTIONS.prefSlices.map((p) => p.key)];

/** What the hot store persists: the preset dials and the device prefs, the foreign slices as they
 *  were stored, and every slice's version. Exported for direct testing. */
export function persistedControls(s: ControlState): Record<string, unknown> {
  const state = s as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of PERSISTED_KEYS) out[k] = state[k];
  for (const k of Object.keys(foreignSlices)) out[k] = state[k];
  out[SLICE_VERSIONS_KEY] = sliceVersionsToWrite(SLICE_CHAINS, foreignSlices);
  return out;
}

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
 * schema, keeping the current value when absent or corrupt (a FLAT extension dial, such as
 * `midi`, field by field); and `faceMapping` is clamped to a known mode (unknown values → derived
 * from any legacy `faceEnabled`, else `none`). Exported for direct testing.
 */
export function mergeControls(persisted: unknown, current: ControlState): ControlState {
  // The extensions' slices first (#600 S9): each runs its own chain, and a slice no listed
  // extension claims is remembered, to be written back untouched.
  const migrated = migrateSlices(persisted ?? {}, SLICE_CHAINS);
  // A stored version on a core field is not a foreign slice: core's fields are written anyway.
  foreignSlices = Object.fromEntries(Object.entries(migrated.foreign).filter(([k]) => !PERSISTED_KEYS.includes(k)));
  const p = migrated.blob as Partial<ControlState> & { faceEnabled?: boolean };
  const stored = p as Record<string, unknown>;
  const cur = current as unknown as Record<string, unknown>;
  const healed = {
    ...healAll(stored, cur, HEAL_RULES as Readonly<Record<string, HealRule<unknown> | undefined>>),
    ...healAll(stored, cur, EXTENSION_HEAL_RULES),
  } as Partial<ControlState>;
  const faceMapping = (FACE_MAPPINGS as readonly string[]).includes(p.faceMapping as string)
    ? (p.faceMapping as FaceMapping)
    : legacyFaceToMapping(p.faceEnabled);
  // The transport never resumes from storage (it is not persisted; `current` wins even
  // over a hand-edited blob), so a reload can never start a paid stream by itself.
  return { ...current, ...p, ...healed, faceMapping, ...keptTransients(current) };
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
    (set) => withExtensionPrefs({
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
        targets: { ...DEFAULT_FACE_EXPR.targets },
      },
      overlay: defaultOverlay(),
      handMap: defaultHandMap(),
      hands: { ...DEFAULT_HANDS },
      graphElements: null,
      faceControls: defaultFaceControls(),
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
      setGraphElements: (elements) => set({ graphElements: elements }),

      setTransient: (field, value) => set({ [field]: value } as Partial<ControlState>),
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
      setHandMap: (patch) => set((s) => ({ handMap: { ...s.handMap, ...patch } })),
      setFaceCalibration: (map) => set({ faceCalibration: map ? { ...map } : null }),
      setGestures: (patch) => set((s) => ({ gestures: { ...s.gestures, ...patch } })),
      setTrainerHud: (patch) => set((s) => ({ trainerHud: { ...s.trainerHud, ...patch } })),
      setAudioPrefs: (patch) => set((s) => ({ audioPrefs: { ...s.audioPrefs, ...patch } })),
      setPref: (key, value) => {
        const slice = CONTRIBUTIONS.prefSlices.find((p) => p.key === key);
        if (!slice) throw new Error(`setPref: "${key}" is not a pref any listed extension declares`);
        const r = slice.schema.safeParse(value);
        if (r.success) set({ [key]: r.data } as Partial<ControlState>);
      },
      // Restore exactly the schema fields (the setters are left untouched). Derived
      // from SETTINGS_KEYS, so a new preset field needs no edit.
      applySettings: (st) => set(pickSettings(st as unknown as Record<string, unknown>)),
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
      // The preset dials, the device prefs and the slices' versions (computed from the groups).
      partialize: persistedControls,
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
  setPref: (key, value) => useControls.getState().setPref(key, value),
  subscribe: (listener) => useControls.subscribe(listener),
});

