/**
 * How far a drawn landmark trails the fingertip it marks (#842, #817): the library half.
 *
 * The overlay draws the newest video frame, but the landmarks come from the frame inferred
 * earlier. Both see frames at the camera's capture times, so the gap is whole camera frames (the
 * frames that arrived while the model ran). While the hand moves, the dot is where the fingertip
 * WAS. With a recorded sweep as ground truth the offset is the distance the tip travels over that
 * gap. This does not measure the gap (a camera and the latency probe do, `?probe=latency`,
 * `smoke/latency/measure.mjs`): it turns a frame gap and a recorded motion into pixels, and says nothing a camera would add (sensor delay, display latency, perception).
 *
 * Held-frame mode (`?overlay.hold=hands`) draws the frame the landmarks were inferred on, so the
 * dot-to-tip offset is zero when the two are paired (the unit tests prove the key match; a camera
 * run proves the rest); the cost moves to the video, which then shows the same gap late.
 */

export interface TipSample {
  /** Seconds. */
  t: number;
  x: number;
  y: number;
}

export interface OffsetStats {
  samples: number;
  p50: number;
  p95: number;
  max: number;
}

/** The tip's position at time `t`, linearly interpolated between its samples (clamped at the ends). */
export function tipAt(samples: readonly TipSample[], t: number): { x: number; y: number } {
  if (samples.length === 0) throw new Error('tipAt: no samples');
  if (t <= samples[0]!.t) return samples[0]!;
  const last = samples[samples.length - 1]!;
  if (t >= last.t) return last;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo]!;
  const b = samples[hi]!;
  const f = (t - a.t) / (b.t - a.t);
  return { x: a.x + f * (b.x - a.x), y: a.y + f * (b.y - a.y) };
}

const quantile = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

/**
 * The distance (in the samples' own units, scaled by `scale`) between where the tip is at each
 * sample's time and where it was `lagS` earlier: the live-mode trail. Only samples with a full
 * lag of history count.
 */
export function trailOffset(samples: readonly TipSample[], lagS: number, scale = 1): OffsetStats {
  const d: number[] = [];
  for (const s of samples) {
    if (s.t - lagS < samples[0]!.t) continue;
    const then = tipAt(samples, s.t - lagS);
    d.push(Math.hypot(s.x - then.x, s.y - then.y) * scale);
  }
  if (d.length === 0) throw new Error('trailOffset: the recording is shorter than the lag');
  d.sort((a, b) => a - b);
  return { samples: d.length, p50: quantile(d, 0.5), p95: quantile(d, 0.95), max: d[d.length - 1]! };
}

/** The fingertip speed over the recording, units per second (a sense of how fast the sweep is). */
export function speed(samples: readonly TipSample[]): OffsetStats {
  const v: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    v.push(Math.hypot(b.x - a.x, b.y - a.y) / (b.t - a.t));
  }
  v.sort((a, b) => a - b);
  return { samples: v.length, p50: quantile(v, 0.5), p95: quantile(v, 0.95), max: v[v.length - 1]! };
}
