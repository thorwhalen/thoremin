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
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { ScaleTypeId } from '@/music/theory';
import { DEFAULT_SOUND_RIGHT, DEFAULT_SOUND_LEFT } from '@/music/sounds';
import { OverlayParamsSchema, type OverlayParams } from '@/nodes/output/canvas_overlay';
import { FACE_MAPPINGS, legacyFaceToMapping, type VoiceParams, type FaceMapping } from '@/nodes';
import {
  DEFAULT_FACE_CHORD,
  DEFAULT_FACE_EXPR,
  FaceChordSchema,
  FaceExprSchema,
  HandMapSchema,
  SettingsSchema,
  type Settings,
  type FaceChord,
  type FaceExpr,
} from '@/settings/schema';
import { DEFAULT_HAND_MAP, type HandMap } from '@/nodes/mapping/hand_map';
import { DEFAULT_RECORDING_FORMATS } from './recording/formats';

/** A fresh deep copy of the default hand map (nested fingers/routes), so the store's
 *  initializer and healers never share mutable sub-objects with the constant. */
const defaultHandMap = (): HandMap => structuredClone(DEFAULT_HAND_MAP);

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
}

export interface ControlState {
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
   * What the player's facial expression maps to: `none` (off, default), `timbre`
   * (smile→brightness, open mouth→vibrato), or `chord` (expression selects a
   * diatonic triad). Any non-`none` mode lazy-loads the `webcam-face` model. Read
   * by the nodes each tick via `ctx.resources.controls`.
   */
  faceMapping: FaceMapping;
  /** How the face chord sounds (sound / volume / voicing / rendering / tempo).
   *  Read live by `expression-chord` via the `chordConfig` port. */
  faceChord: FaceChord;
  /** The expression-mapping config: per-emotion firing sensitivity (read live by
   *  `face-expression`) + per-expression scale-degree map (read live by
   *  `expression-chord`). */
  faceExpr: FaceExpr;
  /** Composable overlay element config (see canvas_overlay.ts). Live-controlled. */
  overlay: OverlayParams;
  /** The hand→sound mapping: note source (index/wrist), finger→effect routing, and
   *  the once-static voice knobs. Read live by `voice-mapping` via
   *  `ctx.resources.controls`. See src/nodes/mapping/hand_map.ts. */
  handMap: HandMap;
  /**
   * Output formats a recording is saved in (ids from the recording format
   * registry; always ≥1). A tooling preference — persisted to localStorage but
   * NOT part of a musical preset (it's orthogonal to the sound's sound).
   */
  recordingFormats: string[];
  /** Per-DEVICE expression calibration: a per-emotion firing-sensitivity override
   *  produced by the calibration wizard, applied OVER `faceExpr.sensitivity` for every
   *  instrument (so calibration is global). Persisted to localStorage, NOT part of a
   *  preset (like {@link recordingFormats}). Null = uncalibrated. */
  faceCalibration: Record<string, number> | null;
  setVoice(side: 'right' | 'left', patch: Partial<VoiceControl>): void;
  setSync(v: boolean): void;
  setMasterVolume(v: number): void;
  /** Set the master mute directly. */
  setMuted(v: boolean): void;
  /** Toggle the master mute — the `m` key (app-level keyboard handler, #90) calls this. */
  toggleMuted(): void;
  setFaceMapping(v: FaceMapping): void;
  /** Patch the face-chord settings (e.g. setFaceChord({ voicing: 'spread' })). */
  setFaceChord(patch: Partial<FaceChord>): void;
  /** Set one emotion's firing sensitivity [0,1] (higher = more hits). */
  setExpressionSensitivity(emotion: string, value: number): void;
  /** Set the scale degree (0..6) an expression maps to. */
  setExpressionDegree(expr: string, degree: number): void;
  /** Toggle a recording output format on/off (keeps at least one selected). */
  setRecordingFormat(id: string, on: boolean): void;
  /** Patch one overlay element's options (e.g. setOverlayElement('indexGuide', { show: true })). */
  setOverlayElement<K extends keyof OverlayParams>(key: K, patch: Partial<OverlayParams[K]>): void;
  /** Shallow-patch the hand map (e.g. setHandMap({ positionSource: 'wrist' }), or a new
   *  `fingers` object for a route change). */
  setHandMap(patch: Partial<HandMap>): void;
  /** Store (or clear, with null) the per-device expression calibration. */
  setFaceCalibration(map: Record<string, number> | null): void;
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
});

/** The overlay element defaults (all on except the opt-in index-finger guide). */
const defaultOverlay = (): OverlayParams => OverlayParamsSchema.parse({});

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
      overlay = OverlayParamsSchema.parse(p.overlay);
    } catch {
      overlay = current.overlay;
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
  return { ...current, ...p, overlay, faceMapping, faceChord, faceExpr, handMap };
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
      faceMapping: 'none',
      faceChord: { ...DEFAULT_FACE_CHORD },
      faceExpr: {
        sensitivity: { ...DEFAULT_FACE_EXPR.sensitivity },
        degrees: { ...DEFAULT_FACE_EXPR.degrees },
      },
      overlay: defaultOverlay(),
      handMap: defaultHandMap(),
      recordingFormats: [...DEFAULT_RECORDING_FORMATS],
      faceCalibration: null,
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
      setRecordingFormat: (id, on) =>
        set((s) => {
          const has = s.recordingFormats.includes(id);
          if (on && !has) return { recordingFormats: [...s.recordingFormats, id] };
          if (!on && has) {
            const next = s.recordingFormats.filter((f) => f !== id);
            // Keep at least one format selected, so a recording always saves.
            return next.length ? { recordingFormats: next } : {};
          }
          return {};
        }),
      setOverlayElement: (key, patch) =>
        set((s) => ({
          overlay: { ...s.overlay, [key]: { ...s.overlay[key], ...patch } } as OverlayParams,
        })),
      setHandMap: (patch) => set((s) => ({ handMap: { ...s.handMap, ...patch } })),
      setFaceCalibration: (map) => set({ faceCalibration: map ? { ...map } : null }),
      // Restore exactly the schema fields (the setters/recordingFormats are left
      // untouched). Derived from SETTINGS_KEYS, so a new preset field needs no edit.
      applySettings: (st) => set(pickSettings(st as unknown as Record<string, unknown>)),
    }),
    {
      name: 'thoremin-controls',
      // Version 5: the abstention retune — deliver the raised fearful/disgusted
      // sensitivity default (0.5 → 0.7) to a returning player who never customized it.
      // v4: added the `handMap`. v3: `instrument` → `sound` rename. v2: the face-mapping
      // chooser (#64). See migrateControls (field renames/bumps) and mergeControls (heals
      // stale nested `overlay`/`faceChord`/`faceExpr`/`handMap` + clamps `faceMapping`).
      version: 5,
      migrate: migrateControls,
      merge: mergeControls,
      storage: createJSONStorage(controlsStorage),
      // Persist the preset fields (schema-derived) + the recordingFormats tooling
      // pref, never the setter functions.
      partialize: (s) => ({
        ...pickSettings(s as unknown as Record<string, unknown>),
        recordingFormats: s.recordingFormats,
        faceCalibration: s.faceCalibration,
      }),
    },
  ),
);
