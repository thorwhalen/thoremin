/**
 * Zustand control store — the single source of truth for live UI controls.
 * The React control panel writes here; the `store-controls` DAG node reads
 * `getState()` each tick and emits the values onto the graph as port values.
 * This keeps UI state out of the graph spec, so changing scale/instrument
 * never rebuilds the engine or reloads the ML model.
 */
import { create } from 'zustand';
import type { ScaleTypeId } from '@/music/theory';
import { DEFAULT_INSTRUMENT_RIGHT, DEFAULT_INSTRUMENT_LEFT } from '@/music/instruments';
import type { VoiceParams } from '@/nodes';

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
  setVoice(side: 'right' | 'left', patch: Partial<VoiceControl>): void;
  setSync(v: boolean): void;
  setMasterVolume(v: number): void;
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

export const useControls = create<ControlState>((set) => ({
  right: defaultVoice(DEFAULT_INSTRUMENT_RIGHT),
  left: defaultVoice(DEFAULT_INSTRUMENT_LEFT),
  syncHands: true,
  masterVolume: 0.4,
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
}));
