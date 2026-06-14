/**
 * Zustand control store — the single source of truth for live UI controls.
 * The React control panel writes here; the `store-controls` DAG node reads
 * `getState()` each tick and emits the values onto the graph as port values.
 * This keeps UI state out of the graph spec, so changing scale/instrument
 * never rebuilds the engine or reloads the ML model.
 */
import { create } from 'zustand';
import type { ScaleTypeId } from '@/music/theory';
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
  type: 'major',
  octaves: 2,
  baseOctave: 3,
  instrument,
});

export const useControls = create<ControlState>((set) => ({
  right: defaultVoice('sine'),
  left: defaultVoice('triangle'),
  syncHands: true,
  masterVolume: 0.2,
  setVoice: (side, patch) =>
    set((s) => {
      const next = { ...s[side], ...patch };
      if (s.syncHands) {
        // When synced, both hands share settings (instrument kept distinct).
        return {
          right: { ...next, instrument: s.right.instrument },
          left: { ...next, instrument: s.left.instrument },
        };
      }
      return { [side]: next } as Pick<ControlState, 'right' | 'left'>;
    }),
  setSync: (v) => set({ syncHands: v }),
  setMasterVolume: (v) => set({ masterVolume: v }),
}));
