/**
 * Stability metrics for a chord instrument's output on a replayed hand stream: what makes an
 * instrument sound "glitchy" to a player, measured.
 *
 * A run is a {@link Timeline}: per camera frame, the chord the instrument has in force (a key such
 * as `0.4.7`, or null when it holds none), whether the playing hand is seen, whether it is HELD
 * (seen and nearly still), and, for a scripted performance, the chord the player meant. The
 * metrics are what a listener hears go wrong:
 *
 * - `changesPerHeldS`: chord changes while the hand is held still. A held hand should hold its
 *   chord, so anything above zero is the instrument moving on its own.
 * - `flickers`: a chord that lasts fewer than `flickerFrames` frames before something else takes
 *   over: a blip a player hears as a stutter (A, B, A) or a wrong passing chord (A, B, C).
 * - `spuriousNoHand`: a chord that STARTS or changes while no hand is seen (the release to silence
 *   is not counted: letting go is meant).
 * - `entryFlickers`: flickers within `entryS` of the hand coming into view, the classic "it plays a
 *   wrong chord as my hand comes in".
 * - `shortChords`: chords that last under `shortFrames` (400 ms) between two others: long enough
 *   not to be a flicker, short enough to be heard as a wrong chord passed through on the way.
 * - `blips`: sound of at most `blipFrames` frames with silence on both sides: a click, on any
 *   voice (the melody's too), read from the sounding pitch classes rather than the chord.
 * - `latency`: for a scripted performance only, the time from the player's intended change to the
 *   first frame the output equals the new target and stays on it for `flickerFrames` frames;
 *   `missed` counts intended chords never reached while intended.
 *
 * Pure: arrays in, numbers out. The runner (`lib_run.ts`) makes the timeline.
 */

export interface Timeline {
  /** Engine time of each frame, seconds. */
  t: readonly number[];
  /** The chord in force at each frame, or null. */
  out: readonly (string | null)[];
  /** The playing hand is seen. */
  hand: readonly boolean[];
  /** The playing hand is seen and nearly still. */
  held: readonly boolean[];
  /** The chord the player meant (a scripted performance), or absent. A null entry = "meant
   *  nothing", an undefined one = "no claim" (a transition). */
  target?: readonly (string | null | undefined)[];
}

export interface MetricOptions {
  /** A chord lasting fewer frames than this is a flicker (6 frames = 200 ms at 30 fps). */
  flickerFrames?: number;
  /** How long after the hand comes into view counts as its entry, seconds. */
  entryS?: number;
  /** A chord lasting fewer frames than this (and at least a flicker) is a short chord. */
  shortFrames?: number;
  /** Sound lasting at most this many frames between silences is a blip. */
  blipFrames?: number;
}

export interface LatencyStats {
  /** Intended changes measured. */
  n: number;
  /** Intended chords the output never reached while they were intended. */
  missed: number;
  medianMs: number | null;
  p90Ms: number | null;
  maxMs: number | null;
}

export interface StabilityMetrics {
  durationS: number;
  heldS: number;
  /** Seconds with any chord in force. */
  soundingS: number;
  changes: number;
  changesWhileHeld: number;
  changesPerHeldS: number;
  flickers: number;
  flickersPerMin: number;
  spuriousNoHand: number;
  entryFlickers: number;
  shortChords: number;
  blips: number;
  latency: LatencyStats | null;
}

export const DEFAULT_FLICKER_FRAMES = 6;
export const DEFAULT_ENTRY_S = 0.5;
export const DEFAULT_SHORT_FRAMES = 12;
export const DEFAULT_BLIP_FRAMES = 2;

interface Run {
  value: string | null;
  start: number;
  end: number; // exclusive
}

/** The output as runs of one value. */
export function runsOf(out: readonly (string | null)[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < out.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.value === out[i]) last.end = i + 1;
    else runs.push({ value: out[i], start: i, end: i + 1 });
  }
  return runs;
}

const quantile = (xs: readonly number[], q: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/** The stability metrics of one timeline. */
export function stabilityMetrics(tl: Timeline, opts: MetricOptions = {}): StabilityMetrics {
  const flickerFrames = opts.flickerFrames ?? DEFAULT_FLICKER_FRAMES;
  const entryS = opts.entryS ?? DEFAULT_ENTRY_S;
  const shortFrames = opts.shortFrames ?? DEFAULT_SHORT_FRAMES;
  const blipFrames = opts.blipFrames ?? DEFAULT_BLIP_FRAMES;
  const n = tl.out.length;
  const dt = (i: number) => (i + 1 < n ? tl.t[i + 1] - tl.t[i] : i > 0 ? tl.t[i] - tl.t[i - 1] : 0);
  let heldS = 0;
  let soundingS = 0;
  for (let i = 0; i < n; i++) {
    if (tl.held[i]) heldS += dt(i);
    if (tl.out[i] !== null) soundingS += dt(i);
  }

  // Entry times: frames where the hand comes into view.
  const entries: number[] = [];
  for (let i = 0; i < n; i++) if (tl.hand[i] && (i === 0 || !tl.hand[i - 1])) entries.push(tl.t[i]);
  const inEntry = (t: number) => entries.some((e) => t >= e && t - e < entryS);

  let changes = 0;
  let changesWhileHeld = 0;
  let spuriousNoHand = 0;
  for (let i = 1; i < n; i++) {
    if (tl.out[i] === tl.out[i - 1]) continue;
    changes += 1;
    // A change on a held frame whose previous frame was held too: the hand did not move on.
    if (tl.held[i] && tl.held[i - 1]) changesWhileHeld += 1;
    if (!tl.hand[i] && tl.out[i] !== null) spuriousNoHand += 1;
  }

  // Flickers: a non-final run shorter than the threshold, between two other runs, that is a
  // chord (a short silence between two chords is a dropout, counted as a flicker too: both are
  // heard as a stutter).
  const runs = runsOf(tl.out);
  let flickers = 0;
  let entryFlickers = 0;
  let shortChords = 0;
  let blips = 0;
  for (let k = 1; k + 1 < runs.length; k++) {
    const r = runs[k];
    const len = r.end - r.start;
    if (r.value !== null && runs[k - 1].value === null && runs[k + 1].value === null && len <= blipFrames) blips += 1;
    if (r.value !== null && len >= flickerFrames && len < shortFrames) shortChords += 1;
    if (len >= flickerFrames) continue;
    // A short silence after which the hand is gone is a release, not a stutter.
    if (r.value === null && runs[k + 1].value === null) continue;
    flickers += 1;
    if (inEntry(tl.t[r.start])) entryFlickers += 1;
  }

  const durationS = n > 1 ? tl.t[n - 1] - tl.t[0] + dt(n - 1) : 0;
  return {
    durationS,
    heldS,
    soundingS,
    changes,
    changesWhileHeld,
    changesPerHeldS: heldS > 0 ? changesWhileHeld / heldS : 0,
    flickers,
    flickersPerMin: durationS > 0 ? (flickers * 60) / durationS : 0,
    spuriousNoHand,
    entryFlickers,
    shortChords,
    blips,
    latency: tl.target ? latencyStats(tl, flickerFrames) : null,
  };
}

/** Latency from each intended change to the output settling on it. */
export function latencyStats(tl: Timeline, flickerFrames = DEFAULT_FLICKER_FRAMES): LatencyStats {
  const target = tl.target!;
  const n = tl.out.length;
  const lat: number[] = [];
  let missed = 0;
  let i = 0;
  while (i < n) {
    const want = target[i];
    // The start of an intended segment: a defined target that differs from the one before.
    if (want === undefined || (i > 0 && target[i - 1] === want)) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < n && target[end] === want) end += 1;
    let hit: number | null = null;
    for (let j = i; j < end; j++) {
      if (tl.out[j] !== want) continue;
      let k = j;
      while (k < n && k - j < flickerFrames && tl.out[k] === want) k += 1;
      if (k - j >= flickerFrames || k === end || k === n) {
        hit = j;
        break;
      }
    }
    if (hit === null) missed += 1;
    else lat.push((tl.t[hit] - tl.t[i]) * 1000);
    i = end;
  }
  return { n: lat.length + missed, missed, medianMs: quantile(lat, 0.5), p90Ms: quantile(lat, 0.9), maxMs: lat.length ? Math.max(...lat) : null };
}

/**
 * Held frames from the hand's own motion, for a real stream with no script: the hand is seen and
 * its point moved less than `maxSpeed` (in the point's units per second, e.g. frame fractions)
 * over the last `window` frames, and was seen throughout them.
 */
export function heldFromMotion(
  t: readonly number[],
  point: readonly ({ x: number; y: number } | null)[],
  { maxSpeed, window = 5 }: { maxSpeed: number; window?: number },
): boolean[] {
  return point.map((p, i) => {
    if (!p || i < window) return false;
    const q = point[i - window];
    if (!q) return false;
    for (let k = i - window; k <= i; k++) if (!point[k]) return false;
    const span = t[i] - t[i - window];
    return span > 0 && Math.hypot(p.x - q.x, p.y - q.y) / span <= maxSpeed;
  });
}
