/**
 * Real hand streams for the stability harness: recorded landmark streams brought to the live
 * camera's rate, and scripted performances built from a REAL held hand.
 *
 * A scripted performance keeps everything a real hand does that a synthetic palm does not (the
 * tracker's jitter, the hand's own small movements, its shape and size, the frames the model lost)
 * and moves it where a player would: held on a cell, held on the edge between two, swept slowly
 * across, gone and back. The hand is a recorded one translated (and scaled, and mirrored to the
 * other side when the instrument wants the other hand), never re-synthesised, so the jitter is
 * the tracker's own. Pure: frames in, frames out.
 */
import type { Hand, HandsFrame, Handedness } from '@thoremin/sdk/nodes/domain';
import type { StreamRecord } from '@thoremin/dag';

export interface Point {
  x: number;
  y: number;
}

/** The palm points the chord map reads (the wrist and the four knuckles). */
const PALM = [0, 5, 9, 13, 17] as const;

/** A hand's palm centre, in pixels. */
export function palmCentre(hand: Hand): Point {
  const pts = PALM.map((i) => hand.keypoints[i]);
  return { x: pts.reduce((s, k) => s + k.x, 0) / pts.length, y: pts.reduce((s, k) => s + k.y, 0) / pts.length };
}

/** The palm's width (index knuckle to little-finger knuckle), pixels. */
export function palmWidth(hand: Hand): number {
  const a = hand.keypoints[5];
  const b = hand.keypoints[17];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Only the geometry and the label of a frame: a recording's own stamps would claim another
 *  document's clock. */
const bare = (f: HandsFrame): HandsFrame => ({ width: f.width, height: f.height, hands: f.hands.map((h) => ({ handedness: h.handedness, keypoints: h.keypoints, ...(h.worldKeypoints ? { worldKeypoints: h.worldKeypoints } : {}), ...(h.score !== undefined ? { score: h.score } : {}) })) });

/**
 * A recorded stream at `fps`: for each output frame, the latest recorded frame at or before its
 * time (a 60 fps recording keeps every other frame; a 30 fps one is unchanged).
 */
export function resample(records: readonly StreamRecord[], fps = 30): HandsFrame[] {
  if (!records.length) return [];
  const t0 = records[0].t;
  const end = records[records.length - 1].t - t0;
  const out: HandsFrame[] = [];
  let j = 0;
  for (let k = 0; k * (1 / fps) <= end + 1e-9; k++) {
    const t = k / fps;
    while (j + 1 < records.length && records[j + 1].t - t0 <= t + 1e-6) j += 1;
    out.push(bare(records[j].value as HandsFrame));
  }
  return out;
}

/** One hand's track in a recording: the hand with this label in each frame (or null). */
export function handTrack(frames: readonly HandsFrame[], label?: Handedness): (Hand | null)[] {
  return frames.map((f) => (label ? f.hands.find((h) => h.handedness === label) : f.hands[0]) ?? null);
}

/**
 * The stillest run of a hand track: the `n` consecutive frames whose palm wanders least, with the
 * frames the model lost inside it kept as nulls (they are real dropouts). Used to pick a held hand
 * out of a sign clip, whose start and end are the hand arriving and leaving.
 */
export function stillestRun(track: readonly (Hand | null)[], n: number): (Hand | null)[] {
  let best = 0;
  let bestSpread = Infinity;
  for (let s = 0; s + n <= track.length; s++) {
    const pts = track.slice(s, s + n).filter((h): h is Hand => !!h).map(palmCentre);
    if (pts.length < n * 0.8) continue;
    const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const spread = Math.max(...pts.map((p) => Math.hypot(p.x - mx, p.y - my)));
    if (spread < bestSpread) {
      bestSpread = spread;
      best = s;
    }
  }
  return track.slice(best, best + n);
}

/** A segment of a scripted performance. Points are DISPLAY fractions (the mirrored picture the
 *  player sees: x = 0 at the screen's left), as the chord map reads them. */
export type Segment =
  | { hold: Point; s: number; label?: string }
  | { move: [Point, Point]; s: number; label?: string }
  | { gone: number; label?: string };

export interface PerformanceOptions {
  /** The frame the hand is placed in. */
  width: number;
  height: number;
  /** The label the placed hand carries (the instrument's chord hand, as the model names it). */
  handedness: Handedness;
  /** The placed hand's palm width as a fraction of the frame width (a player about a metre from
   *  a laptop camera: ~0.07). */
  palmFraction?: number;
  fps?: number;
}

export interface Performance {
  frames: HandsFrame[];
  /** Per frame: the point the script put the palm at (null while gone). */
  at: (Point | null)[];
  /** Per frame: the segment's label (a hold's intended chord, say), or undefined. */
  labels: (string | undefined)[];
  /** Per frame: inside a hold segment. */
  holding: boolean[];
}

/**
 * A scripted performance from a real hand: the template's frames, played forward and back so a
 * long hold never jumps, each translated so its MEAN palm centre lands on the scripted point (the
 * frame-to-frame jitter around that mean is the tracker's own), scaled to `palmFraction`, and
 * mirrored when the template is the other hand. A template frame the model lost is a frame with
 * no hand.
 */
export function performance(template: readonly (Hand | null)[], script: readonly Segment[], opts: PerformanceOptions): Performance {
  const fps = opts.fps ?? 30;
  const seen = template.filter((h): h is Hand => !!h);
  if (!seen.length) throw new Error('performance: the template has no hand');
  const centres = seen.map(palmCentre);
  const mean = { x: centres.reduce((a, p) => a + p.x, 0) / centres.length, y: centres.reduce((a, p) => a + p.y, 0) / centres.length };
  const width = seen.reduce((a, h) => a + palmWidth(h), 0) / seen.length;
  const scale = ((opts.palmFraction ?? 0.07) * opts.width) / width;
  const mirror = seen[0].handedness !== opts.handedness;
  const place = (h: Hand, p: Point): Hand => {
    const px = (1 - p.x) * opts.width;
    const py = p.y * opts.height;
    return {
      handedness: opts.handedness,
      keypoints: h.keypoints.map((k) => ({ x: px + (mirror ? -1 : 1) * (k.x - mean.x) * scale, y: py + (k.y - mean.y) * scale, z: k.z })),
      ...(h.worldKeypoints ? { worldKeypoints: h.worldKeypoints.map((k) => ({ ...k, x: mirror ? -k.x : k.x })) } : {}),
      ...(h.score !== undefined ? { score: h.score } : {}),
    };
  };
  // Forward and back: a long hold never jumps from the template's last frame to its first.
  const cycle = template.length > 1 ? [...template, ...template.slice(1, -1).reverse()] : [...template];
  let k = 0;
  const out: Performance = { frames: [], at: [], labels: [], holding: [] };
  for (const seg of script) {
    const n = Math.round(('gone' in seg ? seg.gone : seg.s) * fps);
    for (let i = 0; i < n; i++) {
      let p: Point | null = null;
      if ('hold' in seg) p = seg.hold;
      else if ('move' in seg) {
        const f = n > 1 ? i / (n - 1) : 1;
        p = { x: seg.move[0].x + (seg.move[1].x - seg.move[0].x) * f, y: seg.move[0].y + (seg.move[1].y - seg.move[0].y) * f };
      }
      const h = cycle[k++ % cycle.length];
      out.frames.push({ width: opts.width, height: opts.height, hands: p && h ? [place(h, p)] : [] });
      out.at.push(p);
      out.labels.push(seg.label);
      out.holding.push('hold' in seg);
    }
  }
  return out;
}

/** Join performances (or recorded clips) end to end. */
export function concat(...parts: readonly Performance[]): Performance {
  return {
    frames: parts.flatMap((p) => p.frames),
    at: parts.flatMap((p) => p.at),
    labels: parts.flatMap((p) => p.labels),
    holding: parts.flatMap((p) => p.holding),
  };
}

/** A recorded clip as a performance part, every frame labelled (a sign clip and its sign). */
export function clip(frames: readonly HandsFrame[], label?: string): Performance {
  return { frames: [...frames], at: frames.map(() => null), labels: frames.map(() => label), holding: frames.map(() => false) };
}

/** No hand for `s` seconds, in a frame of the given size. */
export function gap(s: number, width: number, height: number, fps = 30): Performance {
  const n = Math.round(s * fps);
  return { frames: Array.from({ length: n }, () => ({ width, height, hands: [] })), at: Array(n).fill(null), labels: Array(n).fill(undefined), holding: Array(n).fill(false) };
}
