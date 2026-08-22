/**
 * The still-point sampler (#160) — the front of the trainer pipeline, and the piece
 * that keeps the whole thing honest.
 *
 * ## Why this exists at all
 *
 * The obvious design is to record every frame of the enrollment take and cluster them.
 * That design fails, for a reason that is not obvious until you look at the data: **a
 * stream of someone "moving their face around" is mostly transitions.** Most frames are
 * on the path between expressions, so clustering all of them finds the centre of the
 * motion envelope — a set of blurry averages nobody can reproduce on purpose — rather
 * than the poses the player actually held.
 *
 * The literature's answer is to segment first: split a stream into *dynamic* and
 * *static* segments using velocity derived from the signal, and keep the static ones.
 * This is that, online and allocation-free per frame.
 *
 * ## The rule
 *
 * A still-point is emitted when the feature vector's rate of change stays below
 * `speedThreshold` for `dwellMs` continuously. The emitted vector is the **mean over the
 * dwell window**, not the single frame at the end of it — averaging a held pose is free
 * noise reduction, and the player was holding still by definition.
 *
 * **Speed is measured over a short WINDOW (`speedWindowMs`), not frame to frame.** This
 * was a real bug before it was a design note. A frame-to-frame difference is frame-rate
 * dependent in the worst way: a feature jittering +/-0.01 per frame is physically still,
 * yet reads as 1.2 units/second at 60 fps and 2.4 at 120 fps — so a threshold tuned on
 * one machine refuses to emit anything on a faster one, silently. Comparing against the
 * sample ~`speedWindowMs` ago measures actual displacement, so high-frequency jitter
 * cancels and the threshold means the same thing everywhere.
 *
 * After emitting, the sampler will not emit again until the vector has *moved away*
 * (exceeded the threshold) and settled somewhere new. Without that latch, holding a
 * pose for five seconds would emit fifty near-identical points and hand the clusterer a
 * dwell-time histogram instead of a vocabulary — the pose you happened to rest on
 * longest would dominate every cluster it touched.
 */
import type { FeatureVector, StepId, StillPoint } from './types';

export interface SamplerOptions {
  /**
   * Mean absolute per-feature change per second below which the vector counts as
   * "held". Features are expected to be roughly 0..1 (the catalog's normalized form),
   * so this is in normalized units per second.
   */
  speedThreshold?: number;
  /** How long the vector must stay slow before a point is emitted. */
  dwellMs?: number;
  /** Window over which displacement is measured. Long enough that per-frame jitter
   *  cancels, short enough to notice a real move promptly. */
  speedWindowMs?: number;
  /** Which ritual step to stamp emitted points with. */
  step?: StepId;
  /**
   * Minimum weighted distance from the previously emitted point before a new one may be
   * emitted. A second guard against near-duplicates when the player drifts slowly
   * between two very similar poses without ever crossing the speed threshold.
   */
  minSeparation?: number;
}

const DEFAULTS = {
  speedThreshold: 0.35,
  dwellMs: 220,
  speedWindowMs: 100,
  step: 'vocabulary' as StepId,
  minSeparation: 0.05,
};

/** Mean absolute difference per second between two vectors over `dtMs`. */
function speed(a: FeatureVector, b: FeatureVector, dtMs: number): number {
  if (dtMs <= 0) return 0;
  const keys = Object.keys(a);
  if (keys.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    // A feature reports NaN for "not measurable this frame"; it must not poison the
    // speed estimate (NaN would compare false against the threshold forever and the
    // sampler would silently never emit).
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sum += Math.abs(x - y);
    n += 1;
  }
  if (n === 0) return 0;
  return (sum / n) / (dtMs / 1000);
}

/** Mean absolute distance between two vectors over their shared finite features. */
export function meanAbsDistance(a: FeatureVector, b: FeatureVector): number {
  let sum = 0;
  let n = 0;
  for (const k of Object.keys(a)) {
    const x = a[k];
    const y = b[k];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sum += Math.abs(x - y);
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

export interface StillPointSampler {
  /** Feed one live frame. Returns a still-point on the tick one is completed. */
  push(vector: FeatureVector, tMs: number): StillPoint | null;
  /** Everything emitted so far. */
  points(): StillPoint[];
  /** Drop the captured points and reset the internal state. */
  reset(): void;
  /** True while the vector is currently slow enough to be accumulating a dwell. */
  isSettling(): boolean;
}

/**
 * Build a still-point sampler. Stateful (it has to be — dwell is temporal) but
 * self-contained: no clock of its own, no globals, `tMs` is supplied by the caller so
 * tests drive it deterministically.
 */
export function createStillPointSampler(options: SamplerOptions = {}): StillPointSampler {
  const o = { ...DEFAULTS, ...options };
  const captured: StillPoint[] = [];

  /** Recent frames, trimmed to just cover the speed window. */
  const history: { v: FeatureVector; t: number }[] = [];
  /** When the current slow run began, or null when moving. */
  let settlingSince: number | null = null;
  /** Running sum for the dwell-window mean. */
  let acc: Record<string, number> = {};
  let accN = 0;
  /** Set after an emit; cleared once the player moves again. */
  let armed = true;
  let lastEmitted: FeatureVector | null = null;

  const resetAccumulator = () => {
    acc = {};
    accN = 0;
  };

  return {
    push(vector, tMs) {
      history.push({ v: vector, t: tMs });
      // Keep one sample older than the window, and drop the rest.
      while (history.length > 2 && tMs - history[1].t >= o.speedWindowMs) history.shift();
      if (history.length < 2) return null;
      const ref = history[0];
      const dt = tMs - ref.t;
      // Not enough history to judge yet — do not guess "still".
      if (dt <= 0) return null;
      const v = speed(ref.v, vector, dt);

      if (v > o.speedThreshold) {
        // Moving: abandon any dwell in progress, and re-arm — the player has left the
        // pose they last gave us, so the next held pose is a genuinely new one.
        settlingSince = null;
        resetAccumulator();
        armed = true;
        return null;
      }

      // Slow this frame: accumulate toward the dwell mean.
      if (settlingSince === null) settlingSince = tMs;
      for (const k of Object.keys(vector)) {
        const x = vector[k];
        if (!Number.isFinite(x)) continue;
        acc[k] = (acc[k] ?? 0) + x;
      }
      accN += 1;

      if (!armed || tMs - settlingSince < o.dwellMs) return null;

      const mean: FeatureVector = {};
      for (const k of Object.keys(acc)) mean[k] = acc[k] / accN;

      if (lastEmitted && meanAbsDistance(mean, lastEmitted) < o.minSeparation) {
        // Too close to the last point to be a different pose. Stay disarmed rather than
        // emitting a near-duplicate; the player has to actually move somewhere new.
        armed = false;
        return null;
      }

      const point: StillPoint = { vector: mean, t: settlingSince, step: o.step };
      captured.push(point);
      lastEmitted = mean;
      armed = false;
      resetAccumulator();
      settlingSince = null;
      return point;
    },
    points: () => captured.slice(),
    reset() {
      captured.length = 0;
      history.length = 0;
      settlingSince = null;
      resetAccumulator();
      armed = true;
      lastEmitted = null;
    },
    isSettling: () => settlingSince !== null,
  };
}
