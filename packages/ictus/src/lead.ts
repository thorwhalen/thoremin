/**
 * The body conductor's per-player lead offset (#427, a follow-up of #375): how far each
 * joint's anchors land from the beat the player means, learned against a click and
 * subtracted from that joint's anchors before the prior sees them.
 *
 * Why it is needed. A joint's turning point is not the beat: A1 measured the trunk's
 * anchors 85 ms behind the hand's stroke on one conductor clip and 112 ms ahead of it on
 * another (#373; `docs/research/body-conducting-and-pose-categories.md`), and the impact
 * detector plays whichever joint it follows as the beat, uncorrected. The lag is a
 * property of the player's body (how the trunk rides the stroke), steady within a player
 * and different between players, so it is learned per player, not fixed in the detector.
 *
 * How it is learned. The player conducts a few bars against a click; every joint of the
 * set gets a detector of its own (`createImpactDetector` with that joint alone, its
 * period told from the click, so each joint's peaks are what the live detector would see
 * when it follows that joint), and each joint's anchors are read against the clicks
 * (`measureLeadLag`): the phase of every anchor inside its click interval, their circular
 * mean (so an anchor just before a click and one just after average to the click, not to
 * half a beat), turned into seconds by the median click interval. A joint is only given an
 * offset when its anchors lock to the click (resultant `minR`) and there are enough of them
 * (`minAnchors`): a joint that does not keep the beat (the trunk on A1's slow hymn) gets
 * none, and the conductor plays it as it is.
 *
 * Pure, causal (the calibration reads the frames in order), clock-free.
 */
import { median } from '@thoremin/stats';
import { createImpactDetector, BODY_IMPACT_JOINTS, type ImpactDetectorOptions, type ImpactJoint } from './visual_impact';
import type { Anchor, ChannelFrame } from './types';

/** A joint's anchors read against a click. */
export interface LeadLag {
  /** The anchors' circular-mean lag behind the clicks, seconds (negative: ahead). */
  lagS: number;
  /** The circular resultant of the anchors' phase in the click interval, 0..1. */
  r: number;
  /** Anchors read (inside the clicked span). */
  n: number;
}

/** Per joint (by channel): seconds to subtract from that joint's anchors. */
export type LeadOffsets = Readonly<Record<string, number>>;

export interface LeadOffsetOptions {
  /** A joint needs this many anchors inside the clicks. Default 8 (two bars of 4). */
  minAnchors?: number;
  /** ...and this resultant (its anchors lock to the click). Default 0.5. */
  minR?: number;
  /** An offset larger than this fraction of the click interval is refused (a joint at
   *  half a beat is at another level, not late). Default 0.35. */
  maxLagFraction?: number;
}

export const LEAD_OFFSET_DEFAULTS: Required<LeadOffsetOptions> = {
  minAnchors: 8,
  minR: 0.5,
  maxLagFraction: 0.35,
};

/** Phase difference wrapped to [-0.5, 0.5) cycles. */
const wrapCycle = (x: number): number => x - Math.floor(x + 0.5);

function circularMean(phases: readonly number[]): { mean: number; r: number } {
  let sx = 0;
  let sy = 0;
  for (const p of phases) {
    sx += Math.cos(2 * Math.PI * p);
    sy += Math.sin(2 * Math.PI * p);
  }
  return { mean: Math.atan2(sy, sx) / (2 * Math.PI), r: phases.length ? Math.hypot(sx, sy) / phases.length : 0 };
}

/**
 * The anchors' lag behind the clicks (at least two). Anchors outside the clicked span
 * are not read. The lag is a TRIMMED circular mean: the mean of the anchors within
 * `trimBeats` of the circular mean of them all, because a tracked joint's anchor that
 * lands half a beat off (a missed stroke, a stray turning point) would otherwise pull a
 * steady lag toward the middle of the beat. `r` is over every anchor read (whether the
 * joint keeps the click at all).
 */
export function measureLeadLag(anchors: readonly number[], clicks: readonly number[], { trimBeats = 0.25 }: { trimBeats?: number } = {}): LeadLag {
  const c = [...clicks].sort((a, b) => a - b);
  if (c.length < 2) return { lagS: NaN, r: 0, n: 0 };
  const ibis = c.slice(1).map((x, i) => x - c[i]);
  const phases: number[] = [];
  let i = 0;
  for (const a of [...anchors].sort((x, y) => x - y)) {
    if (a < c[0] - ibis[0] / 2 || a > c[c.length - 1] + ibis[ibis.length - 1] / 2) continue;
    while (i < c.length - 2 && a >= c[i + 1]) i++;
    phases.push((a - c[i]) / ibis[i]);
  }
  if (!phases.length) return { lagS: NaN, r: 0, n: 0 };
  const all = circularMean(phases);
  const kept = phases.filter((p) => Math.abs(wrapCycle(p - all.mean)) <= trimBeats);
  const lagBeats = kept.length ? circularMean(kept).mean : all.mean;
  return { lagS: lagBeats * median(ibis), r: all.r, n: phases.length };
}

/** The offsets of the joints whose anchors keep the click: `lagS` per joint that passes
 *  `minAnchors`, `minR` and `maxLagFraction` (of the median click interval). */
export function leadOffsetsFrom(lags: Readonly<Record<string, LeadLag>>, clickInterval: number, options: LeadOffsetOptions = {}): Record<string, number> {
  const o = { ...LEAD_OFFSET_DEFAULTS };
  for (const [k, v] of Object.entries(options)) if (v !== undefined) (o as Record<string, number>)[k] = v;
  const out: Record<string, number> = {};
  for (const [channel, l] of Object.entries(lags)) {
    if (l.n >= o.minAnchors && l.r >= o.minR && Number.isFinite(l.lagS) && Math.abs(l.lagS) <= o.maxLagFraction * clickInterval) out[channel] = l.lagS;
  }
  return out;
}

/**
 * Correct an anchor by its joint's offset: its time moved by `-offsets[anchor.channel]`.
 * An anchor with no channel, or a joint with no offset, is returned unchanged (the same
 * object). A joint that LEADS the beat moves its anchor later, possibly past the frame
 * that produced it: the caller delivers such an anchor when its time comes
 * (`createLeadCorrector`), never early.
 */
export function shiftAnchor(anchor: Anchor, offsets: LeadOffsets | undefined): Anchor {
  const off = anchor.channel !== undefined ? offsets?.[anchor.channel] : undefined;
  if (off === undefined || !Number.isFinite(off) || off === 0) return anchor;
  return { ...anchor, t: anchor.t - off };
}

/** Corrects a detector's anchors by their joints' offsets and holds a corrected anchor
 *  that lies ahead of the frame until a frame reaches it (causal: a leading joint says
 *  the beat is coming; it is played when it comes). */
export interface LeadCorrector {
  /** The anchor to feed at frame time `t` (the detector's anchor this frame, or null),
   *  corrected; null while nothing is due. */
  push(anchor: Anchor | null, t: number): Anchor | null;
  /** The offsets in use (a new object replaces them; a held anchor keeps its time). */
  setOffsets(offsets: LeadOffsets | undefined): void;
  reset(): void;
}

export function createLeadCorrector(offsets?: LeadOffsets): LeadCorrector {
  let current = offsets;
  let pending: Anchor | null = null;
  return {
    push(anchor, t) {
      const fresh = anchor ? shiftAnchor(anchor, current) : null;
      // A held anchor whose time has come is delivered first; a fresh one behind it (a
      // leading joint's next peak cannot be, by the refractory) is dropped rather than
      // fed out of order.
      if (pending && pending.t <= t) {
        const due = pending;
        pending = fresh && fresh.t > t ? fresh : null;
        return due;
      }
      if (!fresh) return null;
      if (fresh.t <= t) return fresh;
      // A newer one replaces an anchor still held.
      pending = fresh;
      return null;
    },
    setOffsets(next) {
      current = next;
    },
    reset() {
      pending = null;
    },
  };
}

export interface LeadCalibrationOptions extends Omit<ImpactDetectorOptions, 'joints' | 'combine'>, LeadOffsetOptions {
  /** The joints to calibrate. Default the body conductor's set ({@link BODY_IMPACT_JOINTS}). */
  joints?: ReadonlyArray<ImpactJoint | string>;
}

/** The calibration's result: every joint's lag, and the offsets of those that passed. */
export interface LeadCalibrationResult {
  lags: Record<string, LeadLag>;
  offsets: Record<string, number>;
  /** The median click interval the offsets were bounded by, seconds. */
  clickInterval: number;
}

/** A calibration take: frames in, then `result(clicks)`. */
export interface LeadCalibration {
  /** Feed one frame (in time order). */
  push(frame: ChannelFrame): void;
  /** Tell the detectors the beat's period (the click interval), seconds. */
  setPeriod(period: number): void;
  /** Each joint's anchors so far (channel to times). */
  anchors(): Record<string, number[]>;
  /** The lags and offsets against these click times (the times the player HEARD them, on
   *  the frames' clock). */
  result(clicks: readonly number[]): LeadCalibrationResult;
  reset(): void;
}

export function createLeadCalibration(options: LeadCalibrationOptions = {}): LeadCalibration {
  const { joints = BODY_IMPACT_JOINTS, minAnchors, minR, maxLagFraction, ...detector } = options;
  const names = joints.map((j) => (typeof j === 'string' ? j : j.channel));
  const make = () => names.map((channel) => ({ channel, detector: createImpactDetector({ ...detector, joints: [channel] }), anchors: [] as number[] }));
  let per = make();
  return {
    push(frame) {
      for (const j of per) {
        const a = j.detector.push(frame);
        if (a) j.anchors.push(a.t);
      }
    },
    setPeriod(period) {
      for (const j of per) j.detector.setPeriod(period);
    },
    anchors: () => Object.fromEntries(per.map((j) => [j.channel, [...j.anchors]])),
    result(clicks) {
      const sorted = [...clicks].sort((a, b) => a - b);
      const ibis = sorted.slice(1).map((x, i) => x - sorted[i]);
      const clickInterval = ibis.length ? median(ibis) : NaN;
      const lags = Object.fromEntries(per.map((j) => [j.channel, measureLeadLag(j.anchors, sorted)]));
      return { lags, offsets: leadOffsetsFrom(lags, clickInterval, { minAnchors, minR, maxLagFraction }), clickInterval };
    },
    reset() {
      per = make();
    },
  };
}
