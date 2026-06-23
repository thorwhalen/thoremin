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
import type { VoiceParams } from '@/nodes';
import type { Settings } from '@/settings/schema';
import { DEFAULT_RECORDING_FORMATS } from './recording/formats';

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
   * Whether live face control is enabled. Off by default; when on, the
   * `webcam-face` node lazy-loads the FaceLandmarker model and drives facial
   * expression into the mapping (smile→brightness, open mouth→vibrato). Read by
   * the node each tick via `ctx.resources.controls`.
   */
  faceEnabled: boolean;
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
  setFaceEnabled(v: boolean): void;
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

/** Snapshot the persistable settings from the live state (for saving a preset). */
export function toSettings(s: ControlState): Settings {
  return {
    right: s.right,
    left: s.left,
    syncHands: s.syncHands,
    masterVolume: s.masterVolume,
    faceEnabled: s.faceEnabled,
    overlay: s.overlay,
  };
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
      faceEnabled: false,
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
      setFaceEnabled: (v) => set({ faceEnabled: v }),
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
      applySettings: (st) =>
        set({
          right: st.right,
          left: st.left,
          syncHands: st.syncHands,
          masterVolume: st.masterVolume,
          faceEnabled: st.faceEnabled,
          overlay: st.overlay,
        }),
    }),
    {
      name: 'thoremin-controls',
      // Version stays 1: `overlay`/`faceEnabled` are additive, and the default
      // shallow merge keeps the initializer's defaults when an older persisted
      // blob omits them (no migrate / no discard of existing voice/volume choices).
      version: 1,
      storage: createJSONStorage(controlsStorage),
      // Persist only the control values, never the setter functions.
      partialize: (s) => ({
        right: s.right,
        left: s.left,
        syncHands: s.syncHands,
        masterVolume: s.masterVolume,
        faceEnabled: s.faceEnabled,
        overlay: s.overlay,
        recordingFormats: s.recordingFormats,
      }),
    },
  ),
);
