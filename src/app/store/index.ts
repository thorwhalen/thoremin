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
 *
 * Split by concern since #600 S19b: the state and its defaults (`./state`), the heal rules
 * (`./heal`), the migration chains (`./migrations`), what is persisted and how a blob is merged
 * back (`./persist`); this module builds the store and installs the SDK's controls host.
 */
import { create } from 'zustand';
import { provideControls } from '@thoremin/sdk-ui/host';
import { adoptWithoutWriting } from '@thoremin/sdk-ui/storage';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SOUND_RIGHT, DEFAULT_SOUND_LEFT } from '@thoremin/sdk/music/sounds';
import type { OverlayDialParams } from '@/nodes/output/canvas_overlay.schema';
import { defaultGesturePrefs } from '../gestures/gesturePrefs';
import { DEFAULT_FACE_CHORD, DEFAULT_FACE_EXPR, DEFAULT_HANDS, extensionDialDefaults, extensionTransientDefaults } from '@/settings/schema';
import { DEFAULT_AUDIO_PREFS } from '../timing/audioPrefs';
import { CONTRIBUTIONS } from '@/host/contributions';
import { defaultFaceControls, defaultHandMap, defaultOverlay, defaultVoice, pickSettings, type ControlState } from './state';
import { CONTROLS_VERSION, migrateControls } from './migrations';
import { controlsStorage, devicePrefsFromOtherTab, mergeControls, persistedControls, withExtensionPrefs } from './persist';

export { toSettings, type ControlState, type VoiceControl } from './state';
export { HEAL_RULES } from './heal';
export { migrateControls } from './migrations';
export { devicePrefsFromOtherTab, mergeControls, persistedControls, withExtensionPrefs } from './persist';

const CONTROLS_STORAGE_KEY = 'thoremin-controls';

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
      name: CONTROLS_STORAGE_KEY,
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

// Another tab saved (#847; the browser fires this only in the OTHER tabs): take in its device prefs
// and learned values, so this tab's next save does not revert them, and leave the dials sounding here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== CONTROLS_STORAGE_KEY || !e.newValue) return;
    const prefs = devicePrefsFromOtherTab(e.newValue, useControls.getState());
    if (prefs && Object.keys(prefs).length > 0) adoptWithoutWriting(CONTROLS_STORAGE_KEY, () => useControls.setState(prefs));
  });
}

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

