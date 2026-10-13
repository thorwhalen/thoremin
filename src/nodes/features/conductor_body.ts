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
