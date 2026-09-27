/**
 * Dynamics and articulation from the strokes — stateless with respect to time, per-user
 * by construction.
 *
 * Gesture size mapped to loudness is universal across conducting systems, and the one
 * multi-subject study of it (Sarasúa & Guaus, research map §1.5) found that pooled
 * models fit individuals badly: what counts as "big" is the player's own range. So both
 * estimates here are relative to exponentially weighted statistics of the player's own
 * recent strokes, the same idea `src/features/ewMoments.ts` and `src/enroll/noise.ts`
 * apply to features — nothing absolute, no calibration step.
 *
 * - `dynamics` (0..1): the stroke's amplitude over the recent envelope, as the detector
 *   already reports it in `Anchor.strength`, smoothed across strokes so a single
 *   accented beat reads as an accent, not a new dynamic level.
 * - `articulation` (0..1): the braking sharpness (`Anchor.sharpness`) against the
 *   player's running median-ish sharpness — the legato ↔ staccato axis. 0.5 is the
 *   player's own usual stroke; above it the beat "clicked", below it flowed.
 *
 * Both are read by the conductor node and sent on to the orchestra as expression (CC11)
 * and articulation selection. A NaN sharpness (an unmeasurable stroke) leaves the
 * articulation estimate untouched rather than poisoning it.
 */
import type { Anchor } from './types';

export interface DynamicsOptions {
  /** Smoothing across strokes, 0..1 (1 = no smoothing). */
  dynamicsGain?: number;
  /** Smoothing of the sharpness reference, 0..1. */
  sharpnessGain?: number;
  /** How far above/below the reference sharpness maps to 1 / 0 (log2 ratio). */
  sharpnessSpan?: number;
}

const DEFAULTS: Required<DynamicsOptions> = { dynamicsGain: 0.6, sharpnessGain: 0.2, sharpnessSpan: 1.5 };

export interface DynamicsEstimate {
  dynamics: number;
  articulation: number;
}

export interface DynamicsEstimator {
  update(anchor: Anchor): DynamicsEstimate;
  current(): DynamicsEstimate;
  reset(): void;
}

export function createDynamicsEstimator(options: DynamicsOptions = {}): DynamicsEstimator {
  const o = { ...DEFAULTS, ...options };
  let dynamics = 0.5;
  let articulation = 0.5;
  let sharpnessRef = NaN;

  return {
    update(a) {
      const s = Math.max(0, Math.min(1, a.strength));
      dynamics += o.dynamicsGain * (s - dynamics);
      if (Number.isFinite(a.sharpness) && a.sharpness > 0) {
        if (!Number.isFinite(sharpnessRef)) sharpnessRef = a.sharpness;
        else sharpnessRef += o.sharpnessGain * (a.sharpness - sharpnessRef);
        const ratio = Math.log2(a.sharpness / sharpnessRef);
        articulation = Math.max(0, Math.min(1, 0.5 + ratio / (2 * o.sharpnessSpan)));
      }
      return { dynamics, articulation };
    },
    current: () => ({ dynamics, articulation }),
    reset() {
      dynamics = 0.5;
      articulation = 0.5;
      sharpnessRef = NaN;
    },
  };
}
