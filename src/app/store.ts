/**
 * Zustand control store — the single source of truth for live UI controls.
 * The React control panel writes here; the `store-controls` DAG node reads
 * `getState()` each tick and emits the values onto the graph as port values.
 * This keeps UI state out of the graph spec, so changing scale/instrument/overlay
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
import { DEFAULT_INSTRUMENT_RIGHT, DEFAULT_INSTRUMENT_LEFT } from '@/music/instruments';
import { OverlayParamsSchema, type OverlayParams } from '@/nodes/output/canvas_overlay';
import { FACE_MAPPINGS, legacyFaceToMapping, type VoiceParams, type FaceMapping } from '@/nodes';
import {
  DEFAULT_FACE_CHORD,
  DEFAULT_FACE_EXPR,
  FaceChordSchema,
  FaceExprSchema,
  SettingsSchema,
  type Settings,
  type FaceChord,
  type FaceExpr,
} from '@/settings/schema';
import { DEFAULT_RECORDING_FORMATS } from './recording/formats';

/** The preset keys (derived from the schema — the SSOT). Add a field to
 *  SettingsSchema (+ the store) and it is snapshotted, persisted, and restored
 *  automatically: no hand-edits to toSettings / applySettings / partialize. */
const SETTINGS_KEYS = Object.keys(SettingsSchema.shape) as (keyof Settings)[];

export interface VoiceControl {
  root: number; // 0..11
  type: ScaleTypeId;
  octaves: number;
  baseOctave: number;
  instrument: VoiceParams['instrument'];
}

export interface ControlState {
  right: VoiceControl;
  left: VoiceControl;
  syncHands: boolean;
  masterVolume: number; // 0..1
  /**
   * What the player's facial expression maps to: `none` (off, default), `timbre`
   * (smile→brightness, open mouth→vibrato), or `chord` (expression selects a
   * diatonic triad). Any non-`none` mode lazy-loads the `webcam-face` model. Read
   * by the nodes each tick via `ctx.resources.controls`.
   */
  faceMapping: FaceMapping;
  /** How the face chord sounds (instrument / volume / voicing / rendering / tempo).
   *  Read live by `expression-chord` via the `chordConfig` port. */
  faceChord: FaceChord;
  /** The expression-mapping config: per-emotion firing sensitivity (read live by
   *  `face-expression`) + per-expression scale-degree map (read live by
   *  `expression-chord`). */
  faceExpr: FaceExpr;
  /** Composable overlay element config (see canvas_overlay.ts). Live-controlled. */
  overlay: OverlayParams;
  /**
   * Output formats a recording is saved in (ids from the recording format
   * registry; always ≥1). A tooling preference — persisted to localStorage but
   * NOT part of a musical preset (it's orthogonal to the instrument's sound).
   */
  recordingFormats: string[];
  setVoice(side: 'right' | 'left', patch: Partial<VoiceControl>): void;
  setSync(v: boolean): void;
  setMasterVolume(v: number): void;
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
  /** Replace all live controls from a settings snapshot (loading a preset). */
  applySettings(s: Settings): void;
}

const defaultVoice = (instrument: VoiceParams['instrument']): VoiceControl => ({
  root: 0,
  // Pentatonic by default: every snapped note sounds consonant, so the
  // instrument is forgiving and musical out of the box.
  type: 'pentatonic',
  octaves: 2,
  baseOctave: 3,
  instrument,
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

/**
 * Persist migration (v1 → v2): the #64 face-mapping chooser replaced the boolean
 * `faceEnabled` with the tri-state `faceMapping`. Maps a saved `faceEnabled:true`
 * → `faceMapping:'timbre'` so a returning player keeps face control on instead of
 * silently reverting to off. Exported for direct testing.
 */
export function migrateControls(persisted: unknown, version: number): ControlState {
  const s = { ...(persisted as Record<string, unknown>) };
  if (version < 2) {
    if (s.faceMapping === undefined) {
      s.faceMapping = legacyFaceToMapping(s.faceEnabled as boolean | undefined);
    }
    delete s.faceEnabled;
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
  return { ...current, ...p, overlay, faceMapping, faceChord, faceExpr };
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
      right: defaultVoice(DEFAULT_INSTRUMENT_RIGHT),
      left: defaultVoice(DEFAULT_INSTRUMENT_LEFT),
      syncHands: true,
      masterVolume: 0.4,
      faceMapping: 'none',
      faceChord: { ...DEFAULT_FACE_CHORD },
      faceExpr: {
        sensitivity: { ...DEFAULT_FACE_EXPR.sensitivity },
        degrees: { ...DEFAULT_FACE_EXPR.degrees },
      },
      overlay: defaultOverlay(),
      recordingFormats: [...DEFAULT_RECORDING_FORMATS],
      setVoice: (side, patch) =>
        set((s) => {
          const next = { ...s[side], ...patch };
          if (s.syncHands) {
            // When synced, both hands share settings — including the patched
            // instrument on the *addressed* hand — but each hand keeps its OWN
            // instrument otherwise, so the two voices stay timbrally distinct.
            const other = side === 'right' ? 'left' : 'right';
            return {
              [side]: next,
              [other]: { ...next, instrument: s[other].instrument },
            } as Pick<ControlState, 'right' | 'left'>;
          }
          return { [side]: next } as Pick<ControlState, 'right' | 'left'>;
        }),
      setSync: (v) => set({ syncHands: v }),
      setMasterVolume: (v) => set({ masterVolume: v }),
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
      // Restore exactly the schema fields (the setters/recordingFormats are left
      // untouched). Derived from SETTINGS_KEYS, so a new preset field needs no edit.
      applySettings: (st) => set(pickSettings(st as unknown as Record<string, unknown>)),
    }),
    {
      name: 'thoremin-controls',
      // Version 2: the face-mapping chooser (#64) replaced the boolean
      // `faceEnabled` with the tri-state `faceMapping`. See migrateControls (field
      // rename) and mergeControls (heals a stale `overlay`/`faceChord` + clamps
      // `faceMapping`). The later `faceChord` field is additive and default-safe
      // (the initializer + mergeControls supply it for a v2 blob that predates it),
      // so it intentionally needs no version bump or migrate branch.
      version: 2,
      migrate: migrateControls,
      merge: mergeControls,
      storage: createJSONStorage(controlsStorage),
      // Persist the preset fields (schema-derived) + the recordingFormats tooling
      // pref, never the setter functions.
      partialize: (s) => ({
        ...pickSettings(s as unknown as Record<string, unknown>),
        recordingFormats: s.recordingFormats,
      }),
    },
  ),
);
