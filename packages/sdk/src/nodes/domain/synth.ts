/**
 * The synthesis parameters on the DAG's edges: one voice's and the synth's. Part of the
 * domain types (`../domain.ts` re-exports it).
 */
import type { SoundId } from '../../music/sounds';

/** Synthesis parameters for one voice. */
export interface VoiceParams {
  /** Stable voice id (0 = right, 1 = left, by convention). */
  id: number;
  present: boolean;
  freq: number;
  gain: number;
  /** Instrument timbre — an id from the {@link SoundId} registry. */
  sound: SoundId;
  /**
   * Live tone brightness, 0 (dark/mellow) .. 1 (open/present). Drives a
   * per-voice low-pass in the synth so gestures (e.g. hand openness) shape
   * timbre expressively. Optional; absent is treated as 1 (fully open).
   */
  brightness?: number;
  /**
   * Live vibrato amount, 0 (none) .. 1 (full). Adds pitch wobble on top of any
   * preset vibrato, so gestures (e.g. pinch) add expression. Optional; absent
   * is treated as 0 (no added vibrato).
   */
  vibrato?: number;
  /**
   * Stereo pan, -1 (hard left) .. +1 (hard right). Lets hand position place the
   * voice in the stereo field. Optional; absent is treated as 0 (centre).
   */
  pan?: number;
}

export interface SynthParams {
  voices: VoiceParams[];
}
