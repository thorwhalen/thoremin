/**
 * The motion segmenter (#751, phase 1 of `docs/design/dynamic-gestures.md`): it cuts the
 * repetitions of a named gesture out of a take, as traces.
 *
 * ## The still-point sampler's complement
 *
 * The sampler (`../sampler.ts`) keeps the frames where the vector is held and throws the
 * transitions away, which is right for a smile and wrong for a wave: a wave is only
 * transition. This keeps what the sampler throws away. It reads the same motion signal in the
 * same noise units (`../motion.ts`), and its "quiet" is the sampler's "held", so a frame is
 * never both a pose and part of a gesture.
 *
 * ## The rule
 *
 * The vector is QUIET once the reading has stayed at or below `stopSigma` for `quietMs`, the
 * sampler's dwell inverted. A trace OPENS when the reading rises above `startSigma` (deliberate
 * motion) after a quiet, and CLOSES at the next quiet. One test both ways: a wave's reversal,
 * where the hand slows to turn for a frame or two, neither ends a trace nor counts as the rest
 * a new one starts from, so a take that starts in the middle of a wave, or resumes after a
 * break in the stream, yields no half wave. The two thresholds are a hysteresis band: a quiet
 * hand's drift between them opens nothing.
 *
 * A closed run is a trace when it moved for at least `minTraceMs` (shorter is a twitch or a
 * tracking glitch) and at most `maxTraceMs` (longer is sweeping about, not one repetition).
 * Its first frame is the reading's reference, one window before the motion was first seen, so
 * the start of the gesture is not lost to the window; its last is the last moving frame.
 *
 * A break in the stream INTERRUPTS: a frame the meter cannot judge (an attended feature with
 * no warm noise estimate: a hand that just came into view) or a gap (frames missing: the hand
 * left the shot) abandons an open run and disarms. A trace with a hole in it would be a
 * corrupt template for the matcher, and half a wave is not a repetition. The meter reports a
 * gap past two windows (200 ms, six frames at 30 fps); a shorter dropout is kept inside the
 * trace, as the sampler keeps it inside a dwell. A repeated stamp is
 * skipped: it is the same frame read twice, not a frame.
 *
 * ## The noise estimate is the caller's
 *
 * `noise` is required: the units must come from frames that are NOT the gesture, or the waves
 * inflate the very unit they are judged in. The session feeds its estimator only while no run
 * is open ({@link MotionSegmenter.inRun}), so a feature that first appears during a gesture
 * cue still warms up between repetitions.
 *
 * ## What it does not do
 *
 * It does not say WHICH gesture a trace is: the cue named it, and the player was asked to
 * repeat one thing. Matching a trace against others is the window matcher's job (#752).
 */
import { createWindowMotion, MOTION_DEFAULTS } from '../motion';
import type { NoiseEstimator } from '../noise';
import type { FeatureVector, Trace, TraceSample } from '../types';

export interface SegmenterOptions {
  /** The gesture's name, stamped on every trace. */
  gesture: string;
  /** The id of the cue capturing, stamped on every trace and prefixing its id. */
  cue: string;
  /** The estimator the noise units come from, fed by the caller with frames that are not
   *  the gesture (see the module header). */
  noise: NoiseEstimator;
  /** The features motion is judged on. Default: every key of the frame. */
  features?: readonly string[];
  /** A frame from just before the first push, so the first window has a reference. */
  seed?: { v: FeatureVector; t: number };
  /** Noise-sigma above which a trace opens. */
  startSigma?: number;
  /** Noise-sigma at or below which the vector is quiet. */
  stopSigma?: number;
  /** How long it must stay quiet before an open trace closes, in ms. */
  quietMs?: number;
  /** Shortest motion kept as a trace, in ms. */
  minTraceMs?: number;
  /** Longest motion kept as a trace, in ms. */
  maxTraceMs?: number;
}

/**
 * The thresholds, with where each comes from. The two durations are provisional: no real
 * gesture take exists yet, and the real-take set of #754 re-tunes them.
 */
export const SEGMENTER_DEFAULTS = {
  /** The lower edge of deliberate motion on the recorded face clip (a head turn reads 8-12). */
  startSigma: MOTION_DEFAULTS.deliberateSigma,
  /** What the sampler calls held is quiet here: the two are exact complements. */
  stopSigma: MOTION_DEFAULTS.stillSigma,
  /** The sampler's dwell, inverted; longer than the dip at a wave's reversal. */
  quietMs: MOTION_DEFAULTS.dwellMs,
  /** A motion of length D reads as moving for about D plus a window; a twitch or a tracking
   *  glitch stays under 300 ms of that. */
  minTraceMs: 400,
  /** Twice the design's typical 1.5 s repetition (`dynamic-gestures.md` section 5). */
  maxTraceMs: 3000,
} as const;

export interface MotionSegmenter {
  /** Feed one frame. Returns a trace on the frame it closes (`quietMs` after the motion). */
  push(vector: FeatureVector, tMs: number): Trace | null;
  /** Every trace cut so far. */
  traces(): Trace[];
  /** Drop the traces and any open run; disarm. */
  reset(): void;
  /** The last motion reading, in noise-sigma, for a meter. */
  lastSpeed(): number;
  /** True while a run is open: moving, or in its closing quiet. Its frames are the
   *  gesture's, and must not feed the noise estimate. */
  inRun(): boolean;
  /** True once the reading has risen above `startSigma` since the last reset. */
  hasMoved(): boolean;
}

interface Run {
  samples: TraceSample[];
  firstMove: number;
  lastMove: number;
  /** Past `maxTraceMs`: followed to its end, never kept. */
  tooLong: boolean;
}

/** Build a motion segmenter. No clock of its own: `tMs` comes from the caller. */
export function createMotionSegmenter(options: SegmenterOptions): MotionSegmenter {
  const o = { ...SEGMENTER_DEFAULTS, ...options };
  const meter = createWindowMotion({ features: o.features, noise: o.noise, seed: o.seed });
  const cut: Trace[] = [];
  let run: Run | null = null;
  /** When the reading last fell to `stopSigma` or below and stayed there; null while above. */
  let quietSince: number | null = null;
  /** A quiet has been seen since the start or the last interruption, so a rise is a beginning. */
  let armed = false;
  let moved = false;
  let lastT = -Infinity;

  const close = (r: Run): Trace | null => {
    run = null;
    armed = true;
    if (r.tooLong || r.lastMove - r.firstMove < o.minTraceMs) return null;
    const trace: Trace = { id: `${o.cue}#${cut.length + 1}`, gesture: o.gesture, cue: o.cue, samples: r.samples.filter((s) => s.t <= r.lastMove) };
    cut.push(trace);
    return trace;
  };

  return {
    push(vector, tMs) {
      if (tMs <= lastT) return null;
      lastT = tMs;
      const reading = meter.push(vector, tMs);
      if (reading === 'cold' || reading === 'gap') {
        run = null;
        armed = false;
        quietSince = null;
        return null;
      }
      if (reading === 'pending') return null;
      if (reading > o.startSigma) moved = true;
      if (reading <= o.stopSigma) quietSince ??= tMs;
      else quietSince = null;
      const quiet = quietSince !== null && tMs - quietSince >= o.quietMs;

      if (!run) {
        if (quiet) armed = true;
        else if (reading > o.startSigma && armed) {
          run = { samples: meter.span().map(({ v, t }) => ({ vector: v, t })), firstMove: tMs, lastMove: tMs, tooLong: false };
        }
        return null;
      }

      if (!run.tooLong) run.samples.push({ vector, t: tMs });
      if (quietSince === null) {
        run.lastMove = tMs;
        if (tMs - run.firstMove > o.maxTraceMs) {
          run.tooLong = true;
          run.samples = [];
        }
        return null;
      }
      return quiet ? close(run) : null;
    },
    traces: () => cut.slice(),
    reset() {
      cut.length = 0;
      run = null;
      quietSince = null;
      armed = false;
      moved = false;
      lastT = -Infinity;
      meter.reset();
    },
    lastSpeed: () => meter.last(),
    inRun: () => run !== null,
    hasMoved: () => moved,
  };
}
