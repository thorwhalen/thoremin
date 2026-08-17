/**
 * Exponentially-weighted paired moments — ONE O(1)-per-frame estimator of the joint
 * statistics of two live signals, shared by everything in the Lab that needs them.
 *
 * It was extracted from the private `makeEwRegression` inside `formula.ts` (#131's
 * `residual` / `deconfound` helpers) when the rolling correlation view (#150) needed the
 * same update. Two copies of a moments recurrence is the kind of duplication that stays
 * correct for exactly as long as nobody touches either: they would drift the first time
 * one side changed its alpha, its seeding rule, or its guard, and the symptom would be
 * two numbers in the same panel quietly disagreeing about the same pair of features.
 *
 * The recurrence is West-style: deltas are taken against the PRE-update means, so the
 * covariance/variance accumulators stay consistent with the means at every step.
 *
 *   a    = 1 / max(2, window)
 *   dx   = x - mx ;  dz = z - mz          (pre-update means)
 *   mx  += a*dx   ;  mz += a*dz
 *   cxz  = (1-a) * (cxz + a*dx*dz)
 *   vz   = (1-a) * (vz  + a*dz*dz)        (and vx, symmetrically)
 *
 * From those: `beta() = cxz / vz` (the regression slope, for residualizing x on z) and
 * `corr() = cxz / sqrt(vx*vz)` (Pearson r over the same window, for the correlation
 * matrix). The correlation view is the reason `vx` is tracked at all — the regression
 * never needed it, and carrying it costs one multiply-add per frame.
 *
 * **Guards are load-bearing and must not be relaxed.** A non-finite `x`, `z`, or
 * `window` returns `'rejected'` and leaves the state COMPLETELY untouched. That is not
 * defensive habit: `window` is an input too (a formula may pass one that is absent this
 * frame, or `Infinity`, which is a silent never-learn), and a single NaN folded into an
 * exponentially-weighted accumulator poisons it PERMANENTLY — there is no amount of
 * subsequent good data that washes a NaN out. One bad frame would kill the estimator for
 * the rest of the session.
 *
 * Node-safe and pure state — no DOM, no clock, no allocation per update.
 */

/** What one {@link EwPair.update} did, so a caller can distinguish the three cases
 *  without inspecting the state: the input was refused, this was the seeding sample
 *  (no second moment exists yet), or the moments advanced. */
export type EwUpdateStatus = 'rejected' | 'seeded' | 'updated';

/** A running exponentially-weighted estimator over one PAIR of signals. */
export interface EwPair {
  /**
   * Fold one observation. `window` is in FRAMES and sets the smoothing
   * (`alpha = 1 / max(2, window)`). Returns what happened; on `'rejected'` no field of
   * the state has changed.
   */
  update(x: number, z: number, window: number): EwUpdateStatus;
  /** The regression slope of x on z (`cxz / vz`), or 0 while z carries no variance. */
  beta(): number;
  /** Pearson correlation over the window, or 0 while either signal is (near) constant.
   *  Clamped to [-1, 1]: the EW recurrence can overshoot by a rounding epsilon, and an
   *  |r| of 1.0000000002 turns into a NaN the moment anything takes its arccos. */
  corr(): number;
  /** The current EW mean of z (the recentring term a residual subtracts). */
  meanZ(): number;
  /** Has any observation been folded yet? */
  isSeeded(): boolean;
  /** Forget everything — the "recalibrate" path. */
  reset(): void;
}

/** Create a fresh paired estimator. State is per-instance; never share one across two
 *  logical pairs, or their statistics silently mix. */
export function makeEwPair(): EwPair {
  let mx = 0;
  let mz = 0;
  let cxz = 0;
  let vx = 0;
  let vz = 0;
  let seeded = false;

  return {
    update(x, z, window) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(window)) return 'rejected';
      if (!seeded) {
        mx = x;
        mz = z;
        seeded = true;
        return 'seeded';
      }
      const a = 1 / Math.max(2, window);
      const dx = x - mx; // deltas vs the PRE-update means (West-style EW moments)
      const dz = z - mz;
      mx += a * dx;
      mz += a * dz;
      cxz = (1 - a) * (cxz + a * dx * dz);
      vx = (1 - a) * (vx + a * dx * dx);
      vz = (1 - a) * (vz + a * dz * dz);
      return 'updated';
    },
    beta: () => (vz > 1e-12 ? cxz / vz : 0),
    corr: () => {
      const d = Math.sqrt(vx * vz);
      if (!(d > 1e-12)) return 0; // a constant signal has no correlation, not a NaN one
      const r = cxz / d;
      return r < -1 ? -1 : r > 1 ? 1 : r;
    },
    meanZ: () => mz,
    isSeeded: () => seeded,
    reset() {
      mx = 0;
      mz = 0;
      cxz = 0;
      vx = 0;
      vz = 0;
      seeded = false;
    },
  };
}
