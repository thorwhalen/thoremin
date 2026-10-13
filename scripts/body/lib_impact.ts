/**
 * The body's anchor detectors replayed on the body fixtures (#374, body-movement A2).
 *
 * A pose stream becomes `ChannelFrame`s with A1's channel set (the beating `wrist`, its
 * `elbow`, the `trunk` centroid: the midpoint of the shoulders' and the hips'
 * midpoints) in image pixels, with the image torso length as the frame's `scale`; a
 * detector behind the `AnchorDetector` seam runs over them causally through
 * `createIctus` (so the refractory tracks the follower's period, as it will live), and
 * its anchors are scored at the beat level against the clip's grid with A1's scorer
 * (`scoreLevel`: F at ±70 ms, F after the anchors' mean lag, R and its Rayleigh p).
 *
 * The frame builder is what the conductor's body source (A3) needs too; it lives here
 * until a node consumes it.
 */
import { BLM, type BodyFrame } from '@thoremin/sdk/nodes/domain';
import { createIctus, type AnchorDetector, type ChannelFrame, type ChannelPoint } from '@thoremin/ictus';
import { scoreLevel, scoringSpans, type LevelScore } from './lib_channels';
import { beatingWrist, type BodyClip } from './lib_clips';

/** One pose frame as A1's channel set; a landmark the tracker did not report is absent. */
export function bodyChannelFrame(f: BodyFrame, t: number, side: 'left' | 'right'): ChannelFrame {
  if (!f.present) return { t, channels: {} };
  const pt = (j: number): ChannelPoint | undefined => {
    const p = f.landmarks[j];
    return p ? { x: p.x, y: p.y, visibility: f.visibility[j] ?? 1 } : undefined;
  };
  const mid = (a: number, b: number): ChannelPoint | undefined => {
    const p = pt(a);
    const q = pt(b);
    return p && q ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, visibility: Math.min(p.visibility ?? 1, q.visibility ?? 1) } : undefined;
  };
  const shoulders = mid(BLM.left_shoulder, BLM.right_shoulder);
  const hips = mid(BLM.left_hip, BLM.right_hip);
  const trunk = shoulders && hips ? { x: (shoulders.x + hips.x) / 2, y: (shoulders.y + hips.y) / 2, visibility: Math.min(shoulders.visibility ?? 1, hips.visibility ?? 1) } : undefined;
  const scale = shoulders && hips ? Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y) : undefined;
  const r = side === 'right';
  return {
    t,
    scale,
    channels: {
      wrist: pt(r ? BLM.right_wrist : BLM.left_wrist),
      elbow: pt(r ? BLM.right_elbow : BLM.left_elbow),
      trunk,
    },
  };
}

export function clipFrames(clip: BodyClip): ChannelFrame[] {
  const side = clip.referenceWrist ?? beatingWrist(clip.frames);
  return clip.frames.map((f, i) => bodyChannelFrame(f, i / clip.fps, side));
}

/** The anchors a detector gives over a clip, through the follower. */
export function replayAnchors(frames: readonly ChannelFrame[], detector: AnchorDetector): number[] {
  const ictus = createIctus({ detector });
  const out: number[] = [];
  for (const f of frames) {
    const s = ictus.feedFrame(f);
    if (s.anchor) out.push(s.anchor.t);
  }
  return out;
}

/** A detector's anchors scored at the beat level against the clip's grid. */
export function scoreBeat(clip: BodyClip, anchors: readonly number[]): LevelScore {
  const spans = scoringSpans(clip.grid, 0, clip.frames.length / clip.fps);
  return scoreLevel(anchors, clip.grid, 1, spans);
}
