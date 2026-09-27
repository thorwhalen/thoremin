/**
 * Timing magnetism — pull an event toward the rhythm prior's grid, by a strength.
 *
 * The third objective of `docs/research/intent-and-subframe-timing.md` §3: after
 * *actuality* (when the impact really happened, the predictor's job) and *intent*
 * (when the player meant it, which the prior's expected beat estimates) comes
 * *sounding good*, and the instrument's job is to make the trade between them a dial
 * rather than a fixed choice. This is the rhythmic twin of `magneticPitch` in
 * `src/music/theory.ts`: a DAW's quantise strength, applied live.
 *
 * `magnetise(t, state, magnetism)` moves an event time `t` toward the NEAREST beat
 * the prior expects (`grid`), by `magnetism` (0 = leave it, 1 = as far as the gate
 * allows), where the gate is the prior's attentional window: an event far from any
 * expected beat is not a beat the prior knows about, and is left alone (Large and
 * Jones's attentional pulse; the same gate the oscillator uses on its own
 * corrections). The gate also scales with the prior's confidence, so a follower that
 * has not locked pulls nothing. Nothing here is a measurement: the prior's grid is a
 * PRIOR, and what comes out is what the instrument chooses to sound, which the
 * research map (§6) keeps separate from what it inferred.
 *
 * Pure. The prior is read, never updated: confirming the event is the caller's job.
 */
import type { MusicalTime } from './types';

export interface MagnetResult {
  /** The time to sound: `t` pulled toward `grid`. */
  t: number;
  /** The nearest expected beat time (the intent estimate); NaN when the prior has no
   *  grid (not running). */
  grid: number;
  /** `t_out - t_in`, seconds. */
  pull: number;
  /** The attentional gate that scaled the pull, 0..1. */
  gate: number;
}

export interface MagnetOptions {
  /** Half-width of the attentional window as a fraction of the period; the pull
   *  fades as a Gaussian over it. */
  windowFraction?: number;
  /** Scale the pull by the prior's confidence (default true). */
  useConfidence?: boolean;
}

const DEFAULTS: Required<MagnetOptions> = { windowFraction: 0.25, useConfidence: true };

/** The expected beat of `state` nearest to `t` (free-running the prior's phase). */
export function nearestExpectedBeat(state: MusicalTime, t: number): number {
  if (state.state !== 'running' || !(state.period > 0) || !Number.isFinite(state.period)) return NaN;
  const beatsAhead = (t - state.t) / state.period;
  const k = Math.round(state.phase + beatsAhead);
  return state.t + (k - state.phase) * state.period;
}

export function magnetise(t: number, state: MusicalTime, magnetism: number, options: MagnetOptions = {}): MagnetResult {
  const o = { ...DEFAULTS, ...options };
  const grid = nearestExpectedBeat(state, t);
  if (!Number.isFinite(grid) || !(magnetism > 0)) return { t, grid, pull: 0, gate: 0 };
  const window = o.windowFraction * state.period;
  const dist = (t - grid) / window;
  let gate = Math.exp(-0.5 * dist * dist);
  if (o.useConfidence) gate *= Math.max(0, Math.min(1, state.confidence));
  const pull = Math.max(0, Math.min(1, magnetism)) * gate * (grid - t);
  return { t: t + pull, grid, pull, gate };
}
