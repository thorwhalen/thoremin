/**
 * The conductor's body source (#375, body-movement A3): a pose frame as the named points
 * the body's anchor detector reads, which joints each body point follows, and the body's
 * quantity of motion for the speed fallback.
 *
 * Why a separate module: the frame builder is shared by the `conductor` node and the
 * offline scorers in `scripts/body/` (A2 replayed its detector on A1's fixtures through a
 * copy of it), and a scorer must read the same channels the instrument plays from, or a
 * number it prints says nothing about the instrument.
 *
 * The channels (A1's measured set, `docs/research/body-conducting-and-pose-categories.md`):
 * the beating `wrist` and its `elbow`, the `trunk` centroid (the midpoint of the
 * shoulders' and the hips' midpoints, the body's own beat), plus the `head` (the nose)
 * and the `hips` midpoint (the bounce), which A1 found weaker and which are offered as
 * points, never as defaults. Positions are image pixels and the frame's `scale` is the
 * image torso length, which is the unit the detector measures in.
 *
 * Pose landmarks are named by the player's anatomical side (MediaPipe Pose labels the
 * person, not the image), so the beating side needs no handedness mirroring, unlike the
 * hands. With the side `auto` both arms are channels (`wrist.right`, `wrist.left`, ...)
 * and the detector's `select` follows whichever arm shows a rhythm: the arm that is not
 * beating has none, so it is never followed (A2's live rule, §3 of its notes on #386).
 */
import { BODY_IMPACT_JOINTS, type ChannelFrame, type ChannelPoint, type ImpactJoint } from '@thoremin/ictus';
import { BLM, type BodyFrame } from '@thoremin/sdk/nodes/domain';

/** What the body conductor follows: the multi-joint impact detector (A2), or one point. */
export const CONDUCTOR_BODY_POINTS = ['impact', 'wrist', 'head', 'hips', 'com'] as const;
export type ConductorBodyPoint = (typeof CONDUCTOR_BODY_POINTS)[number];
/** The beating side; `auto` lets the detector follow whichever arm has a rhythm. */
export type BodySide = 'left' | 'right' | 'auto';

const SIDES = ['right', 'left'] as const;

/** One pose frame as the conductor's channel set; a landmark the tracker did not report
 *  is absent. With a fixed side the arm channels are `wrist` / `elbow` (A2's names);
 *  with `auto` they carry the side (`wrist.right`, `wrist.left`, ...). */
export function bodyChannelFrame(f: BodyFrame, t: number, side: BodySide): ChannelFrame {
  if (!f.present) return { t, channels: {} };
  const pt = (j: number): ChannelPoint | undefined => {
    const p = f.landmarks[j];
    return p ? { x: p.x, y: p.y, visibility: f.visibility[j] ?? 1 } : undefined;
  };
  const mid = (p: ChannelPoint | undefined, q: ChannelPoint | undefined): ChannelPoint | undefined =>
    p && q ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, visibility: Math.min(p.visibility ?? 1, q.visibility ?? 1) } : undefined;
  const shoulders = mid(pt(BLM.left_shoulder), pt(BLM.right_shoulder));
  const hips = mid(pt(BLM.left_hip), pt(BLM.right_hip));
  const scale = shoulders && hips ? Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y) : undefined;
  const channels: Record<string, ChannelPoint | undefined> = { trunk: mid(shoulders, hips), head: pt(BLM.nose), hips };
  const arm = (s: 'left' | 'right') => ({
    wrist: pt(s === 'right' ? BLM.right_wrist : BLM.left_wrist),
    elbow: pt(s === 'right' ? BLM.right_elbow : BLM.left_elbow),
  });
  if (side === 'auto') {
    for (const s of SIDES) {
      const a = arm(s);
      channels[`wrist.${s}`] = a.wrist;
      channels[`elbow.${s}`] = a.elbow;
    }
  } else Object.assign(channels, arm(side));
  return { t, scale, channels };
}

/** The joints the detector follows for a body point and a side (A1's defaults for
 *  `impact`; one channel for a single point). */
export function conductorBodyJoints(point: ConductorBodyPoint, side: BodySide): ImpactJoint[] {
  const perSide = (channel: string): string[] => (side === 'auto' ? SIDES.map((s) => `${channel}.${s}`) : [channel]);
  switch (point) {
    case 'impact':
      return BODY_IMPACT_JOINTS.flatMap((j) => (j.channel === 'trunk' ? [j] : perSide(j.channel).map((channel) => ({ channel, weight: j.weight }))));
    case 'wrist':
      return perSide('wrist').map((channel) => ({ channel }));
    case 'head':
      return [{ channel: 'head' }];
    case 'hips':
      return [{ channel: 'hips' }];
    case 'com':
      return [{ channel: 'trunk' }];
  }
}

/** Below this visibility a landmark does not count toward the quantity of motion (the
 *  body catalog's `body.kin.qom` threshold). */
const QOM_MIN_VISIBILITY = 0.2;

/** Torso length in pixels (shoulder midpoint to hip midpoint), or undefined. */
function torsoPx(f: BodyFrame): number | undefined {
  const L = f.landmarks;
  const ls = L[BLM.left_shoulder];
  const rs = L[BLM.right_shoulder];
  const lh = L[BLM.left_hip];
  const rh = L[BLM.right_hip];
  if (!ls || !rs || !lh || !rh) return undefined;
  const d = Math.hypot((ls.x + rs.x - lh.x - rh.x) / 2, (ls.y + rs.y - lh.y - rh.y) / 2);
  return d > 1e-9 ? d : undefined;
}

/**
 * Quantity of motion between two pose frames `dtS` apart: the visibility-weighted mean
 * landmark speed in torso lengths per second (the body catalog's `body.kin.qom`, in the
 * image plane). What the body conductor's speed fallback reads where the hand reads its
 * point's speed. Undefined when either frame has no body or no torso.
 */
export function bodyQuantityOfMotion(prev: BodyFrame, cur: BodyFrame, dtS: number): number | undefined {
  if (!prev.present || !cur.present || !(dtS > 0)) return undefined;
  const torso = torsoPx(prev);
  if (!torso) return undefined;
  let num = 0;
  let den = 0;
  const n = Math.min(prev.landmarks.length, cur.landmarks.length);
  for (let i = 0; i < n; i++) {
    const w = Math.min(prev.visibility[i] ?? 1, cur.visibility[i] ?? 1);
    if (w < QOM_MIN_VISIBILITY) continue;
    num += Math.hypot(cur.landmarks[i].x - prev.landmarks[i].x, cur.landmarks[i].y - prev.landmarks[i].y) * w;
    den += w;
  }
  return den > 0 ? num / den / torso / dtS : undefined;
}

/**
 * What the body's transport rules read (#377, body-movement A5): how high the beating arm
 * is, and how much the arms move, in noise units.
 *
 * - `raise`: the wrist's height on the torso, 0 at the hip midpoint and 1 at the shoulder
 *   midpoint (torso lengths, so a closer camera changes nothing). A conductor beats between
 *   about 0.3 and 1.2; a hanging arm reads about 0. With the side `auto` it is the higher of
 *   the two wrists (either arm raised is raised, both arms down is dropped). A wrist the
 *   tracker does not see (visibility below `minVisibility`, usually below the frame of a
 *   waist-up player) is extrapolated from its elbow along the upper arm, the position of a
 *   hanging forearm; undefined when neither is seen or there is no torso.
 * - `motion`: the beating arm's frame-to-frame displacement (its wrist and elbow, the seen
 *   ones; with the side `auto`, the arm whose wrist is higher) over
 *   the tracker's own jitter, smoothed over `motionTauS`. The jitter is the body's: per
 *   frame, the median over every seen landmark of the second difference (most landmarks of
 *   a conductor are near still, and a second difference rejects a smooth movement),
 *   converted to a step's jitter (white noise: a second difference has sqrt(3) times the
 *   spread of a first one), and the jitter is the median (`jitterQuantile`) of those
 *   per-frame values over the last `jitterWindowS`. Movement only ever inflates the
 *   per-frame value, so the median ignores an impact, a player settling in front of the
 *   camera, or a whole-body shake while the pose model locks on, as soon as half the window
 *   is quiet; an exponential average kept such a start several times too large
 *   for seconds, and the upbeat unseen (the review of #377). A still body reads about 1;
 *   a stroke reads tens.
 */
export interface BodyTransportCues {
  raise?: number;
  motion?: number;
}

export interface BodyMotionMeterOptions {
  /** Below this visibility a landmark is not seen. */
  minVisibility?: number;
  /** Smoothing of the arms' motion, seconds. */
  motionTauS?: number;
  /** The window the jitter is read over, seconds. */
  jitterWindowS?: number;
  /** The jitter is this quantile of the per-frame values in the window. */
  jitterQuantile?: number;
  /** The jitter's floor, torso lengths per frame (a noise-free synthetic skeleton has none). */
  minJitter?: number;
}

export const BODY_MOTION_DEFAULTS: Required<BodyMotionMeterOptions> = {
  minVisibility: 0.5,
  motionTauS: 0.15,
  jitterWindowS: 4,
  jitterQuantile: 0.5,
  minJitter: 5e-4,
};

export interface BodyMotionMeter {
  /** Fold one pose frame in (`t` non-decreasing) and return its cues. */
  push(f: BodyFrame, t: number, side: BodySide): BodyTransportCues;
  /** The current jitter estimate, torso lengths per step (NaN before the first). */
  jitter(): number;
  reset(): void;
}

const ARM_JOINTS = { left: [BLM.left_wrist, BLM.left_elbow], right: [BLM.right_wrist, BLM.right_elbow] } as const;

/** The wrist's height on the torso (see {@link BodyTransportCues}), for one side. */
function armRaise(f: BodyFrame, s: 'left' | 'right', minVisibility: number): number | undefined {
  const L = f.landmarks;
  const V = f.visibility;
  const ls = L[BLM.left_shoulder];
  const rs = L[BLM.right_shoulder];
  const lh = L[BLM.left_hip];
  const rh = L[BLM.right_hip];
  if (!ls || !rs || !lh || !rh) return undefined;
  const shY = (ls.y + rs.y) / 2;
  const hipY = (lh.y + rh.y) / 2;
  const torso = hipY - shY;
  if (!(torso > 1e-9)) return undefined;
  const [sh, el, wr] = s === 'right' ? [BLM.right_shoulder, BLM.right_elbow, BLM.right_wrist] : [BLM.left_shoulder, BLM.left_elbow, BLM.left_wrist];
  const seen = (j: number) => !!L[j] && (V[j] ?? 1) >= minVisibility;
  let y: number | undefined;
  if (seen(wr)) y = L[wr].y;
  else if (seen(el) && L[sh]) y = L[el].y + (L[el].y - L[sh].y);
  return y === undefined ? undefined : (hipY - y) / torso;
}

export function createBodyMotionMeter(options: BodyMotionMeterOptions = {}): BodyMotionMeter {
  const o = { ...BODY_MOTION_DEFAULTS, ...options };
  let prev: { t: number; f: BodyFrame } | null = null;
  let prev2: BodyFrame | null = null;
  let jitter = NaN;
  /** The per-frame jitter values in the window, with their times. */
  let steps: { t: number; v: number }[] = [];
  /** The smoothed motion per arm (noise units). */
  let motion: Record<'left' | 'right', number | undefined> = { left: undefined, right: undefined };
  const reset = () => {
    prev = null;
    prev2 = null;
    jitter = NaN;
    steps = [];
    motion = { left: undefined, right: undefined };
  };
  return {
    jitter: () => jitter,
    reset,
    push(f, t, side) {
      if (!f.present) {
        prev = null;
        prev2 = null;
        return {};
      }
      // The beating arm: the named side, or with `auto` the higher wrist (its height and its
      // own motion, so the other arm's gestures do not read as the beating arm's).
      const sides = side === 'auto' ? SIDES : ([side] as const);
      const raiseOf = { left: undefined as number | undefined, right: undefined as number | undefined };
      for (const sd of sides) raiseOf[sd] = armRaise(f, sd, o.minVisibility);
      let beating: 'left' | 'right' = side === 'auto' ? 'right' : side;
      if (side === 'auto' && (raiseOf.right === undefined || (raiseOf.left !== undefined && raiseOf.left > raiseOf.right))) beating = 'left';
      const raise = raiseOf[beating];
      const cues = (): BodyTransportCues => ({ raise, motion: motion[beating] });
      const torso = torsoPx(f);
      const dt = prev ? t - prev.t : 0;
      if (!prev || !torso || !(dt > 0)) {
        prev2 = null;
        prev = { t, f };
        return cues();
      }
      const p = prev.f;
      const seen = (fr: BodyFrame, j: number) => !!fr.landmarks[j] && (fr.visibility[j] ?? 1) >= o.minVisibility;
      // The jitter: the median second difference over the landmarks seen in all three frames.
      if (prev2) {
        const q = prev2;
        const d2: number[] = [];
        const n = Math.min(f.landmarks.length, p.landmarks.length, q.landmarks.length);
        for (let j = 0; j < n; j++) {
          if (!seen(f, j) || !seen(p, j) || !seen(q, j)) continue;
          const a = f.landmarks[j];
          const b = p.landmarks[j];
          const c = q.landmarks[j];
          d2.push(Math.hypot(a.x - 2 * b.x + c.x, a.y - 2 * b.y + c.y) / torso);
        }
        if (d2.length) {
          d2.sort((x, y) => x - y);
          const step = d2[d2.length >> 1] / Math.SQRT2 / Math.sqrt(1.5);
          steps.push({ t, v: step });
          while (steps.length && steps[0].t < t - o.jitterWindowS) steps.shift();
          const w = steps.map((x) => x.v).sort((x, y) => x - y);
          jitter = w[Math.min(w.length - 1, Math.floor(o.jitterQuantile * w.length))];
        }
      }
      // Each arm's displacement this step (its wrist and elbow, the seen ones), in noise units.
      for (const sd of sides) {
        let sum = 0;
        let count = 0;
        for (const j of ARM_JOINTS[sd]) {
          if (!seen(f, j) || !seen(p, j)) continue;
          sum += Math.hypot(f.landmarks[j].x - p.landmarks[j].x, f.landmarks[j].y - p.landmarks[j].y) / torso;
          count++;
        }
        if (!count || !Number.isFinite(jitter)) continue;
        const nu = sum / count / Math.max(jitter, o.minJitter);
        const a = 1 - Math.exp(-dt / o.motionTauS);
        const m = motion[sd];
        motion[sd] = m === undefined ? nu : m + a * (nu - m);
      }
      prev2 = p;
      prev = { t, f };
      return cues();
    },
  };
}

/**
 * What the body says about expression, per pose frame (#378, body-movement A6): the
 * channels `createExpressionBlend` (ictus) normalises per player and blends with the
 * strokes' own dynamics.
 *
 * - `motion`: the quantity of motion ({@link bodyQuantityOfMotion}, torso lengths per second).
 * - `extension`: how straight the beating arm is, the shoulder-to-wrist distance over the
 *   upper arm plus the forearm (0 folded .. 1 straight). The arm's own segments are the
 *   unit, so neither the camera's distance nor the player's size enters. The catalog's
 *   `body.shape.extension` (head, hands and feet from the hips) is not used: a waist-up
 *   conductor has no feet in frame, and the arm is what reaches out on a loud beat.
 * - `jerk`: the beating wrist's third derivative through its last four positions at their
 *   own frame times (a dropped frame is not a jolt), in torso lengths (Laban flow, the
 *   catalog's `body.effort.flow` idea on the one point that beats). Not a median: a sharp
 *   stroke's jerk IS a one- or two-frame spike at the impact, which a median removes; so a
 *   single tracker glitch also reads as a jolt for about the blend's smoothing (#146 A6.3).
 *
 * The beating arm is the named side, or with `auto` the arm whose wrist is higher (the
 * transport's choice). A landmark below `minVisibility` is unseen; an unseen channel is
 * absent rather than zero.
 */
export interface BodyExpressionMeter {
  push(f: BodyFrame, t: number, side: BodySide): { t: number; motion?: number; extension?: number; jerk?: number };
  reset(): void;
}

/** The third derivative's magnitude through four samples at their OWN times (Newton's
 *  divided differences, times 6): zero for any constant velocity or acceleration however
 *  the frames are spaced, so a dropped frame is not a jolt. Undefined for a repeated time. */
function thirdDerivative(p: readonly { t: number; x: number; y: number }[]): number | undefined {
  const axis = (k: 'x' | 'y'): number | undefined => {
    let d = p.map((q) => q[k]);
    for (let order = 1; order <= 3; order++) {
      const next: number[] = [];
      for (let i = 0; i + order < p.length; i++) {
        const dt = p[i + order].t - p[i].t;
        if (!(dt > 0)) return undefined;
        next.push((d[i + 1] - d[i]) / dt);
      }
      d = next;
    }
    return 6 * d[0];
  };
  const jx = axis('x');
  const jy = axis('y');
  return jx === undefined || jy === undefined ? undefined : Math.hypot(jx, jy);
}

export function createBodyExpressionMeter({ minVisibility = BODY_MOTION_DEFAULTS.minVisibility } = {}): BodyExpressionMeter {
  let prev: { t: number; f: BodyFrame } | null = null;
  /** The beating wrist's last positions (torso lengths) and times, newest last. */
  let wrists: { t: number; x: number; y: number; side: 'left' | 'right' }[] = [];
  return {
    reset() {
      prev = null;
      wrists = [];
    },
    push(f, t, side) {
      if (!f.present) {
        prev = null;
        wrists = [];
        return { t };
      }
      const motion = prev ? bodyQuantityOfMotion(prev.f, f, t - prev.t) : undefined;
      prev = { t, f };
      const torso = torsoPx(f);
      let beating: 'left' | 'right' = side === 'auto' ? 'right' : side;
      if (side === 'auto') {
        const r = armRaise(f, 'right', minVisibility);
        const l = armRaise(f, 'left', minVisibility);
        if (r === undefined || (l !== undefined && l > r)) beating = 'left';
      }
      const [sh, el, wr] = beating === 'right' ? [BLM.right_shoulder, BLM.right_elbow, BLM.right_wrist] : [BLM.left_shoulder, BLM.left_elbow, BLM.left_wrist];
      const seen = (j: number) => !!f.landmarks[j] && (f.visibility[j] ?? 1) >= minVisibility;
      const d = (a: number, b: number) => Math.hypot(f.landmarks[a].x - f.landmarks[b].x, f.landmarks[a].y - f.landmarks[b].y);
      let extension: number | undefined;
      if (seen(sh) && seen(el) && seen(wr)) {
        const limb = d(sh, el) + d(el, wr);
        if (limb > 1e-9) extension = Math.min(1, d(sh, wr) / limb);
      }
      let jerk: number | undefined;
      if (torso && seen(wr)) {
        const w = f.landmarks[wr];
        if (wrists.length && wrists[wrists.length - 1].side !== beating) wrists = [];
        wrists.push({ t, x: w.x / torso, y: w.y / torso, side: beating });
        if (wrists.length > 4) wrists.shift();
        if (wrists.length === 4) {
          jerk = thirdDerivative(wrists);
        }
      } else wrists = [];
      return { t, motion, extension, jerk };
    },
  };
}
