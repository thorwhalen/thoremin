/**
 * Beat-tracking metrics — a small port of the `mir_eval.beat` conventions (Davies,
 * Degara & Plumbley; research map §2.8) so the fixture tests score a gesture beat
 * tracker the way the MIR literature scores an audio one.
 *
 * - {@link fMeasure}: one-to-one matching within ±`window` (70 ms by default).
 * - {@link cemgil}: Gaussian-weighted accuracy with σ = 40 ms by default.
 * - {@link continuity}: the CMLt fraction — estimated beats whose timing AND inter-beat
 *   interval are within `tolerance` (17.5%) of the reference, counted over the whole
 *   sequence (the "total" variant; no leading-beat trim, no AML octave allowance).
 * - {@link fitGrid}: the reference grid for a clip with a STATED tempo and an unknown
 *   phase — the phase offset that maximises the F-measure. This is what makes the
 *   70 bpm conducting excerpts usable as ground truth without hand annotation.
 *
 * Pure functions over sorted arrays of seconds.
 */

const DEFAULT_WINDOW = 0.07;
const DEFAULT_SIGMA = 0.04;
const DEFAULT_TOLERANCE = 0.175;

function sorted(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

/** Greedy one-to-one matching of estimates to references within ±window. */
function matchCount(ref: readonly number[], est: readonly number[], window: number): number {
  const R = sorted(ref);
  const E = sorted(est);
  let i = 0;
  let j = 0;
  let matched = 0;
  while (i < R.length && j < E.length) {
    const d = E[j] - R[i];
    if (Math.abs(d) <= window) {
      matched++;
      i++;
      j++;
    } else if (d < 0) j++;
    else i++;
  }
  return matched;
}

export function fMeasure(ref: readonly number[], est: readonly number[], window = DEFAULT_WINDOW): number {
  if (ref.length === 0 && est.length === 0) return 1;
  if (ref.length === 0 || est.length === 0) return 0;
  const m = matchCount(ref, est, window);
  const precision = m / est.length;
  const recall = m / ref.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

export function cemgil(ref: readonly number[], est: readonly number[], sigma = DEFAULT_SIGMA): number {
  if (ref.length === 0 || est.length === 0) return 0;
  let acc = 0;
  for (const r of ref) {
    let best = 0;
    for (const e of est) {
      const w = Math.exp(-((e - r) ** 2) / (2 * sigma * sigma));
      if (w > best) best = w;
    }
    acc += best;
  }
  return acc / ((ref.length + est.length) / 2);
}

/** CMLt: the fraction of reference beats that have an estimate within `tolerance` of
 *  the local reference inter-beat interval in BOTH phase and period. */
export function continuity(ref: readonly number[], est: readonly number[], tolerance = DEFAULT_TOLERANCE): number {
  const R = sorted(ref);
  const E = sorted(est);
  if (R.length < 2 || E.length < 2) return 0;
  let ok = 0;
  for (let i = 1; i < R.length; i++) {
    const ibi = R[i] - R[i - 1];
    // Nearest estimate to R[i] and to R[i-1].
    const j = nearestIndex(E, R[i]);
    const phaseOk = Math.abs(E[j] - R[i]) <= tolerance * ibi;
    const estIbi = j > 0 ? E[j] - E[j - 1] : NaN;
    const periodOk = Number.isFinite(estIbi) && Math.abs(estIbi - ibi) <= tolerance * ibi;
    if (phaseOk && periodOk) ok++;
  }
  return ok / (R.length - 1);
}

function nearestIndex(xs: readonly number[], v: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface GridFit {
  /** The reference beat times. */
  grid: number[];
  /** The phase offset (seconds, 0..period) that was chosen. */
  offset: number;
  fMeasure: number;
}

/**
 * Build the reference grid for a clip conducted at a STATED tempo: beats every
 * `60 / bpm` seconds from `start` to `end`, at the phase offset that best matches the
 * estimates (a search over `steps` offsets within one period). The estimates are only
 * used to pick the offset; the tempo is not fitted, which is the point.
 */
export function fitGrid(est: readonly number[], bpm: number, start: number, end: number, steps = 64, window = DEFAULT_WINDOW): GridFit {
  const period = 60 / bpm;
  let best: GridFit = { grid: [], offset: 0, fMeasure: -1 };
  let bestScore = -Infinity;
  for (let k = 0; k < steps; k++) {
    const offset = (k / steps) * period;
    const grid: number[] = [];
    for (let t = start + offset; t <= end; t += period) grid.push(t);
    const f = fMeasure(grid, est, window);
    // Ties in F (a whole run of offsets matches the same beats) are broken by the mean
    // absolute matched error, so the chosen phase is the centre of the run, not its edge.
    const score = f - 1e-3 * (meanMatchedError(grid, est, window) / window);
    if (score > bestScore) {
      bestScore = score;
      best = { grid, offset, fMeasure: f };
    }
  }
  return best;
}

function meanMatchedError(ref: readonly number[], est: readonly number[], window: number): number {
  let sum = 0;
  let n = 0;
  for (const r of ref) {
    let bestD = Infinity;
    for (const e of est) bestD = Math.min(bestD, Math.abs(e - r));
    if (bestD <= window) {
      sum += bestD;
      n++;
    }
  }
  return n ? sum / n : window;
}

/** Median inter-onset interval of a sorted-or-not list of times. NaN below two. */
export function medianInterval(times: readonly number[]): number {
  const T = sorted(times);
  if (T.length < 2) return NaN;
  const d = T.slice(1).map((t, i) => t - T[i]);
  d.sort((a, b) => a - b);
  const m = d.length >> 1;
  return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
}
