/**
 * The `timing` resource — the always-on lead budget every instrument reads each tick
 * (step 0 of the 2026-10-05 timing plan; #226, #239, #240).
 *
 * Why it exists. Every number in the timing cluster is a function of one quantity: the
 * LEAD an instrument has between deciding a sound and the moment it must be heard, which
 * is what the stroke offers minus what the pipeline eats. Until now the pipeline's share
 * existed only under `?probe=latency`, and the air drum's `minLead` was a constant that
 * ignored the output latency. This tracker keeps the running estimates the instruments
 * need, with ONE owner (the host installs it as `ctx.resources.timing`, a reader called
 * per tick) and no other writer:
 *
 * - the frame's AGE at the tick (how old the sample an instrument decides on is: the
 *   camera pipeline, inference and the tick), as an exponentially weighted mean and the
 *   p95 over the recent window;
 * - the OUTPUT STAGE, `output_stage.ts`'s rule over the pair-derived schedule-to-speaker
 *   (smoothed: Chrome's single readings bounce) and the context's `outputLatency`,
 *   with its source, never 0;
 * - the `audioEpoch`: bumped on an audio `statechange`, a `devicechange` or a sample-rate
 *   mismatch (an AirPods connect turns 16 ms into 150), which resets the pair smoothing
 *   so a stale number is never carried across a route change;
 * - the CAPTURE LAG a clock-stamped frame's age leaves out (#318): learned from the
 *   capture-stamped frames' own `lag` (capture to delivery), else a stated prior, flagged;
 *   an `estimated` stamp already subtracts the pump's learned lag, a `clock` stamp does not;
 * - the STAMP NOISE of clock-derived stamps (`clock`, `estimated`, after the pump's gated
 *   de-jitter): the spread of their intervals around the camera's lattice. Above a few ms
 *   a sub-frame estimate is worse than the frame-snapped one (`subframe-impact-prediction.md`
 *   §3.4), which is what the air drum's fallback reads (#318);
 * - two RUNTIME CHECKS (#318): whether the browser hands the pump the camera's
 *   `captureTime` at all, and the page's timer (`crossOriginIsolated`, and the resolution of
 *   `performance.now()` measured, since that is what bounds any stamp's precision);
 * - the output's GLITCHES (`glitches.ts`), the guard on the low-latency hint (#240);
 * - the processed frame period (inference-paced, not the camera's), the DELIVERED camera
 *   rate measured from the capture stamps (`getSettings().frameRate` reports the request,
 *   not the result; a rate under 24 fps is the low-light hint), the `tSource` mix (how
 *   many frames carry a real capture stamp: on a browser whose pump yields only `clock`
 *   stamps a sub-frame estimate claims a precision the stamp cannot carry), and the
 *   frames the camera presented that were not processed (`FrameTiming.skipped`).
 *
 * The LEAD BUDGET is `age p95 + outputStage`. One rule prevents double counting: the
 * predictor's `setMinLead(minLead + age)` is the only place the frame's age enters; a
 * scheduler's horizon adds the output stage and the tick's p95, never the age again.
 *
 * A `Tap` over the live engine, like the latency probe (`src/latency/probe.ts`), which
 * DISPLAYS these numbers and does not own them. Pure apart from the injected clock and
 * audio reader; replayable over fixtures in Node.
 */
import type { NodeContext, Tap } from '@thoremin/dag';
import { frameTime, type FrameTiming } from '../nodes/domain';
import { GlitchCounter, type GlitchReading } from './glitches';
import { deriveOutputStage, knownOutputLatency, pairScheduleToSpeaker, OUTPUT_STAGE_PRIOR_S, type OutputStage, type OutputStageAudioLike } from './output_stage';

/** The granted camera settings the host reports (`track.getSettings()`, ids removed). */
export interface CameraSettings {
  /** The REQUESTED rate the track reports; the delivered one is measured. */
  frameRate: number | null;
  width: number | null;
  height: number | null;
}

export interface TimingReading {
  outputStage: OutputStage;
  /** Bumps on every audio route, state or sample-rate change. */
  audioEpoch: number;
  /** The frame's age at the tick, seconds: the exponentially weighted mean and the p95
   *  over the recent window. NaN before a stamped frame. */
  frameAge: { mean: number; p95: number };
  /** The processed frame period, seconds (exponentially weighted); NaN before two frames. */
  framePeriod: number;
  /** Camera frames per second as delivered, from the capture stamps over the window; NaN
   *  until enough capture-stamped frames. */
  deliveredFps: number;
  /** How many of the recent frames were stamped from each source (`capture` is the one
   *  to trust), counted only where the stamp was HONOURED (real time at speed 1, this
   *  document's origin); {@link UNSTAMPED_SOURCE} for a frame without a stamp (a
   *  synthetic source) or whose stamp was not used (a replayed recording). */
  stampSources: Record<string, number>;
  /** The most common stamp source over the window, or null before a frame. */
  dominantSource: string | null;
  /** Camera frames presented but not processed, in total. */
  skippedFrames: number;
  /** Frames processed, in total. */
  frames: number;
  /** The smoothed pair-derived schedule-to-speaker, seconds; NaN until read. */
  scheduleToSpeaker: number;
  audio: {
    state: string | null;
    sampleRate: number | null;
    baseLatency: number | null;
    /** The raw reported value, seconds; `outputLatencyKnown` says whether it is one. */
    outputLatency: number | null;
    outputLatencyKnown: boolean;
    /** The output's dropouts while the instrument played (`glitches.ts`): the guard on
     *  the low-latency hint. */
    glitches: GlitchReading;
  };
  camera: CameraSettings | null;
  /** The capture-to-delivery lag a `clock` stamp leaves out of the frame's age, seconds:
   *  `measured` from capture-stamped frames, else the stated {@link CAPTURE_LAG_PRIOR_S}. */
  captureLag: { value: number; source: 'measured' | 'prior' };
  /** The noise of the clock-derived stamps (`clock`, `estimated`) over the window,
   *  seconds, measured against the CAMERA's frame period ({@link stampNoise}); NaN until
   *  {@link MIN_FRAMES_FOR_NOISE} such frames. Capture stamps are truthful and are not
   *  judged. */
  stampNoise: number;
  /** Whether this browser hands the pump the camera's `captureTime`: true once a capture
   *  stamp is seen, false after {@link CAPTURE_TIME_VERDICT_FRAMES} honoured frames with
   *  none, null before. (Not the FIRST frame's: the pump's first frame usually comes
   *  through the animation-frame path, before the first video-frame callback.) */
  captureTimeAvailable: boolean | null;
  /** The page's timer, from the host: `crossOriginIsolated` (null when unknown) and the
   *  measured resolution of `performance.now()`, seconds (NaN when not measured). */
  runtime: RuntimeChecks;
  /** `frameAge.p95 + outputStage.value`, seconds (the output stage's prior when unknown;
   *  the age alone before a stamped frame counts as 0). */
  leadBudget: number;
}

/** What the host measures about the page once (#318). */
export interface RuntimeChecks {
  crossOriginIsolated: boolean | null;
  timerResolution: number;
}

/** The capture-to-delivery lag assumed for a `clock` stamp when no capture stamp ever
 *  taught one, seconds: about one frame at 30 fps (exposure midpoint, readout and the
 *  transfer), a stated prior like the output stage's, never 0. */
export const CAPTURE_LAG_PRIOR_S = 0.03;
/** Gain of the exponentially weighted capture lag. */
export const CAPTURE_LAG_EW_GAIN = 0.1;
/** The stamp noise is judged once this many clock-derived frames are in the window. */
export const MIN_FRAMES_FOR_NOISE = 20;
/** `captureTimeAvailable` says no only after this many honoured frames without one. */
export const CAPTURE_TIME_VERDICT_FRAMES = 30;
/** The share of the largest residuals {@link stampNoise} leaves out (a stalled frame). */
export const STAMP_NOISE_TRIM = 0.05;

/**
 * The noise of a run of stamps against a camera of frame period `period` (seconds):
 * each interval's residual from the nearest whole number of periods (a skipped frame is
 * a multiple, not noise), as a trimmed RMS over the square root of two (an interval is
 * the difference of two noisy stamps).
 *
 * The period must be the CAMERA's (`getSettings().frameRate`, which the host reports),
 * never one read off the stamps themselves: clock stamps quantised to a 60 Hz display
 * from a 24 fps camera alternate 33 / 50 ms, and a lattice taken from those intervals
 * calls half of them perfect; stamps paced by a slow inference every 50 ms off a 30 fps
 * camera are perfectly regular, and the frames behind them are up to a period old. Against
 * the camera's period both read as the noise they are. Without a period (no camera
 * settings) the smallest common interval (the 20th percentile) stands in. An RMS rather
 * than a median, because residuals that split into two clusters make a median jump between
 * them window to window. Folding at half a period caps the reading near 0.2 periods.
 */
export function stampNoise(times: readonly number[], period: number = NaN): number {
  const d: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
  if (d.length < 3) return NaN;
  let p = period;
  if (!(p > 0)) {
    const sorted = [...d].sort((a, b) => a - b);
    p = sorted[Math.floor(0.2 * (sorted.length - 1))];
  }
  if (!(p > 0)) return NaN;
  const sq = d.map((x) => (x - Math.max(1, Math.round(x / p)) * p) ** 2).sort((a, b) => a - b);
  const kept = sq.slice(0, Math.max(1, Math.ceil(sq.length * (1 - STAMP_NOISE_TRIM))));
  return Math.sqrt(kept.reduce((a, b) => a + b, 0) / kept.length) / Math.SQRT2;
}

/** Frames the window statistics (age p95, stamp mix, delivered rate) are taken over. */
export const TIMING_WINDOW_FRAMES = 90;
/** The stamp-mix label of a frame with no stamp, or whose stamp was not used. */
export const UNSTAMPED_SOURCE = 'none';
/** Gain of the exponentially weighted frame age and period. */
export const AGE_EW_GAIN = 0.1;
/** Gain of the exponentially weighted pair reading. */
export const PAIR_EW_GAIN = 0.1;
/** The delivered rate needs at least this many capture-stamped frames in the window. */
export const MIN_FRAMES_FOR_RATE = 8;

export interface TimingTrackerOptions {
  /** The tap key of the hands source output (`<node id>.<port>`). */
  sourceKey?: string;
  /** The clock, ms, same base as the engine's realtime clock (`performance.now()`). */
  now?: () => number;
  /** Reads the live audio context, if any. */
  audio?: () => OutputStageAudioLike | undefined;
  /** The prior when nothing is known about the output stage. */
  priorS?: number;
  /** The page's timer checks, from the host. */
  runtime?: RuntimeChecks;
  /** The capture lag assumed for a `clock` stamp before one is measured. */
  captureLagPriorS?: number;
  windowFrames?: number;
}

interface FrameRecord {
  /** The frame's sample time, seconds (the stamp in real time; the tick otherwise). */
  t: number;
  age: number;
  source: string;
  stamped: boolean;
}

const CLOCK_DERIVED = new Set(['clock', 'estimated']);

/** The running estimates; see the module header. */
export class TimingTracker implements Tap {
  private readonly sourceKey: string;
  private readonly now: () => number;
  private readonly audio: () => OutputStageAudioLike | undefined;
  private readonly priorS: number;
  private readonly windowFrames: number;
  private readonly recent: FrameRecord[] = [];
  private epoch = 0;
  private pairEw = NaN;
  private ageEw = NaN;
  private periodEw = NaN;
  /** The previous frame's capture stamp (dedupe) and its sample time (the period). */
  private lastStamp = NaN;
  private lastT = NaN;
  private lastFrameRef: unknown = undefined;
  private frames = 0;
  private skipped = 0;
  private tick = -1;
  private boundSampleRate = NaN;
  private camera: CameraSettings | null = null;
  private strikeS = NaN;
  private cached: TimingReading | null = null;
  private readonly glitches = new GlitchCounter();
  private readonly runtime: RuntimeChecks;
  private readonly captureLagPriorS: number;
  private captureLagEw = NaN;
  private captureTimeSeen = false;
  private honouredFrames = 0;
  private glitchKey = '';

  constructor(options: TimingTrackerOptions = {}) {
    this.sourceKey = options.sourceKey ?? 'cam.hands';
    this.now = options.now ?? (() => performance.now());
    this.audio = options.audio ?? (() => undefined);
    this.priorS = options.priorS ?? OUTPUT_STAGE_PRIOR_S;
    this.windowFrames = options.windowFrames ?? TIMING_WINDOW_FRAMES;
    this.runtime = options.runtime ?? { crossOriginIsolated: null, timerResolution: NaN };
    this.captureLagPriorS = options.captureLagPriorS ?? CAPTURE_LAG_PRIOR_S;
  }

  onValue(key: string, value: unknown, ctx: NodeContext): void {
    if (ctx.tick !== this.tick) {
      this.tick = ctx.tick;
      this.sampleAudio();
    }
    if (key === this.sourceKey) this.onFrame(value as FrameTiming | undefined, ctx);
  }

  /** The audio route, state or rate changed: forget the smoothed pair, so the output
   *  stage returns to whatever is known now (possibly nothing). */
  bumpEpoch(): void {
    this.epoch++;
    this.pairEw = NaN;
    this.glitches.reset();
    this.cached = null;
  }

  /** The granted camera settings, from the host. */
  setCamera(camera: CameraSettings | null): void {
    this.camera = camera;
    this.cached = null;
  }

  /** A per-device strike calibration of the output stage, seconds (NaN to clear). */
  setStrike(outputStageS: number): void {
    this.strikeS = outputStageS;
    this.cached = null;
  }

  /** The current estimates. Cheap to call every tick: recomputed only after a change. */
  reading(): TimingReading {
    return (this.cached ??= this.compute());
  }

  private sampleAudio(): void {
    const ac = this.audio();
    if (!ac) return;
    if (typeof ac.sampleRate === 'number') {
      if (Number.isFinite(this.boundSampleRate) && ac.sampleRate !== this.boundSampleRate) this.bumpEpoch();
      this.boundSampleRate = ac.sampleRate;
    }
    const now = this.now();
    this.glitches.observe(ac, now);
    // A new glitch, or one ageing out of the last minute, changes the reading.
    const g = this.glitches.reading();
    const glitchKey = `${g.total}/${g.recent}`;
    if (glitchKey !== this.glitchKey) {
      this.glitchKey = glitchKey;
      this.cached = null;
    }
    const pair = pairScheduleToSpeaker(ac, now);
    if (!Number.isFinite(pair)) return;
    this.pairEw = Number.isFinite(this.pairEw) ? this.pairEw + PAIR_EW_GAIN * (pair - this.pairEw) : pair;
    this.cached = null;
  }

  private onFrame(frame: FrameTiming | undefined, ctx: NodeContext): void {
    if (!frame || frame === this.lastFrameRef) return;
    // The same capture stamp on two ticks (a 30 fps camera under a 60 Hz tick) is one
    // frame; a frame with no stamp is new whenever the object is.
    if (typeof frame.t === 'number' && frame.t === this.lastStamp) return;
    this.lastFrameRef = frame;
    this.lastStamp = typeof frame.t === 'number' ? frame.t : NaN;
    const t = frameTime(frame, ctx);
    // The stamp was honoured (real time at speed 1, this document's origin): only then is
    // the frame's age a measurement rather than 0 by construction.
    const stamped = typeof frame.t === 'number' && frame.tSource !== undefined && t === frame.t;
    const age = Math.max(0, ctx.time - t);
    if (Number.isFinite(this.lastT)) {
      const period = t - this.lastT;
      if (period > 0) this.periodEw = Number.isFinite(this.periodEw) ? this.periodEw + AGE_EW_GAIN * (period - this.periodEw) : period;
    }
    this.lastT = t;
    if (stamped) this.ageEw = Number.isFinite(this.ageEw) ? this.ageEw + AGE_EW_GAIN * (age - this.ageEw) : age;
    if (stamped) {
      this.honouredFrames++;
      if (frame.tSource === 'capture') this.captureTimeSeen = true;
    }
    if (stamped && frame.tSource === 'capture' && typeof frame.lag === 'number' && Number.isFinite(frame.lag) && frame.lag >= 0) {
      this.captureLagEw = Number.isFinite(this.captureLagEw) ? this.captureLagEw + CAPTURE_LAG_EW_GAIN * (frame.lag - this.captureLagEw) : frame.lag;
    }
    this.frames++;
    if (typeof frame.skipped === 'number' && frame.skipped > 0) this.skipped += frame.skipped;
    // A stamp that was not honoured says nothing about the pipeline: it is counted as no
    // stamp at all, so a replayed recording never reads as a camera delivering capture
    // times, and a synthetic source never reads as a browser without them.
    this.recent.push({ t, age, source: stamped ? (frame.tSource ?? UNSTAMPED_SOURCE) : UNSTAMPED_SOURCE, stamped });
    if (this.recent.length > this.windowFrames) this.recent.shift();
    this.cached = null;
  }

  private compute(): TimingReading {
    const ac = this.audio();
    const sampleRate = ac?.sampleRate ?? null;
    const rawLatency = ac && (ac.state === undefined || ac.state === 'running') ? ac.outputLatency : undefined;
    const latencyKnown = Number.isFinite(knownOutputLatency(rawLatency, sampleRate));
    const outputStage = deriveOutputStage({
      pairS: this.pairEw,
      outputLatencyS: rawLatency,
      baseLatencyS: ac?.baseLatency,
      sampleRate,
      strikeS: this.strikeS,
      priorS: this.priorS,
    });
    const stampSources: Record<string, number> = {};
    for (const r of this.recent) stampSources[r.source] = (stampSources[r.source] ?? 0) + 1;
    let dominantSource: string | null = null;
    for (const [source, n] of Object.entries(stampSources)) if (dominantSource === null || n > stampSources[dominantSource]) dominantSource = source;
    const ages = this.recent.filter((r) => r.stamped).map((r) => r.age).sort((a, b) => a - b);
    const p95 = ages.length ? ages[Math.min(ages.length - 1, Math.floor(0.95 * (ages.length - 1) + 0.5))] : NaN;
    const captured = this.recent.filter((r) => r.source === 'capture');
    const span = captured.length >= MIN_FRAMES_FOR_RATE ? captured[captured.length - 1].t - captured[0].t : 0;
    const deliveredFps = span > 0 ? (captured.length - 1) / span : NaN;
    const derived = this.recent.filter((r) => CLOCK_DERIVED.has(r.source));
    const cameraPeriod = this.camera?.frameRate && this.camera.frameRate > 0 ? 1 / this.camera.frameRate : NaN;
    const noise = derived.length >= MIN_FRAMES_FOR_NOISE ? stampNoise(derived.map((r) => r.t), cameraPeriod) : NaN;
    return {
      outputStage,
      audioEpoch: this.epoch,
      frameAge: { mean: this.ageEw, p95 },
      framePeriod: this.periodEw,
      deliveredFps,
      stampSources,
      dominantSource,
      skippedFrames: this.skipped,
      frames: this.frames,
      scheduleToSpeaker: this.pairEw,
      audio: {
        state: ac?.state ?? null,
        sampleRate,
        baseLatency: typeof ac?.baseLatency === 'number' ? ac.baseLatency : null,
        outputLatency: typeof rawLatency === 'number' ? rawLatency : null,
        outputLatencyKnown: latencyKnown,
        glitches: this.glitches.reading(),
      },
      camera: this.camera,
      captureLag: Number.isFinite(this.captureLagEw) ? { value: this.captureLagEw, source: 'measured' } : { value: this.captureLagPriorS, source: 'prior' },
      stampNoise: noise,
      captureTimeAvailable: this.captureTimeSeen ? true : this.honouredFrames >= CAPTURE_TIME_VERDICT_FRAMES ? false : null,
      runtime: this.runtime,
      leadBudget: (Number.isFinite(p95) ? p95 : 0) + outputStage.value,
    };
  }
}

/** The resource key the host installs the reader under. */
export const TIMING_RESOURCE_KEY = 'timing';

/** The slice of the reading a node reads through `ctx.resources`. */
export type TimingView = Pick<TimingReading, 'outputStage' | 'audioEpoch' | 'leadBudget' | 'captureLag' | 'stampNoise' | 'dominantSource'>;

/** What a node gets when no host installed the resource: the stated prior, flagged. */
export const ABSENT_TIMING: TimingView = Object.freeze({
  outputStage: Object.freeze({ value: OUTPUT_STAGE_PRIOR_S, source: 'prior' as const }),
  audioEpoch: 0,
  leadBudget: OUTPUT_STAGE_PRIOR_S,
  captureLag: Object.freeze({ value: CAPTURE_LAG_PRIOR_S, source: 'prior' as const }),
  stampNoise: NaN,
  dominantSource: null,
});

/**
 * The timing reading a node sees through `ctx.resources`: the installed reader's, or
 * {@link ABSENT_TIMING} (a headless replay, a test, a host without the resource), so a
 * consumer always has an output stage and it is never 0.
 */
export function timingFrom(resources: Record<string, unknown>): TimingView {
  const r = resources[TIMING_RESOURCE_KEY];
  const reading = typeof r === 'function' ? (r as () => unknown)() : r;
  if (reading && typeof reading === 'object' && 'outputStage' in reading) return reading as TimingReading;
  return ABSENT_TIMING;
}
