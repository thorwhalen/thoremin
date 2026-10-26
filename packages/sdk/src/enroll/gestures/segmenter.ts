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
 * A trace OPENS when the reading rises above `startSigma` (deliberate motion), and only after
 * the vector has been quiet (at or below `stopSigma`) since the segmenter began or was last
 * interrupted: a take that starts in the middle of a wave yields no half wave. It CLOSES once
 * the reading has stayed at or below `stopSigma` for `quietMs`, the sampler's dwell inverted.
 * The two thresholds are a hysteresis band: a wave's reversals, where the hand slows to turn,
 * dip under `startSigma` without ending the trace, and a quiet hand's drift between the two
 * opens nothing.
 *
 * A closed run is a trace when it moved for at least `minTraceMs` (shorter is a twitch or a
 * tracking glitch) and at most `maxTraceMs` (longer is sweeping about, not one repetition).
 * Its first frame is the reading's reference, one window before the motion was first seen, so
 * the start of the gesture is not lost to the window; its last is the last moving frame.
 *
 * A frame the meter cannot judge (an attended feature with no warm noise estimate: a hand that
 * just came into view) abandons an open trace and disarms, as it stops a sampler's dwell.
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
  /** The cue id stamped on every trace. Default: the gesture's name. */
  cue?: string;
  /** The features motion is judged on. Default: every key of the frame. */
  features?: readonly string[];
  /** The estimator the noise units come from (pass the session's); omitted, a private one. */
  noise?: NoiseEstimator;
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
  /** True while a run is open and still moving (not yet in its closing quiet). */
  isMoving(): boolean;
  /** True once the reading has risen above `startSigma` since the last reset. */
  hasMoved(): boolean;
}

interface Run {
  samples: TraceSample[];
  firstMove: number;
  lastMove: number;
  /** When the current quiet began, or null while moving. */
  quietSince: number | null;
  /** Past `maxTraceMs`: followed to its end, never kept. */
  tooLong: boolean;
}

/** Build a motion segmenter. No clock of its own: `tMs` comes from the caller. */
export function createMotionSegmenter(options: SegmenterOptions): MotionSegmenter {
  const o = { ...SEGMENTER_DEFAULTS, ...options };
  const cue = options.cue ?? options.gesture;
  const meter = createWindowMotion({ features: o.features, noise: o.noise, seed: o.seed });
  const cut: Trace[] = [];
  let run: Run | null = null;
  /** Quiet has been seen since the start or the last interruption, so a rise is a beginning. */
  let armed = false;
  let moved = false;

  const close = (r: Run): Trace | null => {
    run = null;
    if (r.tooLong || r.lastMove - r.firstMove < o.minTraceMs) return null;
    const trace: Trace = { gesture: o.gesture, cue, samples: r.samples.filter((s) => s.t <= r.lastMove) };
    cut.push(trace);
    return trace;
  };

  return {
    push(vector, tMs) {
      const reading = meter.push(vector, tMs);
      if (reading === 'cold') {
        run = null;
        armed = false;
        return null;
      }
      if (reading === 'pending') return null;
      if (reading > o.startSigma) moved = true;

      if (!run) {
        if (reading <= o.stopSigma) armed = true;
        else if (reading > o.startSigma && armed) {
          run = {
            samples: meter.span().map(({ v, t }) => ({ vector: v, t })),
            firstMove: tMs,
            lastMove: tMs,
            quietSince: null,
            tooLong: false,
          };
        }
        return null;
      }

      if (!run.tooLong) run.samples.push({ vector, t: tMs });
      if (reading > o.stopSigma) {
        run.lastMove = tMs;
        run.quietSince = null;
        if (tMs - run.firstMove > o.maxTraceMs) {
          run.tooLong = true;
          run.samples = [];
        }
        return null;
      }
      run.quietSince ??= tMs;
      return tMs - run.quietSince >= o.quietMs ? close(run) : null;
    },
    traces: () => cut.slice(),
    reset() {
      cut.length = 0;
      run = null;
      armed = false;
      moved = false;
      meter.reset();
    },
    lastSpeed: () => meter.last(),
    isMoving: () => run !== null && run.quietSince === null,
    hasMoved: () => moved,
  };
}
