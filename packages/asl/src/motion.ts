/**
 * Motion signs from a window of frames. MUST stay identical to the training featuriser
 * (`scripts/asl/motion_common.py`).
 *
 * Per frame the recogniser keeps a {@link MotionFrame}: the static model's letter
 * posterior (what the hand's shape looks like now) and four points in the mirrored image
 * plane (the wrist, the index and pinky tips, and the palm length that scales them). A window
 * is the frames of the last D seconds; its feature vector is that posterior at
 * `tPost` times, the wrist path and the two fingertips relative to the window's first wrist
 * in palm lengths at `tPath` times, the wrist's path length and the window's duration.
 * Every window length the model was trained with is scored, and the most confident sign
 * wins: a sign signed fast and one signed slow both fill some window.
 */
import { mlpPredict, type MlpModel } from './mlp';
import type { HandInput } from './features';

export interface MotionFrame {
  t: number;
  post: number[];
  wrist: [number, number];
  index: [number, number];
  pinky: [number, number];
  palm: number;
}

/** One frame of the signing hand as the motion model sees it: `post` is the static model's
 *  posterior for this hand; positions are pixels with x mirrored for a left hand. */
export function toMotionFrame(hand: HandInput, post: number[], t: number): MotionFrame {
  const k = hand.keypoints;
  const mx = (p: { x: number }) => (hand.handedness === 'Left' ? -p.x : p.x);
  return {
    t,
    post,
    wrist: [mx(k[0]!), k[0]!.y],
    index: [mx(k[8]!), k[8]!.y],
    pinky: [mx(k[20]!), k[20]!.y],
    palm: Math.hypot(k[9]!.x - k[0]!.x, k[9]!.y - k[0]!.y) || 1,
  };
}

export interface MotionMeta {
  windows: number[];
  tPost: number;
  tPath: number;
  minFrames: number;
  threshold: number;
}

export const DEFAULT_MOTION_META: MotionMeta = { windows: [0.6, 0.9, 1.3, 1.8], tPost: 4, tPath: 8, minFrames: 4, threshold: 0.6 };

export function motionMeta(model: MlpModel): MotionMeta {
  return { ...DEFAULT_MOTION_META, ...(model.meta as Partial<MotionMeta> | undefined) };
}

/** Linear resampling of rows `vals` (one per time in `ts`) at `n` evenly spaced times;
 *  clamps at the ends like numpy's `interp`. */
export function resample(ts: readonly number[], vals: readonly (readonly number[])[], n: number): number[][] {
  const t0 = ts[0]!;
  const t1 = ts[ts.length - 1]!;
  const out: number[][] = [];
  for (let k = 0; k < n; k++) {
    const tt = t1 > t0 ? t0 + ((t1 - t0) * k) / (n - 1) : t0;
    let j = 0;
    while (j < ts.length - 2 && ts[j + 1]! < tt) j++;
    const ta = ts[j]!;
    const tb = ts[Math.min(j + 1, ts.length - 1)]!;
    const a = vals[j]!;
    const b = vals[Math.min(j + 1, ts.length - 1)]!;
    const f = tb > ta ? Math.min(1, Math.max(0, (tt - ta) / (tb - ta))) : 0;
    out.push(a.map((v, i) => v + (b[i]! - v) * f));
  }
  return out;
}

/** The feature vector of one window (frames time-ascending, at least two). */
export function windowFeatures(frames: readonly MotionFrame[], meta: Pick<MotionMeta, 'tPost' | 'tPath'>): number[] {
  const ts = frames.map((f) => f.t);
  const palm = frames.reduce((s, f) => s + f.palm, 0) / frames.length || 1;
  const [wx, wy] = frames[0]!.wrist;
  const rel = (p: [number, number]): number[] => [(p[0] - wx) / palm, (p[1] - wy) / palm];
  const post = resample(ts, frames.map((f) => f.post), meta.tPost).flat();
  const wrist = resample(ts, frames.map((f) => rel(f.wrist)), meta.tPath).flat();
  const tips = resample(ts, frames.map((f) => [...rel(f.index), ...rel(f.pinky)]), meta.tPath).flat();
  let path = 0;
  for (let i = 1; i < frames.length; i++) {
    path += Math.hypot(frames[i]!.wrist[0] - frames[i - 1]!.wrist[0], frames[i]!.wrist[1] - frames[i - 1]!.wrist[1]);
  }
  return [...post, ...wrist, ...tips, path / palm, ts[ts.length - 1]! - ts[0]!];
}

/** Score every window length ending at the newest frame; returns the probabilities of the
 *  window whose best non-`none` class is most confident, or null when no window fills. */
export function scoreMotion(model: MlpModel, frames: readonly MotionFrame[], meta: MotionMeta = motionMeta(model)): number[] | null {
  if (!frames.length) return null;
  const none = model.labels.indexOf('none');
  const now = frames[frames.length - 1]!.t;
  let best: number[] | null = null;
  let bestSign = -1;
  for (const D of meta.windows) {
    const win = frames.filter((f) => f.t > now - D - 1e-9);
    if (win.length < meta.minFrames) continue;
    const p = mlpPredict(model, windowFeatures(win, meta));
    const sign = Math.max(...p.filter((_, i) => i !== none));
    if (sign > bestSign) {
      bestSign = sign;
      best = p;
    }
  }
  return best;
}
