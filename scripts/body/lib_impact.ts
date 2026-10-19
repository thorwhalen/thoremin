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
 * The frame builder is the conductor's own (`src/slices/conductor/nodes/conductor_body.ts`, A3),
 * so what these scorers print is what the body conductor plays from.
 */
import { createIctus, createImpactDetector, createLeadCalibration, createLeadCorrector, type AnchorDetector, type ChannelFrame, type LeadOffsets } from '@thoremin/ictus';
import { median } from '@thoremin/stats';
import { bodyChannelFrame } from '@/slices/conductor/nodes/conductor_body';
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

/** The lead-offset calibration (#427) over the clip from `from` to `until`, the grid as the
 *  click (on the conductor clips, the beating wrist's strokes). */
export function calibrate(clip: BodyClip, from: number, until: number) {
  const frames = clipFrames(clip).filter((f) => f.t >= from && f.t < until);
  const clicks = clip.grid.filter((g) => g >= from && g < until);
  const cal = createLeadCalibration();
  cal.setPeriod(median(clicks.slice(1).map((g, i) => g - clicks[i])));
  for (const f of frames) cal.push(f);
  return cal.result(clicks);
}

/** The follower's anchors with `joints` followed, corrected by `offsets`. */
export function followAnchors(clip: BodyClip, joints: string[], offsets?: LeadOffsets): number[] {
  const ictus = createIctus({ detector: createImpactDetector({ joints }) });
  const lead = createLeadCorrector(offsets);
  const out: number[] = [];
  for (const f of clipFrames(clip)) {
    // The node's refractory on the corrected anchors (conductor.ts): a quarter period.
    const period = ictus.state().period;
    const a = lead.push(ictus.detector.push(f), f.t, Number.isFinite(period) && period > 0 ? 0.25 * period : 0);
    if (a) {
      ictus.feedAnchor(a);
      out.push(a.t);
    } else ictus.advance(f.t);
  }
  return out;
}
