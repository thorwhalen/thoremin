/**
 * Latency calibration: the one constant a game must know before it can judge anyone.
 *
 * Between a sound in the room and the time stamped on it in the page there is an input latency
 * (microphone, converter, OS buffers, the AudioContext's own); between a scheduled click and the
 * click in the room there is an output latency. A game that judges the player against its own
 * music needs their SUM (the round trip) when the player follows what they hear, and the input
 * latency alone when the targets are on a clock the player cannot hear (a score's tempo). Two
 * takes estimate them, the ones Rock Band, Rocksmith and Yousician use:
 *
 * - **tap along** (`estimateOffset(clicks, taps)`): the game plays clicks, the player taps or
 *   claps on them, the microphone stamps the taps. The offset is the round trip plus the player's
 *   own anticipation (humans tap 20 to 50 ms AHEAD of a metronome: the negative mean asynchrony),
 *   so it is the right number for judging that player against heard music, not a device constant.
 * - **loopback** (`estimateOffset(scheduled, heard)`): the game schedules clicks and the
 *   microphone hears its own speaker; no human in the loop, so the offset is the device's round
 *   trip. Needs echo cancellation OFF and a speaker the mic can hear (not headphones).
 *
 * Either way the estimate is robust (a median, outliers beyond `outlierMads` dropped), states its
 * spread (the MAD scaled to a standard deviation) and REFUSES itself when it cannot be trusted:
 * too few pairs, or a spread above `maxSpread`. A refused take is not silently used.
 *
 * Pure: no DOM, no clock.
 */
import { median } from '@thoremin/stats';

export interface CalibrationOptions {
  /** A response pairs with the nearest reference within this many seconds. Default 0.25. */
  maxPair?: number;
  /** Drop the first n references (the player finding the beat). Default 2. */
  warmup?: number;
  /** Responses further than this many MADs from the median are dropped. Default 3. */
  outlierMads?: number;
  /** Fewest kept pairs for an accepted estimate. Default 6. */
  minPairs?: number;
  /** Largest accepted spread, seconds. Default 0.03. */
  maxSpread?: number;
}

export interface CalibrationResult {
  /** Median of response - reference over the kept pairs, seconds (NaN when none). */
  offset: number;
  /** 1.4826 MAD of the kept differences, seconds: a robust standard deviation. */
  spread: number;
  /** Pairs found, and kept after the outlier cut. */
  paired: number;
  kept: number;
  /** Why the estimate must not be used, or null when it can. */
  refusal: string | null;
}

/** Pair each response with its nearest reference (each reference used once) and estimate. */
export function estimateOffset(references: readonly number[], responses: readonly number[], opts: CalibrationOptions = {}): CalibrationResult {
  const maxPair = opts.maxPair ?? 0.25;
  const warmup = opts.warmup ?? 2;
  const outlierMads = opts.outlierMads ?? 3;
  const minPairs = opts.minPairs ?? 6;
  const maxSpread = opts.maxSpread ?? 0.03;
  const refs = [...references].sort((a, b) => a - b).slice(warmup);
  const used = new Set<number>();
  const diffs: number[] = [];
  for (const r of [...responses].sort((a, b) => a - b)) {
    let best = -1;
    for (let i = 0; i < refs.length; i++) {
      if (used.has(i) || Math.abs(r - refs[i]) > maxPair) continue;
      if (best < 0 || Math.abs(r - refs[i]) < Math.abs(r - refs[best])) best = i;
    }
    if (best >= 0) {
      used.add(best);
      diffs.push(r - refs[best]);
    }
  }
  if (diffs.length === 0) return { offset: NaN, spread: NaN, paired: 0, kept: 0, refusal: 'no response landed near a reference' };
  const m0 = median(diffs);
  const mad0 = median(diffs.map((d) => Math.abs(d - m0)));
  // A floor of a millisecond on the MAD: a perfectly steady take must not reject a 0.1 ms wobble.
  const kept = diffs.filter((d) => Math.abs(d - m0) <= outlierMads * Math.max(mad0, 0.001));
  const offset = median(kept);
  const spread = 1.4826 * median(kept.map((d) => Math.abs(d - offset)));
  const refusal =
    kept.length < minPairs
      ? `only ${kept.length} usable pairs (need ${minPairs})`
      : spread > maxSpread
        ? `too irregular: spread ${(spread * 1000).toFixed(0)} ms (at most ${(maxSpread * 1000).toFixed(0)} ms)`
        : null;
  return { offset, spread, paired: diffs.length, kept: kept.length, refusal };
}

/** Click times for a calibration take: `count` clicks at `bpm`, the first at `start`. */
export function clickTimes(bpm: number, count: number, start = 0): number[] {
  const period = 60 / bpm;
  return Array.from({ length: count }, (_, i) => start + i * period);
}
