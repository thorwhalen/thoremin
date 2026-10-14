/**
 * The body conductor's per-player lead offset (#427, a follow-up of #375): how far each
 * joint's anchors land from the beat the player means, learned against a click and
 * subtracted from that joint's anchors before the prior sees them.
 *
 * Why it is needed. A joint's turning point is not the beat: A1 measured the trunk's
 * anchors 85 ms behind the hand's stroke on one conductor clip and 112 ms ahead of it on
 * another (#373; `docs/research/body-conducting-and-pose-categories.md`), and the impact
 * detector plays whichever joint it follows as the beat, uncorrected. If the lag is a
 * property of the player's body (how the trunk rides the stroke), it is learned per player,
 * not fixed in the detector.
 *
 * How it is learned. The player conducts a few bars against a click; every joint of the
 * set gets a follower of its own (`createImpactDetector` with that joint alone and a
 * rhythm prior setting its period, seeded at the click's tempo, so each joint's peaks are
 * what the live conductor would see when it follows that joint), and each joint's anchors are read against the clicks
 * (`measureLeadLag`): the phase of every anchor inside its click interval, their trimmed
 * circular mean (so an anchor just before a click and one just after average to the click,
 * not to half a beat), turned into seconds by the median click interval.
 *
 * When it is kept. Only when the take MEASURED it (`leadRefusal` null): enough anchors that
 * lock to the click (`minAnchors`, `minR`), a lag under `maxLagFraction` of a beat, a
 * standard error of the mean under `maxStandardErrorS`, and the take's two halves agreeing
 * within `maxHalfGapS`. The last two are what A1's fixtures demanded (§5.2 of the research
 * doc): the trunk's anchors scatter about ±100 ms, so sixteen strokes measure its mean to
 * about ±25 ms, and on the one clip where it keeps the beat its lag moved by 70 ms between
 * the halves of a 24 s take; the resultant alone accepted it, and the offset then moved the
 * next half as much as it corrected. A joint that is not kept is played as it lands.
 *
 * The keys are side-free. A joint followed on a named side is the channel `wrist`, the
 * same joint read with `hand: auto` is `wrist.left` or `wrist.right` (the conductor's
 * frame builder); an offset is the player's, so {@link leadJointKey} strips the side and
 * {@link shiftAnchor} reads the side-free key.
 *
 * Pure, causal (the calibration reads the frames in order), clock-free.
 */
import { median } from '@thoremin/stats';
import { createImpactDetector, BODY_IMPACT_JOINTS, type ImpactDetectorOptions, type ImpactJoint } from './visual_impact';
import { createRhythmPrior, DEFAULT_RHYTHM_PRIOR, type RhythmPriorKind, type RhythmPriorOptions } from './priors';
import type { Anchor, ChannelFrame } from './types';

/** A joint's anchors read against a click. */
export interface LeadLag {
  /** The anchors' trimmed circular-mean lag behind the clicks, seconds (negative: ahead). */
  lagS: number;
  /** The circular resultant of every anchor's phase in the click interval, 0..1. */
  r: number;
  /** Anchors read (inside the clicked span). */
  n: number;
  /** The standard error of `lagS`, seconds: the kept anchors' circular spread over the
   *  square root of their count (Infinity with fewer than two). */
  seS: number;
  /** Anchors the trim kept (within `trimBeats` of the mean of all). */
  kept: number;
  /** The lag over the first and the second half of the clicks, seconds (NaN when a half
   *  has no anchor). */
  halves: readonly [number, number];
}

/** Per joint (side-free, {@link leadJointKey}): seconds to subtract from its anchors. */
export type LeadOffsets = Readonly<Record<string, number>>;

export interface LeadOffsetOptions {
  /** A joint needs this many anchors inside the clicks. Default 8. */
  minAnchors?: number;
  /** ...a resultant at least this (its anchors lock to the click). Default 0.5. */
  minR?: number;
  /** An offset larger than this fraction of the click interval is refused (a joint at
   *  half a beat is at another level, not late). Default 0.35. */
  maxLagFraction?: number;
  /** ...a standard error of the lag at most this, seconds. Default 0.02 (the ±20 ms the
   *  correction is for: a lag measured more loosely than that corrects nothing). */
  maxStandardErrorS?: number;
  /** ...and the two halves' lags within this of each other, seconds. Default 0.04. */
  maxHalfGapS?: number;
}

export const LEAD_OFFSET_DEFAULTS: Required<LeadOffsetOptions> = {
  minAnchors: 8,
  minR: 0.5,
  maxLagFraction: 0.35,
  maxStandardErrorS: 0.02,
  maxHalfGapS: 0.04,
};

/** Why a joint's lag was not kept: too few anchors, no lock to the click, at another
 *  level, measured too loosely, or moving between the take's halves. */
export type LeadRefusal = 'anchors' | 'lock' | 'level' | 'loose' | 'drift';

/** The side-free key of a channel: `wrist.left` → `wrist`, `trunk` → `trunk`. */
export function leadJointKey(channel: string): string {
  const dot = channel.indexOf('.');
  return dot < 0 ? channel : channel.slice(0, dot);
}

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

/** The trimmed circular mean of phases (cycles): the mean of those within `trim` of the
 *  mean of them all, with the kept ones' resultant and count. */
function trimmedMean(phases: readonly number[], trim: number): { mean: number; r: number; n: number } {
  const all = circularMean(phases);
  const kept = phases.filter((p) => Math.abs(wrapCycle(p - all.mean)) <= trim);
  if (!kept.length) return { mean: all.mean, r: all.r, n: phases.length };
  const k = circularMean(kept);
  return { mean: k.mean, r: k.r, n: kept.length };
}

/**
 * The anchors' lag behind the clicks (at least two). Anchors outside the clicked span
 * are not read. The lag is a TRIMMED circular mean: the mean of the anchors within
 * `trimBeats` of the circular mean of them all, because a tracked joint's anchor that
 * lands half a beat off (a missed stroke, a stray turning point) would otherwise pull a
 * steady lag toward the middle of the beat. `r` is over every anchor read (whether the
 * joint keeps the click at all); the standard error is over the kept ones.
 */
export function measureLeadLag(anchors: readonly number[], clicks: readonly number[], { trimBeats = 0.25 }: { trimBeats?: number } = {}): LeadLag {
  const c = [...clicks].sort((a, b) => a - b);
  const none: LeadLag = { lagS: NaN, r: 0, n: 0, seS: Infinity, kept: 0, halves: [NaN, NaN] };
  if (c.length < 2) return none;
  const ibis = c.slice(1).map((x, i) => x - c[i]);
  const beat = median(ibis);
  const mid = c[Math.floor(c.length / 2)] - beat / 2;
  const read: Array<{ t: number; p: number }> = [];
  let i = 0;
  for (const a of [...anchors].sort((x, y) => x - y)) {
    if (a < c[0] - ibis[0] / 2 || a > c[c.length - 1] + ibis[ibis.length - 1] / 2) continue;
    while (i < c.length - 2 && a >= c[i + 1]) i++;
    read.push({ t: a, p: (a - c[i]) / ibis[i] });
  }
  if (!read.length) return none;
  const phases = read.map((x) => x.p);
  const m = trimmedMean(phases, trimBeats);
  // The circular standard deviation of the kept phases, in seconds.
  const sd = m.r > 0 ? (Math.sqrt(-2 * Math.log(Math.min(1, m.r))) / (2 * Math.PI)) * beat : Infinity;
  const half = (first: boolean): number => {
    const ps = read.filter((x) => (x.t < mid) === first).map((x) => x.p);
    return ps.length ? trimmedMean(ps, trimBeats).mean * beat : NaN;
  };
  return { lagS: m.mean * beat, r: circularMean(phases).r, n: read.length, seS: m.n >= 2 ? sd / Math.sqrt(m.n) : Infinity, kept: m.n, halves: [half(true), half(false)] };
}

/** Why the take did not measure this joint's lag well enough to keep it (null: kept). */
export function leadRefusal(l: LeadLag, clickInterval: number, options: LeadOffsetOptions = {}): LeadRefusal | null {
  const o: Required<LeadOffsetOptions> = { ...LEAD_OFFSET_DEFAULTS };
  for (const [k, v] of Object.entries(options)) if (v !== undefined) (o as Record<string, number>)[k] = v;
  if (l.n < o.minAnchors) return 'anchors';
  if (l.r < o.minR || !Number.isFinite(l.lagS)) return 'lock';
  if (Math.abs(l.lagS) > o.maxLagFraction * clickInterval) return 'level';
  // The spread is the kept anchors' (the trim's strays left out), so a joint the trim had
  // to cut a quarter of is as loose as its spread would say if they counted.
  if (!(l.seS <= o.maxStandardErrorS) || l.kept < 0.75 * l.n) return 'loose';
  const [a, b] = l.halves;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > o.maxHalfGapS) return 'drift';
  return null;
}

/** The offsets of the joints whose lag the take measured, by their side-free key; of two
 *  sides of one joint, the one with more anchors (the arm that beat). */
export function leadOffsetsFrom(lags: Readonly<Record<string, LeadLag>>, clickInterval: number, options: LeadOffsetOptions = {}): Record<string, number> {
  const out: Record<string, number> = {};
  const seen: Record<string, number> = {};
  for (const [channel, l] of Object.entries(lags)) {
    if (leadRefusal(l, clickInterval, options) !== null) continue;
    const key = leadJointKey(channel);
    if (seen[key] !== undefined && seen[key] >= l.n) continue;
    seen[key] = l.n;
    out[key] = l.lagS;
  }
  return out;
}

/**
 * Correct an anchor by its joint's offset: its time moved by `-offsets[key]`, the key the
 * anchor's channel without its side. An anchor with no channel, or a joint with no offset,
 * is returned unchanged (the same object). A joint that LEADS the beat moves its anchor
 * later, possibly past the frame that produced it: the caller delivers such an anchor when
 * its time comes (`createLeadCorrector`), never early.
 */
export function shiftAnchor(anchor: Anchor, offsets: LeadOffsets | undefined): Anchor {
  const off = anchor.channel !== undefined && offsets ? offsets[leadJointKey(anchor.channel)] : undefined;
  if (off === undefined || !Number.isFinite(off) || off === 0) return anchor;
  return { ...anchor, t: anchor.t - off };
}

/** Corrects a detector's anchors by their joints' offsets and delivers them in time order,
 *  at most one per frame, holding a corrected anchor that lies ahead of the frame until a
 *  frame reaches it (causal: a leading joint says the beat is coming; it is played when it
 *  comes). */
export interface LeadCorrector {
  /** The anchor to feed at frame time `t` (`anchor` is the detector's this frame, or
   *  null), corrected; null while nothing is due. A due anchor within `minGap` seconds of
   *  the last one delivered is dropped: two joints with different offsets can move two
   *  peaks of ONE stroke next to each other when the detector switches between them, and
   *  the detector's own refractory (a quarter period) is what tells a stroke. */
  push(anchor: Anchor | null, t: number, minGap?: number): Anchor | null;
  /** The offsets in use (a new object replaces them; a held anchor keeps its time). */
  setOffsets(offsets: LeadOffsets | undefined): void;
  /** Forget held anchors and the last one delivered (a new follower, a cut-off). */
  reset(): void;
}

export function createLeadCorrector(offsets?: LeadOffsets): LeadCorrector {
  let current = offsets;
  /** Corrected anchors not yet delivered, in time order. */
  let queue: Anchor[] = [];
  let lastT = -Infinity;
  return {
    push(anchor, t, minGap = 0) {
      if (anchor) {
        const a = shiftAnchor(anchor, current);
        let i = queue.length;
        while (i > 0 && queue[i - 1].t > a.t) i--;
        queue.splice(i, 0, a);
      }
      while (queue.length && queue[0].t <= t) {
        const due = queue.shift()!;
        if (due.t <= lastT || due.t - lastT < minGap) continue;
        lastT = due.t;
        return due;
      }
      return null;
    },
    setOffsets(next) {
      current = next;
    },
    reset() {
      queue = [];
      lastT = -Infinity;
    },
  };
}

export interface LeadCalibrationOptions extends Omit<ImpactDetectorOptions, 'joints' | 'combine'>, LeadOffsetOptions {
  /** The joints to calibrate. Default the body conductor's set ({@link BODY_IMPACT_JOINTS}). */
  joints?: ReadonlyArray<ImpactJoint | string>;
  /** The prior each joint's follower runs (the conductor's), and its options. Default the
   *  default prior. */
  prior?: RhythmPriorKind;
  priorOptions?: RhythmPriorOptions;
}

/** The calibration's result: every joint's lag (by channel) and why it was not kept, and
 *  the offsets kept (by side-free key). */
export interface LeadCalibrationResult {
  lags: Record<string, LeadLag>;
  refused: Record<string, LeadRefusal>;
  offsets: Record<string, number>;
  /** The median click interval the offsets were bounded by, seconds. */
  clickInterval: number;
}

/** A calibration take: frames in, then `result(clicks)`. */
export interface LeadCalibration {
  /** Feed one frame (in time order). */
  push(frame: ChannelFrame): void;
  /** Seed every joint's follower at the beat's period (the click interval), seconds;
   *  before the first frame (it starts the take over). */
  setPeriod(period: number): void;
  /** Each joint's anchors so far (channel to times). */
  anchors(): Record<string, number[]>;
  /** The lags and offsets against these click times (the times the player HEARD them, on
   *  the frames' clock). */
  result(clicks: readonly number[]): LeadCalibrationResult;
  reset(): void;
}

export function createLeadCalibration(options: LeadCalibrationOptions = {}): LeadCalibration {
  const { joints = BODY_IMPACT_JOINTS, minAnchors, minR, maxLagFraction, maxStandardErrorS, maxHalfGapS, prior = DEFAULT_RHYTHM_PRIOR, priorOptions = {}, ...detector } = options;
  const gates = { minAnchors, minR, maxLagFraction, maxStandardErrorS, maxHalfGapS };
  const names = joints.map((j) => (typeof j === 'string' ? j : j.channel));
  // Each joint is followed as the conductor would follow it alone: its detector's period
  // comes from a prior of its own (`createIctus`'s loop), seeded at the click's tempo. A
  // detector with its period pinned to the click finds other peaks than the live one (the
  // 4-pattern elbow: +11 ms against the follower's -7 ms), and the offset is for the live one.
  const make = (period: number) =>
    names.map((channel) => {
      const tempo = Number.isFinite(period) && period > 0 ? { initialTempo: 60 / period } : {};
      const d = createImpactDetector({ ...detector, joints: [channel], ...(Number.isFinite(period) && period > 0 ? { initialPeriod: period } : {}) });
      const p = createRhythmPrior(prior, { ...priorOptions, oscillator: { ...priorOptions.oscillator, ...tempo }, trend: { ...priorOptions.trend, ...tempo } });
      return { channel, detector: d, prior: p, anchors: [] as number[] };
    });
  let period = NaN;
  let per = make(period);
  return {
    push(frame) {
      for (const j of per) {
        const a = j.detector.push(frame);
        if (a) {
          j.anchors.push(a.t);
          j.prior.update(a);
          j.detector.setPeriod(j.prior.state().period);
        } else j.prior.advance(frame.t);
      }
    },
    setPeriod(p) {
      period = p;
      per = make(period);
    },
    anchors: () => Object.fromEntries(per.map((j) => [j.channel, [...j.anchors]])),
    result(clicks) {
      const sorted = [...clicks].sort((a, b) => a - b);
      const ibis = sorted.slice(1).map((x, i) => x - sorted[i]);
      const clickInterval = ibis.length ? median(ibis) : NaN;
      const lags = Object.fromEntries(per.map((j) => [j.channel, measureLeadLag(j.anchors, sorted)]));
      const refused: Record<string, LeadRefusal> = {};
      for (const [channel, l] of Object.entries(lags)) {
        const why = leadRefusal(l, clickInterval, gates);
        if (why) refused[channel] = why;
      }
      return { lags, refused, offsets: leadOffsetsFrom(lags, clickInterval, gates), clickInterval };
    },
    reset() {
      per = make(period);
    },
  };
}
