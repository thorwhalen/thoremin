/**
 * Strokes from a drummer's wrists, and which drum each stroke went to. The parts of the
 * drum problem that are NOT sub-frame timing: predicting the hit before the frame that
 * shows it, the `ictus` prior and the commit-and-correct rule are the sub-frame
 * stream's, in `src/ictus/`. This module finds strokes at frame resolution and says
 * where they landed; §7.3 of the research doc says where the two meet.
 *
 * The stroke detector IS the ictus detector (`createIctusDetector` in
 * `src/ictus/detector.ts`), one per wrist, fed the wrist's image position: a stroke is a
 * turning point of image-y (down positive), refined by parabola below the frame
 * period, gated by an online noise estimate (each sample's residual against the median
 * of its neighbours, in the trainer's noise-unit convention) and a recent-amplitude
 * envelope, with a tempo-relative refractory window and a restart after a tracking
 * gap. A {@link Stroke} is that detector's `Anchor` plus the wrist and the landing
 * point. Nothing is re-derived here, so what a drum stroke is in the offline scorer and
 * in the live conductor node is one definition, and the sub-frame stream's improvements
 * to the detector reach this evaluation for free.
 *
 * Assignment: every stroke's landing point (the wrist's image position at the
 * reversal, normalised by the shoulder width and centred on the shoulder midpoint so
 * the camera distance and framing drop out) is clustered PER WRIST by recursive
 * bisection: a cluster is split into two only if it is wide (RMS radius above
 * `minSpread` shoulder widths), the split removes at least `minGain` of its spread, and
 * both halves keep at least `minSize` strokes, so a tight cloud is one drum with jitter
 * and a stray mis-tracked point never becomes a drum. Each cluster is a "drum" (or a
 * place in the air the player keeps returning to). No audio is used: which drum
 * sounded is a spatial fact the video carries and the audio, without a drum-sound
 * classifier, does not. The wrists are clustered separately because a wrist is not a
 * stick tip: the same snare hit by the left and the right hand lands the two wrists in
 * two different places.
 */
import type { StreamRecord } from '@/dag';
import { createIctusDetector, type DetectorOptions } from '@/ictus/detector';
import type { Anchor } from '@/ictus/types';
import type { BodyFrame } from '@/nodes/domain';
import { BLM } from '@/nodes/domain';

export type Wrist = 'left' | 'right';

/** A detected stroke: the ictus detector's anchor, plus whose wrist and where it landed. */
export interface Stroke extends Anchor {
  wrist: Wrist;
  /** Landing point, shoulder-normalised (x to the right, y down, origin the shoulder midpoint). */
  x: number;
  y: number;
  /** Assigned cluster (drum) index within this wrist's clusters, after {@link assignStrokes}. */
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

/**
 * Detector options for a drum wrist. The ictus defaults are tuned for a conductor's
 * beat (period 0.6 s, refractory a quarter of it, a median-of-three prefilter against
 * one-frame landmark spikes); a drummer's single hand strikes at up to 6 to 8 Hz on a
 * roll, five frames per cycle at 30 fps, and the three-sample median flattens exactly
 * that (2 of 36 strokes found on a 6 Hz groove with it, 36 of 36 without) and biases
 * the parabolic timing by half a frame on a short stroke. So the prefilter is off for
 * drums and the initial period and refractory fraction are shorter; a one-frame spike
 * is instead rejected by the amplitude gates. Everything else (noise units, envelope,
 * gap restart) is the shared definition.
 */
export const DRUM_DETECTOR_DEFAULTS: DetectorOptions = {
  mode: 'turning',
  yDown: true,
  medianFilter: false,
  initialPeriod: 0.3,
  refractoryFraction: 0.2,
  minAmplitudeNoiseUnits: 12,
  /**
   * Absolute floor in SHOULDER WIDTHS (the detector is fed the shoulder-normalised
   * position, so this is resolution-independent): a stroke moves the wrist by at least
   * a twentieth of the shoulder width. Without it the first seconds of a still wrist,
   * before the online noise estimate and the envelope exist, yield anchors on jitter.
   */
  minAmplitude: 0.05,
};

export interface StrokeOptions extends DetectorOptions {
  /** Anchors below this `strength` (fraction of the recent envelope) are not strokes. Default 0.3. */
  minStrength?: number;
}

/** Strokes on one wrist track: the ictus detector fed the visible, shoulder-normalised samples in order. */
export function detectStrokes(track: readonly WristSample[], wrist: Wrist, o: StrokeOptions = {}): Stroke[] {
  const { minStrength = 0.3, ...detOpts } = o;
  const det = createIctusDetector({ ...DRUM_DETECTOR_DEFAULTS, ...detOpts });
  const strokes: Stroke[] = [];
  const recent: WristSample[] = [];
  for (const s of track) {
    if (!s.visible || !Number.isFinite(s.nx) || !Number.isFinite(s.ny)) continue;
    recent.push(s);
    if (recent.length > 8) recent.shift();
    // Shoulder-normalised coordinates, so the amplitude gates mean the same thing on a
    // 720p phone clip and a 4K lesson.
    const anchor = det.push({ t: s.t, x: s.nx, y: s.ny });
    if (!anchor || anchor.strength < minStrength) continue;
    // The landing point: the sample nearest the anchor's (interpolated) time, which is
    // a frame or two before the sample that confirmed it.
    let best = recent[0];
    for (const r of recent) if (Math.abs(r.t - anchor.t) < Math.abs(best.t - anchor.t)) best = r;
    strokes.push({ ...anchor, wrist, x: best.nx, y: best.ny });
  }
  return strokes;
}

export interface Cluster {
  wrist: Wrist;
  x: number;
  y: number;
  count: number;
  /** RMS radius of the cluster, shoulder widths. */
  radius: number;
}

/** Plain k-means on (x, y) with deterministic seeding (farthest-first). */
export function kmeans(points: readonly { x: number; y: number }[], k: number, iterations = 50): { centres: { x: number; y: number; count: number }[]; labels: number[] } {
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
  return { centres: centres.map((c, j) => ({ ...c, count: counts[j] })).filter((c) => c.count > 0), labels };
}

const rmsRadius = (pts: readonly { x: number; y: number }[], c: { x: number; y: number }): number =>
  pts.length ? Math.sqrt(pts.reduce((s, p) => s + (p.x - c.x) ** 2 + (p.y - c.y) ** 2, 0) / pts.length) : 0;

export interface AssignOptions {
  /** Most drums per wrist. Default 5. */
  maxDrums?: number;
  /** A split must cut the cluster's spread (mean squared radius) by at least this fraction. Default 0.35. */
  minGain?: number;
  /** A cluster with an RMS radius under this many shoulder widths is never split. Default 0.1. */
  minSpread?: number;
  /** Both halves of a split must keep at least this many strokes. Default 4. */
  minSize?: number;
}

/**
 * Cluster one wrist's strokes into drums by recursive bisection and label each stroke's
 * `drum`. Strokes without a finite landing point stay unassigned.
 */
export function assignWristStrokes(strokes: Stroke[], wrist: Wrist, o: AssignOptions = {}): Cluster[] {
  const maxDrums = o.maxDrums ?? 5;
  const minGain = o.minGain ?? 0.35;
  const minSpread = o.minSpread ?? 0.1;
  const minSize = o.minSize ?? 4;
  const pts = strokes.filter((s) => s.wrist === wrist && Number.isFinite(s.x) && Number.isFinite(s.y));
  if (pts.length === 0) return [];
  let groups: Stroke[][] = [pts];
  let split = true;
  while (split && groups.length < maxDrums) {
    split = false;
    // Try the widest cluster first.
    const order = groups
      .map((g, i) => ({ i, r: rmsRadius(g, centreOf(g)) }))
      .sort((a, b) => b.r - a.r);
    for (const { i, r } of order) {
      const g = groups[i];
      if (r < minSpread || g.length < 2 * minSize) continue;
      const km = kmeans(g, 2);
      if (km.centres.length < 2) continue;
      const halves: Stroke[][] = [[], []];
      km.labels.forEach((l, j) => halves[l].push(g[j]));
      if (halves[0].length < minSize || halves[1].length < minSize) continue;
      const before = r * r;
      const after = halves.reduce((s, h) => s + h.length * rmsRadius(h, centreOf(h)) ** 2, 0) / g.length;
      if (before > 0 && (before - after) / before >= minGain) {
        groups.splice(i, 1, halves[0], halves[1]);
        split = true;
        break;
      }
    }
  }
  groups.sort((a, b) => centreOf(a).x - centreOf(b).x);
  const clusters: Cluster[] = groups.map((g) => {
    const c = centreOf(g);
    return { wrist, x: c.x, y: c.y, count: g.length, radius: rmsRadius(g, c) };
  });
  groups.forEach((g, i) => g.forEach((s) => (s.drum = i)));
  return clusters;
}

function centreOf(g: readonly { x: number; y: number }[]): { x: number; y: number } {
  return { x: g.reduce((s, p) => s + p.x, 0) / g.length, y: g.reduce((s, p) => s + p.y, 0) / g.length };
}

/** Both wrists' clusters, left then right. */
export function assignStrokes(strokes: Stroke[], o: AssignOptions = {}): Cluster[] {
  return [...assignWristStrokes(strokes, 'left', o), ...assignWristStrokes(strokes, 'right', o)];
}

/** Strokes on both wrists of a pose stream, merged in time order. */
export function strokesOf(records: readonly StreamRecord[], o: StrokeOptions = {}): Stroke[] {
  const tracks = wristTracks(records);
  return [...detectStrokes(tracks.left, 'left', o), ...detectStrokes(tracks.right, 'right', o)].sort((a, b) => a.t - b.t);
}

/**
 * Signed timing error of each stroke against its nearest reference onset, seconds
 * (positive = the stroke is late). The median is the systematic lag a frame-level
 * reversal carries against the sound (Dahl's finding: the reversal trails the onset),
 * and the honest F-measure is taken after removing it, so a detector that fires on
 * every hit one frame late is not scored as missing every hit.
 */
export function timingErrors(reference: readonly number[], strokes: readonly number[], window: number): number[] {
  const ref = [...reference].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of strokes) {
    let best = NaN;
    let bestD = Infinity;
    for (const r of ref) {
      const d = Math.abs(t - r);
      if (d < bestD) [best, bestD] = [r, d];
      if (r > t + window) break;
    }
    if (bestD <= window) out.push(t - best);
  }
  return out;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
