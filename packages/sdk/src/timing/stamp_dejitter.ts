/**
 * A GATED, causal de-jitter for frame capture stamps (step 9 of the 2026-10-05 timing
 * plan; the stamp-less half of #226).
 *
 * The problem it solves. Where a browser hands the frame pump no capture time, the
 * pump stamps a frame from the clock at the moment it noticed the frame (`clock`), or
 * from that clock minus the lag the capture stamps taught it (`estimated`). Both carry
 * the pipeline's jitter — the probe measures 2.8 ms of it on Chromium, and a slow
 * machine more — and a sub-frame estimator is exactly the consumer that cannot take it:
 * on the synthetic bench 4 ms of stamp noise costs the known-plane prediction 70 % of
 * its precision (`docs/research/subframe-impact-prediction.md` §3.4). A camera, though,
 * is a regular clock: its frames sit on a grid, so a least-squares line of stamp against
 * frame index over a short window recovers that grid from the jittered readings, and
 * only the frame INDEX has to be inferred: the gap over the period, rounded, so a frame
 * inference was too busy for — the 33 / 67 ms pacing of a slow laptop — costs one
 * index, not a bent line. The period itself is found by a small search: the seed is a
 * low quantile of the run's gaps (a skipped frame only ever lengthens a gap, so a 33 /
 * 67 stream seeds at 33, where a seed from the first gap alone read a 50 ms camera) and
 * the mean gap (a camera beating against a display's vsync alternates gaps around its period),
 * tried over 1 to 4 frames per seed (a 60 fps camera paced by inference shows gaps of
 * two and three frames, so the lattice is finer than any gap); a candidate counts only
 * when its residual is a small fraction of its period (a lattice finer than the noise
 * absorbs it into the indices and leaves about a quarter of a period), and of those the
 * smallest residual wins, near-ties to the coarser. A handful of candidates, never a
 * scan: among hundreds of periods finer than the noise one always fits by chance. Once
 * found, the fitted slope carries the index forward; the search runs again on every
 * frame, and the carried lattice is kept while it still counts and the search does not
 * beat it clearly.
 *
 * WHY THE GATE EXISTS. A capture stamp (`tSource: 'capture'`) is the camera's own time
 * for THAT frame, and an irregular camera reported truthfully is what #225 / #226 made
 * authoritative: the bench shows it costs a predictor nothing (§3.4), and a line fitted
 * through it would replace a measurement with its average — on truthful irregular
 * capture the ungated line costs 7.5 → 8.2 ms of prediction spread (the plan's 30 fps
 * red-team). De-jittering a capture stamp would undo #226. So the de-jitter engages
 * only on a run of stamps from a source that is a CLOCK READING rather than the
 * camera's (`clock`, `estimated`), and only once that run shows jitter worth removing:
 * stamps that already sit on a grid — a regular test clock, vsync-regular readings, a
 * capture time rounded to 1 ms (WebKit), or sample-and-hold pairs polled at a jitter-free
 * display rate (the bench's `raf-poll` regime) — pass through unchanged. Nothing here
 * detects sample-and-hold as such: it is the jitter floor that keeps the gate shut on a
 * clean vsync, and a poll whose stamps carried jitter would engage. That case is gone
 * from the pump itself (it no longer delivers a held frame twice: `presentedFrames`). Everything else is a pass-through too, byte for byte: a frame that
 * carries a `capture` or `presentation` stamp is never touched, and it ends the run, so
 * the window never mixes two time bases (a `clock` stamp after a hidden tab sits a lag
 * later than the capture stamps before it; a line across that step would be bent).
 *
 * Shape. Pure and causal: one stamp in, one stamp out. A replaced stamp is the line's
 * value at the frame's index, never earlier than the previous output plus the minimum
 * step (the consumer, MediaPipe, requires strictly increasing whole milliseconds); a
 * pass-through is the input itself, so the raw stream's monotonicity is the caller's
 * contract, which the pump's `pickFrameStamp` provides. The line is used as it is, not
 * capped at the raw reading: the reading is an upper bound on the CAPTURE, but the line
 * estimates the grid plus the pipeline's mean offset, which the reading bounds the wrong
 * way, and capping keeps the late half of the noise (on the bench's stamp-noise regime
 * the known-plane prediction's spread is 6.5 ms capped and 4.6 ms with the line itself,
 * against 4.3 with exact stamps; `docs/research/subframe-impact-prediction.md` §3.4.1;
 * `clampToRaw` keeps the capped rule for comparison). So a
 * de-jittered stamp may sit a few milliseconds past the clock reading that noticed the
 * frame, and its lag then reads slightly negative; nothing downstream needs the lag to
 * be positive (the timing resource floors a frame's age at 0). The output's
 * SOURCE is the input's: a smoothed clock reading is still a clock reading, so the
 * timing resource's `tSource` mix keeps saying "no capture stamps here" and a consumer
 * keeps adding the learned lag; the de-jitter removes jitter, not the pipeline's offset.
 * `retract()` undoes the latest push for a frame the consumer refused (the pump offers
 * it again with a later clock reading, which would otherwise be a second frame).
 */
import { olsLine, quantile } from '@thoremin/stats';
import type { FrameTiming } from '../nodes/domain';

export type DejitterStampSource = NonNullable<FrameTiming['tSource']>;

/** The line is fitted over this many of the latest stamps: one second of a 30 fps
 *  camera, long enough to average 4 ms of noise down to under a millisecond and short
 *  enough to follow a camera whose rate changes (auto-exposure in low light). */
export const DEJITTER_WINDOW_FRAMES = 30;
/** No line is fitted through fewer stamps than this: four points and one outlier are
 *  a slope, not a grid. */
export const DEJITTER_MIN_FRAMES = 5;
/** The gate's jitter floor (ms): the stamps' residual sd about the fitted line must
 *  reach it before any stamp is replaced. A 1 ms-rounded capture time has sd 0.29 ms,
 *  vsync-regular readings under 0.5 ms; the pipeline's jitter measures 2.8 ms on
 *  Chromium and the bench's stamp-noise regime is 4 ms. */
export const DEJITTER_MIN_JITTER_MS = 1;
/** The smallest step between two output stamps (ms): MediaPipe works in whole
 *  milliseconds and requires them to increase. The same as the pump's step. */
export const DEJITTER_MIN_STEP_MS = 1;
/** The lattice search seeds the camera's period from two readings of the run's gaps.
 *  This low quantile, because a skipped frame only ever makes a gap LONGER (a 33 / 67 ms
 *  pacing has its 20th percentile at 33), while noise spreads the gaps both ways; and the
 *  mean gap, because a camera delivered on a display's vsync alternates shorter and
 *  longer gaps around its own period (30 fps on 75 Hz: 27 and 40 ms, mean 33), where the
 *  low seed has no divisor near the camera's period and a 22 ms lattice fits the beat
 *  pattern instead. */
export const LATTICE_SEED_QUANTILE = 0.2;
/** The seed may itself be several camera periods: a 60 fps camera paced by a 45 ms
 *  inference shows gaps of two and three frames and never one. The search tries the seed
 *  divided by 1, 2, ... up to this, coarsest first. */
export const LATTICE_MAX_FRAMES_PER_GAP = 4;
/** Re-index against the fitted period at most this many times per candidate. */
export const LATTICE_REFINE_PASSES = 3;
/** A fit whose residual exceeds this fraction of its period is not the camera's lattice:
 *  either the indices are wrong (a 33 / 50 ms pacing read on a 33 ms lattice, where every
 *  50 ms gap rounds to one step or two at random), or the period is finer than the noise
 *  and the indices absorbed it (that leaves about a quarter of a period). 4 ms of noise
 *  on a 33 ms camera is 0.12, 2 ms on a 17 ms one the same. With no candidate under it
 *  the run passes through unchanged: 4 ms of noise on a 60 fps camera cannot be told from
 *  the camera's own grid. */
export const LATTICE_MAX_RELATIVE_RESIDUAL = 0.15;
/** The carried lattice is replaced when a fresh search explains the run with a residual
 *  this much smaller (ms): a fraction, so a near-tie keeps the lattice in hand. */
export const LATTICE_TIE_FRACTION = 0.1;
/** The frame rates a camera delivers, fps: a fitted lattice is the camera's only when its
 *  period is one of these (within {@link CAMERA_RATE_TOLERANCE}). Stamps alone cannot tell
 *  a 60 fps camera paced to 33 / 50 ms gaps from a 30 fps camera beating against a 75 Hz
 *  display (27 / 40 ms gaps): both are a two-to-three alternation, fitted exactly by a
 *  lattice at a fifth of their sum. What separates them is that 16.7 ms is a camera's
 *  period and 22 ms (45 fps) is not. Nothing is finer than 60 fps either: periodic or
 *  one-sided delivery noise is fitted well by a lattice a quarter of the camera's period
 *  (a repeating eight-frame jitter of 2 ms held a 7.4 ms lattice on a 33 ms camera). A
 *  run whose lattice is none of these passes through. */
export const CAMERA_RATES_FPS: readonly number[] = [5, 7.5, 10, 12, 15, 20, 24, 25, 30, 50, 60];
/** How far a fitted period may sit from a camera rate's period (fraction): 29.97 and
 *  59.94 fps are within it, and so is a camera clock a little off its nominal rate. */
export const CAMERA_RATE_TOLERANCE = 0.03;
/** A FINER lattice replaces a coarser one only when its residual is smaller by this
 *  factor. A lattice finer than the camera's soaks part of the noise into its indices
 *  (one-sided or periodic delivery noise most of all), so a small gain is what noise
 *  buys; a real sub-lattice (a 60 fps camera paced to 33 / 50 ms gaps) removes the
 *  pacing's sawtooth and gains more than half again. */
export const LATTICE_FINER_GAIN = 1.5;
/** Two fits whose periods differ by less than this fraction are the same lattice. */
export const LATTICE_SAME_FRACTION = 0.1;
/** A stamp further than this fraction of a period from where the run's line puts it is
 *  an outlier (a delivery spike, a stall): it passes through, unsmoothed, and stays out
 *  of the run, because its index cannot be told (half a period off is a frame either
 *  way), and a line bent to it would move its neighbours by most of a frame. */
export const DEJITTER_OUTLIER_FRACTION = 0.5;
/** This many outliers in a row are not spikes but a camera that changed: the run
 *  restarts from the latest stamp. */
export const DEJITTER_OUTLIERS_TO_RESTART = 3;
/** The sources the de-jitter may engage on: clock readings, not the camera's time. A
 *  `presentation` stamp is the compositor's own time for that frame (a measurement,
 *  jittered or not), so it passes through like a capture stamp. */
export const DEJITTERED_SOURCES: readonly DejitterStampSource[] = ['clock', 'estimated'];

export interface StampDejitterOptions {
  /** See {@link DEJITTER_WINDOW_FRAMES}. */
  windowFrames?: number;
  /** See {@link DEJITTER_MIN_FRAMES}. */
  minFrames?: number;
  /** See {@link DEJITTER_MIN_JITTER_MS}. 0 opens the gate on any run of the sources. */
  minJitterMs?: number;
  /** See {@link DEJITTER_MIN_STEP_MS}. */
  minStepMs?: number;
  /** See {@link DEJITTERED_SOURCES}. */
  sources?: readonly DejitterStampSource[];
  /** Cap every output at its raw stamp (default false: see the header for why the
   *  line as it is beats the capped one on the bench). */
  clampToRaw?: boolean;
}

export interface DejitteredStamp {
  /** The output stamp, ms, in the input's time base. */
  tMs: number;
  /** The input's source, unchanged. */
  source: DejitterStampSource;
  /** Whether the line replaced the raw stamp on this frame. */
  engaged: boolean;
}

export interface StampDejitterState {
  /** Stamps in the current run (the window holds at most `windowFrames` of them). */
  frames: number;
  /** The fitted period, ms (the line's slope per frame index); NaN before a fit. */
  periodMs: number;
  /** The run's residual sd about the line, ms; NaN before a fit. */
  jitterMs: number;
  /** Whether the latest push was replaced by the line. */
  engaged: boolean;
}

export interface StampDejitter {
  /** One stamp in, one out. Records the stamp; see `retract`. */
  push(tMs: number, source: DejitterStampSource): DejitteredStamp;
  /** Undo the latest push: the frame it stamped was not consumed. A no-op with
   *  nothing to undo. */
  retract(): void;
  state(): StampDejitterState;
  /** Forget the run (a new source on the element). The output floor is kept, so
   *  stamps keep increasing across it. */
  reset(): void;
}

interface Fit {
  /** Stamp at index 0, ms. */
  intercept: number;
  /** Ms per frame index. */
  slope: number;
  /** Residual sd, ms. */
  residualSd: number;
}

/** Ordinary least squares of stamp on frame index; null with a degenerate index
 *  spread or a non-positive slope. */
function fitLine(indices: readonly number[], stamps: readonly number[]): Fit | null {
  const line = olsLine(indices, stamps);
  if (!line || !Number.isFinite(line.slope) || !(line.slope > 0)) return null;
  // Two parameters were fitted; the residual sd is over the remaining freedom.
  return { intercept: line.intercept, slope: line.slope, residualSd: Math.sqrt(line.rss / Math.max(1, line.n - 2)) };
}

/** The index of every stamp on a lattice of `periodMs`: each gap over the period,
 *  rounded, never less than one step. Gap by gap, so a candidate a little off the camera's
 *  period never drifts by a whole period over the window. */
function indexOnLattice(stamps: readonly number[], periodMs: number): number[] {
  const out = [0];
  for (let k = 1; k < stamps.length; k++) out.push(out[k - 1] + Math.max(1, Math.round((stamps[k] - stamps[k - 1]) / periodMs)));
  return out;
}

/** A candidate period's lattice: index the run, fit, and re-index on the fitted period
 *  (which corrects the candidate's own error) until the indices settle. */
function latticeFit(stamps: readonly number[], periodMs: number): { indices: number[]; fit: Fit } | null {
  let indices = indexOnLattice(stamps, periodMs);
  let fit = fitLine(indices, stamps);
  for (let pass = 0; fit && pass < LATTICE_REFINE_PASSES; pass++) {
    const next = indexOnLattice(stamps, fit.slope);
    if (next.every((v, k) => v === indices[k])) break;
    indices = next;
    fit = fitLine(indices, stamps);
  }
  return fit ? { indices, fit } : null;
}

/** Whether fit `a` is to be preferred to fit `b`. The same lattice: the smaller residual,
 *  by the tie fraction (so the one in hand stays on a near-tie). Different lattices: the
 *  coarser, unless the finer explains the run better by {@link LATTICE_FINER_GAIN}. */
function preferred(a: Fit, b: Fit): boolean {
  if (Math.abs(a.slope - b.slope) <= LATTICE_SAME_FRACTION * Math.max(a.slope, b.slope)) return a.residualSd < (1 - LATTICE_TIE_FRACTION) * b.residualSd - 1e-9 * b.slope;
  if (a.slope > b.slope) return !(LATTICE_FINER_GAIN * b.residualSd < a.residualSd);
  return LATTICE_FINER_GAIN * a.residualSd < b.residualSd;
}

/** Whether a period is a camera's; see {@link CAMERA_RATES_FPS}. */
const isCameraPeriod = (periodMs: number) => CAMERA_RATES_FPS.some((fps) => Math.abs(periodMs * fps / 1000 - 1) <= CAMERA_RATE_TOLERANCE);

/** Whether a fit is the camera's lattice; see {@link LATTICE_MAX_RELATIVE_RESIDUAL}. */
const admissible = (f: Fit) => f.residualSd <= LATTICE_MAX_RELATIVE_RESIDUAL * f.slope;

/** The camera's lattice under the run: the seed period (a low quantile of the gaps) over
 *  1, 2, ... frames per seed; of the admissible ones the coarsest, unless a finer one
 *  explains the run clearly better (see {@link preferred}: a sub-multiple of the camera's
 *  lattice fits as well as the lattice itself, every index doubled, and soaks up part of
 *  the noise besides; a 33 / 50 ms pacing read as one and two steps of 28 ms leaves a
 *  sawtooth that only the 17 ms lattice removes). A handful of candidates, not a
 *  scan of periods: over a short window, among hundreds of periods finer than the noise,
 *  one always fits by chance. Null when none is admissible. */
function searchLattice(stamps: readonly number[]): { indices: number[]; fit: Fit } | null {
  const gaps = stamps.slice(1).map((t, k) => t - stamps[k]).filter((g) => g > 0);
  if (gaps.length < 2) return null;
  // The low quantile (the real gap at or below it), and the mean gap (see LATTICE_SEED_QUANTILE).
  const seeds = [quantile(gaps, LATTICE_SEED_QUANTILE, { index: 'floor' }), (stamps[stamps.length - 1] - stamps[0]) / (stamps.length - 1)];
  let best: { indices: number[]; fit: Fit } | null = null;
  const minPeriod = (1000 / Math.max(...CAMERA_RATES_FPS)) * (1 - CAMERA_RATE_TOLERANCE);
  for (const seed of seeds)
    for (let frames = 1; frames <= LATTICE_MAX_FRAMES_PER_GAP && seed / frames >= minPeriod; frames++) {
      const cand = latticeFit(stamps, seed / frames);
      if (cand && isCameraPeriod(cand.fit.slope) && admissible(cand.fit) && (!best || preferred(cand.fit, best.fit))) best = cand;
    }
  return best;
}

export function createStampDejitter(options: StampDejitterOptions = {}): StampDejitter {
  const windowFrames = options.windowFrames ?? DEJITTER_WINDOW_FRAMES;
  const minFrames = options.minFrames ?? DEJITTER_MIN_FRAMES;
  const minJitterMs = options.minJitterMs ?? DEJITTER_MIN_JITTER_MS;
  const minStepMs = options.minStepMs ?? DEJITTER_MIN_STEP_MS;
  const sources = new Set(options.sources ?? DEJITTERED_SOURCES);
  const clampToRaw = options.clampToRaw ?? false;
  if (!(windowFrames >= 2)) throw new RangeError(`stamp de-jitter: windowFrames must be at least 2, got ${windowFrames}`);
  if (!(minFrames >= 3 && minFrames <= windowFrames)) throw new RangeError(`stamp de-jitter: minFrames must be in 3..windowFrames, got ${minFrames}`);

  /** The current run: raw stamps from one source, and their frame index on the lattice. */
  let stamps: number[] = [];
  let indices: number[] = [];
  let runSource: DejitterStampSource | null = null;
  let fit: Fit | null = null;
  /** The latest output; -Infinity before any. Kept across runs and resets. */
  let lastOut = -Infinity;
  let lastEngaged = false;
  /** Consecutive outliers against the run's line. */
  let outliers = 0;
  /** What the latest push replaced, for `retract`. */
  let undo: { stamps: number[]; indices: number[]; runSource: DejitterStampSource | null; fit: Fit | null; lastOut: number; lastEngaged: boolean; outliers: number } | null = null;

  const snapshot = () => ({ stamps: stamps.slice(), indices: indices.slice(), runSource, fit, lastOut, lastEngaged, outliers });

  /** Fit the run: carry the index forward on the lattice in hand, and search afresh too;
   *  the carried lattice stays while it is admissible and the search does not explain the
   *  run clearly better (the first frames of a run can settle on a lattice the rest of it
   *  refutes). The search is a handful of candidates over the window. */
  const refit = () => {
    if (stamps.length < minFrames) {
      fit = null;
      return;
    }
    let carried: Fit | null = null;
    if (fit) {
      const n = stamps.length;
      indices[n - 1] = indices[n - 2] + Math.max(1, Math.round((stamps[n - 1] - stamps[n - 2]) / fit.slope));
      carried = fitLine(indices, stamps);
    }
    const found = searchLattice(stamps);
    if (carried && isCameraPeriod(carried.slope) && admissible(carried) && !(found && preferred(found.fit, carried))) fit = carried;
    else if (found) ({ indices, fit } = found);
    else fit = null;
  };

  return {
    push(tMs, source) {
      undo = snapshot();
      const gated = sources.has(source);
      if (!gated || source !== runSource) {
        // A pass-through stamp ends the run; a new source starts one.
        stamps = [];
        indices = [];
        runSource = gated ? source : null;
        fit = null;
      }
      let out = tMs;
      let engaged = false;
      if (gated) {
        // An outlier against the line in hand passes through and stays out of the run.
        let outlier = false;
        if (fit && stamps.length) {
          const n = stamps.length;
          const k = indices[n - 1] + Math.max(1, Math.round((tMs - stamps[n - 1]) / fit.slope));
          outlier = Math.abs(fit.intercept + fit.slope * k - tMs) > DEJITTER_OUTLIER_FRACTION * fit.slope;
        }
        if (outlier && ++outliers < DEJITTER_OUTLIERS_TO_RESTART) {
          // Passed through below (floored); the run is left as it was.
        } else {
          if (outlier) {
            stamps = [];
            indices = [];
            fit = null;
          }
          outliers = 0;
          stamps.push(tMs);
          indices.push(indices.length ? indices[indices.length - 1] + 1 : 0);
          if (stamps.length > windowFrames) {
            stamps.shift();
            indices.shift();
          }
          refit();
          if (fit && fit.residualSd >= minJitterMs) {
            const line = fit.intercept + fit.slope * indices[indices.length - 1];
            // The hard bound: never more than the outlier fraction of a period from the
            // reading itself, whatever the fit says.
            if (Math.abs(line - tMs) <= DEJITTER_OUTLIER_FRACTION * fit.slope) {
              out = clampToRaw ? Math.min(tMs, line) : line;
              engaged = true;
            }
          }
        }
      }
      // A clock-derived stamp is floored at the previous output plus the step: after a
      // replaced stamp, the next raw reading may sit below it (the line ran a little
      // ahead). A raw clock stream is increasing already, so this changes nothing on a
      // run that never engaged; a capture or presentation stamp is never touched (the
      // caller floors it: the pump's `pickFrameStamp`).
      if (gated && !(out >= lastOut + minStepMs)) out = lastOut + minStepMs;
      lastOut = out;
      lastEngaged = engaged;
      return { tMs: out, source, engaged };
    },
    retract() {
      if (!undo) return;
      ({ stamps, indices, runSource, fit, lastOut, lastEngaged, outliers } = undo);
      undo = null;
    },
    state() {
      return { frames: stamps.length, periodMs: fit ? fit.slope : NaN, jitterMs: fit ? fit.residualSd : NaN, engaged: lastEngaged };
    },
    reset() {
      stamps = [];
      indices = [];
      runSource = null;
      fit = null;
      lastEngaged = false;
      outliers = 0;
      undo = null;
    },
  };
}
