/**
 * The KTH final-ritard tempo prior (#333; the conducting research map §7.3, §6.4).
 *
 * Friberg and Sundberg measured stopping runners and the final ritardandi of performed music and
 * found the velocity falls as a power of the distance left: with `x` the fraction of the ritard
 * done (0 at its start, 1 at the end), the tempo relative to where it started is
 *
 *     v(x) = (1 + (w^q - 1) x)^(1 / q)
 *
 * with `w` the tempo reached at the end (relative to the start) and `q = 2` for the stopping
 * runner (a constant braking power: the velocity is the square root of the distance left, so a
 * ritard that ends at a stop, `w` near 0, has the square-root shape). It is a PROCESS MODEL for
 * the tempo follower: when the gesture is too uncertain to say the tempo (low confidence, an
 * occluded or hesitant hand into the cadence), the music slows the way a performer would
 * instead of running on at the last tempo or freezing; a confident gesture overrides it.
 *
 * Pure: a curve and a function of the beat. The caller supplies the tempo it started from and
 * where the piece ends.
 */

export const TEMPO_PRIORS = ['none', 'kth-final-ritard'] as const;
export type TempoPriorKind = (typeof TEMPO_PRIORS)[number];

export const KTH_RITARD_DEFAULTS = {
  /** The exponent: 2 is the stopping runner (square-root velocity). */
  q: 2,
  /** The tempo reached at the last beat, relative to the tempo the ritard starts from. */
  finalRatio: 0.35,
  /** How many beats before the end the ritard starts. */
  beats: 8,
} as const;

export interface KthRitardOptions {
  q?: number;
  finalRatio?: number;
  beats?: number;
}

/** The tempo relative to the start at fraction `x` (0..1) of the ritard. */
export function kthTempoRatio(x: number, { q = KTH_RITARD_DEFAULTS.q, finalRatio = KTH_RITARD_DEFAULTS.finalRatio }: Pick<KthRitardOptions, 'q' | 'finalRatio'> = {}): number {
  const t = Math.min(1, Math.max(0, x));
  const w = Math.min(1, Math.max(1e-3, finalRatio));
  const qq = q > 0 ? q : KTH_RITARD_DEFAULTS.q;
  return Math.pow(1 + (Math.pow(w, qq) - 1) * t, 1 / qq);
}

export interface FinalRitard {
  /**
   * The prior tempo (bpm) at `beat`, for a piece whose last beat is `endBeat`, from a tempo of
   * `startBpm` going into the ritard; null before the ritard begins (the prior has no opinion).
   */
  tempoAt(beat: number, endBeat: number, startBpm: number): number | null;
  /** The fraction (0..1) of the ritard done at `beat`, null before it begins. */
  progress(beat: number, endBeat: number): number | null;
}

export function createFinalRitard(options: KthRitardOptions = {}): FinalRitard {
  const o = { ...KTH_RITARD_DEFAULTS, ...options };
  const progress = (beat: number, endBeat: number): number | null => {
    if (!Number.isFinite(beat) || !Number.isFinite(endBeat) || !(o.beats > 0)) return null;
    // A piece shorter than the ritard is one ritard from its first beat, not one that starts
    // already slowed: the span never reaches before beat 0.
    const span = Math.min(o.beats, endBeat);
    if (!(span > 0)) return null;
    const from = endBeat - span;
    if (beat < from) return null;
    return Math.min(1, (beat - from) / span);
  };
  return {
    progress,
    tempoAt(beat, endBeat, startBpm) {
      const x = progress(beat, endBeat);
      if (x === null || !(startBpm > 0)) return null;
      return startBpm * kthTempoRatio(x, o);
    },
  };
}
