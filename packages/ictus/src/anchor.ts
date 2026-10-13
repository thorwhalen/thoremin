/**
 * The anchor-detector seam (#374, body-movement A2): the hand's stroke detector behind
 * the {@link AnchorDetector} interface.
 *
 * `createIctusDetector` reads one point (`Sample`); a body reads many. The seam is
 * the frame of named points (`ChannelFrame`), so the stroke detector is adapted to read
 * ONE named channel of it and nothing about the stroke detector itself changes: the
 * adapter forwards each sample unchanged, which is what keeps the conducting fixtures'
 * scores bit for bit what they were. A frame that lacks the channel, or sees it below
 * `minVisibility`, is not a sample (the stroke detector's own gap rule restarts the
 * stroke after a long one).
 */
import { createIctusDetector, type DetectorOptions, type IctusDetector } from './detector';
import type { AnchorDetector, ChannelFrame, Sample } from './types';

/** The channel a bare {@link Sample} is filed under when it becomes a frame
 *  ({@link sampleFrame}), and the channel the stroke detector reads by default. */
export const POINT_CHANNEL = 'point';

/** A tracked point below this visibility is not seen (the body nodes' rule). */
export const MIN_VISIBILITY = 0.5;

/** One sample as a one-channel frame. */
export function sampleFrame(sample: Sample, channel: string = POINT_CHANNEL): ChannelFrame {
  return { t: sample.t, channels: { [channel]: sample } };
}

export interface StrokeDetectorOptions extends DetectorOptions {
  /** The channel to read. Default {@link POINT_CHANNEL}. */
  channel?: string;
  /** Below this visibility the point is not a sample. Default {@link MIN_VISIBILITY}. */
  minVisibility?: number;
}

/** The stroke detector as an {@link AnchorDetector}; `stroke` is the detector itself,
 *  for its envelope and jitter readouts. */
export interface StrokeDetector extends AnchorDetector {
  readonly stroke: IctusDetector;
}

/** Adapt an existing {@link IctusDetector} to the seam, reading one channel. */
export function asAnchorDetector(stroke: IctusDetector, { channel = POINT_CHANNEL, minVisibility = MIN_VISIBILITY }: { channel?: string; minVisibility?: number } = {}): StrokeDetector {
  return {
    stroke,
    push(frame) {
      const p = frame.channels[channel];
      if (!p || (p.visibility ?? 1) < minVisibility) return null;
      return stroke.push({ t: frame.t, x: p.x, y: p.y, z: p.z });
    },
    setPeriod: (period) => stroke.setPeriod(period),
    reset: () => stroke.reset(),
  };
}

/** The hand's stroke detector (turning points of one tracked point) behind the seam. */
export function createStrokeDetector(options: StrokeDetectorOptions = {}): StrokeDetector {
  const { channel, minVisibility, ...detector } = options;
  return asAnchorDetector(createIctusDetector(detector), { channel, minVisibility });
}

/** True for a detector instance, false for options (the `createIctus` switch). */
export function isAnchorDetector(d: unknown): d is AnchorDetector {
  return typeof d === 'object' && d !== null && typeof (d as AnchorDetector).push === 'function' && typeof (d as AnchorDetector).setPeriod === 'function';
}
