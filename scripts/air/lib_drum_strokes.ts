/**
 * Strokes from a drummer's wrists, and which drum each stroke went to. The parts of the
 * drum problem that are NOT sub-frame timing: sub-frame timing (predicting the hit
 * before the frame that shows it, the `ictus` prior, the commit-and-correct rule) is the
 * sub-frame stream's, in `src/ictus/`. This module finds strokes at FRAME resolution
 * and says where they landed; §7 of the research doc says where the two meet.
 *
 * A stroke, here, is a wrist moving down and reversing: the frame where the wrist's
 * image-y velocity crosses from downward (+y) to upward (−y) after a downward run
 * whose peak speed exceeds a threshold in NOISE units (the wrist's own frame-to-frame
 * jitter, the trainer's `noise.ts` idea applied to a velocity), with a refractory gap
 * so one reversal is one stroke. The time reported is the reversal frame's, linearly
 * interpolated between the last downward and first upward sample, which is as far as a
 * frame-level detector may honestly go. Dahl's finding [B2] that the acceleration
 * peak leads the audio onset while the reversal trails it is what the sub-frame stream
 * builds on; the reversal is reported here because it is what a frame shows.
 *
 * Assignment: every stroke's landing point (the wrist's image position at the
 * reversal, normalised by the shoulder width and centred on the shoulder midpoint so
 * the camera distance and framing drop out) is clustered with k-means; the number of
 * clusters is chosen by the largest relative drop in within-cluster spread, capped.
 * Each cluster is a "drum" (or a place in the air the player keeps returning to), and
 * a stroke is assigned to its nearest centre. No audio is used: which drum sounded is
 * a spatial fact the video carries and the audio, without a drum-sound classifier,
 * does not.
 */
import type { StreamRecord } from '@/dag';
import type { BodyFrame } from '@/nodes/domain';
import { BLM } from '@/nodes/domain';

export type Wrist = 'left' | 'right';

export interface Stroke {
  wrist: Wrist;
  /** Reversal time, seconds (interpolated between the two frames around the reversal). */
  t: number;
  /** Peak downward speed of the run, in noise units. */
  strength: number;
  /** Landing point, shoulder-normalised (x to the right, y down, origin the shoulder midpoint). */
  x: number;
  y: number;
  /** Assigned cluster (drum) index, after {@link assignStrokes}. */
  drum?: number;
}

export interface WristSample {
  t: number;
  x: number;
  y: number;
  /** Shoulder-normalised position, or NaN when the shoulders are not visible. */
  nx: number;
  ny: number;
  visible: boolean;
}

const MIN_VISIBILITY = 0.5;

/** Per-wrist samples from a pose stream, with the shoulder normalisation attached. */
export function wristTracks(records: readonly StreamRecord[], minVisibility = MIN_VISIBILITY): Record<Wrist, WristSample[]> {
  const out: Record<Wrist, WristSample[]> = { left: [], right: [] };
  for (const r of records) {
    const f = r.value as BodyFrame;
    if (!f.present || f.landmarks.length < 33) continue;
    const ls = f.landmarks[BLM.left_shoulder];
    const rs = f.landmarks[BLM.right_shoulder];
    const shouldersOk = (f.visibility[BLM.left_shoulder] ?? 0) >= minVisibility && (f.visibility[BLM.right_shoulder] ?? 0) >= minVisibility;
    const width = shouldersOk ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : NaN;
    const cx = (ls.x + rs.x) / 2;
    const cy = (ls.y + rs.y) / 2;
    for (const w of ['left', 'right'] as const) {
      const idx = w === 'left' ? BLM.left_wrist : BLM.right_wrist;
      const p = f.landmarks[idx];
      const visible = (f.visibility[idx] ?? 0) >= minVisibility;
      out[w].push({
        t: r.t,
        x: p.x,
        y: p.y,
        nx: width > 0 ? (p.x - cx) / width : NaN,
        ny: width > 0 ? (p.y - cy) / width : NaN,
        visible,
      });
    }
  }
  return out;
}

export interface StrokeOptions {
  /** Peak downward speed a run must reach, in noise units. Default 3. */
  minStrength?: number;
  /** Seconds after a stroke during which no second stroke is accepted. Default 0.08. */
  refractorySeconds?: number;
  /** Fallback noise sigma (px/s) when the track is too short to estimate one. */
  fallbackSigma?: number;
}

/** Median absolute deviation, scaled to a Gaussian sigma. */
function madSigma(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const dev = xs.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  return 1.4826 * dev[Math.floor(dev.length / 2)];
}

/**
 * Detect strokes on one wrist track. The velocity noise is the MAD of the y velocity
 * over the whole track, which is dominated by the still and slow frames a drumming
 * clip has plenty of, so a stroke's speed is measured against how much the wrist
 * jitters when it is not striking.
 */
export function detectStrokes(track: readonly WristSample[], wrist: Wrist, o: StrokeOptions = {}): Stroke[] {
  const minStrength = o.minStrength ?? 3;
  const refractory = o.refractorySeconds ?? 0.08;
  const pts = track.filter((s) => s.visible);
  if (pts.length < 3) return [];
  const vy: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t;
    vy.push(dt > 0 ? (pts[i].y - pts[i - 1].y) / dt : 0);
  }
  let sigma = madSigma(vy);
  if (!(sigma > 0)) sigma = o.fallbackSigma ?? 1;
  const strokes: Stroke[] = [];
  let runPeak = 0;
  let lastStroke = -Infinity;
  for (let i = 0; i < vy.length; i++) {
    const v = vy[i];
    if (v > 0) {
      runPeak = Math.max(runPeak, v);
      continue;
    }
    // v <= 0: the wrist is moving up (or still). A reversal ends a downward run.
    if (runPeak > 0) {
      const strength = runPeak / sigma;
      const a = pts[i]; // last sample of the downward run
      const b = pts[i + 1]; // first sample moving up
      const t = i + 1 < pts.length && vy[i] < 0 && i > 0 ? interpolateReversal(pts[i - 1], a, b) : a.t;
      if (strength >= minStrength && t - lastStroke >= refractory) {
        strokes.push({ wrist, t, strength, x: a.nx, y: a.ny });
        lastStroke = t;
      }
      runPeak = 0;
    }
  }
  return strokes;
}

/** Where, between the lowest sample and its neighbours, the parabola through them peaks. */
function interpolateReversal(prev: WristSample, low: WristSample, next: WristSample): number {
  const y0 = prev.y;
  const y1 = low.y;
  const y2 = next.y;
  const denom = y0 - 2 * y1 + y2;
  if (!(Math.abs(denom) > 1e-9)) return low.t;
  const delta = (0.5 * (y0 - y2)) / denom; // in frames, -0.5..0.5 around `low`
  const dt = (next.t - prev.t) / 2;
  return low.t + Math.max(-0.5, Math.min(0.5, delta)) * dt;
}

export interface Cluster {
  x: number;
  y: number;
  count: number;
}

/** Plain k-means on (x, y) with deterministic seeding (farthest-first). */
export function kmeans(points: readonly { x: number; y: number }[], k: number, iterations = 50): { centres: Cluster[]; labels: number[] } {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0 || k <= 0) return { centres: [], labels: [] };
  const centres: { x: number; y: number }[] = [{ x: pts[0].x, y: pts[0].y }];
  while (centres.length < Math.min(k, pts.length)) {
    let best = 0;
    let bestD = -1;
    pts.forEach((p, i) => {
      const d = Math.min(...centres.map((c) => Math.hypot(p.x - c.x, p.y - c.y)));
      if (d > bestD) [best, bestD] = [i, d];
    });
    centres.push({ x: pts[best].x, y: pts[best].y });
  }
  let labels = new Array<number>(pts.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    labels = pts.map((p) => {
      let best = 0;
      let bestD = Infinity;
      centres.forEach((c, j) => {
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < bestD) [best, bestD] = [j, d];
      });
      return best;
    });
    const sums = centres.map(() => ({ x: 0, y: 0, n: 0 }));
    pts.forEach((p, i) => {
      sums[labels[i]].x += p.x;
      sums[labels[i]].y += p.y;
      sums[labels[i]].n += 1;
    });
    let moved = 0;
    sums.forEach((s, j) => {
      if (s.n === 0) return;
      const nx = s.x / s.n;
      const ny = s.y / s.n;
      moved += Math.hypot(nx - centres[j].x, ny - centres[j].y);
      centres[j] = { x: nx, y: ny };
    });
    if (moved < 1e-9) break;
  }
  const counts = centres.map(() => 0);
  for (const l of labels) counts[l] += 1;
  return { centres: centres.map((c, j) => ({ ...c, count: counts[j] })), labels };
}

function withinSpread(points: readonly { x: number; y: number }[], centres: readonly Cluster[], labels: readonly number[]): number {
  let s = 0;
  points.forEach((p, i) => {
    const c = centres[labels[i]];
    s += (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
  });
  return points.length ? s / points.length : 0;
}

export interface AssignOptions {
  /** Most drums to consider. Default 5. */
  maxDrums?: number;
  /** A further cluster must cut the within-cluster spread by at least this fraction. Default 0.35. */
  minGain?: number;
  /**
   * Do not split a cluster whose RMS radius is under this many shoulder widths
   * (default 0.1): a drum is a target the size of a hand, and a tight cloud of landing
   * points is one drum with jitter, however well two centres would fit it.
   */
  minSpread?: number;
}

/**
 * Cluster the strokes' landing points into drums and label each stroke. Returns the
 * centres in shoulder units; strokes without a finite landing point stay unassigned.
 */
export function assignStrokes(strokes: Stroke[], o: AssignOptions = {}): Cluster[] {
  const maxK = o.maxDrums ?? 5;
  const minGain = o.minGain ?? 0.35;
  const minSpread = o.minSpread ?? 0.1;
  const pts = strokes.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
  if (pts.length < 2) return [];
  let best = kmeans(pts, 1);
  let bestSpread = withinSpread(pts, best.centres, best.labels);
  for (let k = 2; k <= Math.min(maxK, pts.length); k++) {
    if (Math.sqrt(bestSpread) < minSpread) break;
    const trial = kmeans(pts, k);
    const spread = withinSpread(pts, trial.centres, trial.labels);
    if (bestSpread > 0 && (bestSpread - spread) / bestSpread >= minGain) {
      best = trial;
      bestSpread = spread;
    } else break;
  }
  pts.forEach((s, i) => (s.drum = best.labels[i]));
  return best.centres;
}

/** Strokes on both wrists of a pose stream, merged in time order. */
export function strokesOf(records: readonly StreamRecord[], o: StrokeOptions = {}): Stroke[] {
  const tracks = wristTracks(records);
  return [...detectStrokes(tracks.left, 'left', o), ...detectStrokes(tracks.right, 'right', o)].sort((a, b) => a.t - b.t);
}
