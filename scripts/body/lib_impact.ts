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
 * The frame builder is the conductor's own (`src/nodes/features/conductor_body.ts`, A3),
 * so what these scorers print is what the body conductor plays from.
 */
import { createIctus, type AnchorDetector, type ChannelFrame } from '@thoremin/ictus';
import { bodyChannelFrame } from '@/nodes/features/conductor_body';
import { scoreLevel, scoringSpans, type LevelScore } from './lib_channels';
import { beatingWrist, type BodyClip } from './lib_clips';

export { bodyChannelFrame };

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
