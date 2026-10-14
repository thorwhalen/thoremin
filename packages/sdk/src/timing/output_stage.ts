/**
 * The output stage — how long after a sound is scheduled on the audio clock it leaves
 * the device — as ONE number with a stated source (step 0 of the 2026-10-05 timing plan,
 * #240).
 *
 * Why one rule, in one place. Three consumers map engine time onto the audio clock (the
 * air drum's `drum-out`, the trainer's click, the coming scheduler), and each used to
 * read the output latency its own way. Two measured facts make that unsafe:
 *
 * - **WebKit's `getOutputTimestamp` pair stops at the I/O callback, before the device.**
 *   `scheduleToSpeaker` derived from it reads -1 to 2 ms against an `outputLatency` of
 *   16 ms (Chromium's two agree). A map trusting the pair sounds every scheduled hit
 *   `outputLatency` late on Safari: 16 ms on the built-in output, 150 ms or more on
 *   AirPods. So a pair that sits under the base latency (plus a margin) is PRE-LATENCY,
 *   and the stage is `outputLatency`; when both are known the stage is their max.
 * - **`outputLatency` is not always a number.** It reads 0 while a WebKit context is not
 *   running (every Safari context starts suspended, so until the first tap), it is absent
 *   before Safari 18.4, and under fingerprinting protection it is a fixed
 *   `512 / sampleRate`. Those are UNKNOWN, never 0: a consumer that reads 0 reports a hit
 *   on time while it lands late. When nothing is known the stage is a stated prior of
 *   about 20 ms (wired or built-in output), flagged `prior`, and the status line asks for
 *   the strike test (`src/latency/strike.ts`), whose per-device result is the `strike`
 *   source.
 *
 * Pure: the rule is a function of numbers; {@link readOutputStage} reads one context
 * once (unsmoothed), for a consumer with its own `AudioContext` (the click). The
 * always-on resource (`tracker.ts`) smooths the pair over ticks and applies the same
 * rule.
 */

import type { AudioView } from './audio';

export type OutputStageSource = 'measured' | 'pair' | 'prior' | 'strike';

export interface OutputStage {
  /** Seconds from a scheduled context time to the sound leaving the device. */
  value: number;
  /** `measured`: the OS-reported `outputLatency` (and the pair, when both are known);
   *  `pair`: the output timestamp pair alone; `strike`: a per-device strike calibration;
   *  `prior`: nothing is known and this is the stated platform prior. */
  source: OutputStageSource;
}

/** The stated prior when nothing is known: a wired or built-in output, seconds. */
export const OUTPUT_STAGE_PRIOR_S = 0.02;
/** WebKit under fingerprinting protection reports exactly this many frames as the
 *  output latency; such a reading is a policy, not a measurement. */
export const FINGERPRINTING_BLOCK_FRAMES = 512;
/** A pair-derived stage under `baseLatency` plus this (seconds) stops before the
 *  device: the pair is pre-latency (WebKit). */
export const PRE_LATENCY_MARGIN_S = 0.002;
/** The smallest output latency a real device reports (seconds); under it a reading is
 *  not the device's. A pair under it is pre-latency whatever the base latency says. */
export const MIN_REPORTED_OUTPUT_LATENCY_S = 0.005;

const finite = (x: number | undefined | null): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * The reported `outputLatency` as a known number (seconds), or NaN when the reading is
 * a placeholder: 0 (a WebKit context not yet running, Firefox before its first
 * callback), absent, or exactly `512 / sampleRate` (fingerprinting protection).
 */
export function knownOutputLatency(outputLatencyS: number | undefined | null, sampleRate: number | undefined | null): number {
  if (!finite(outputLatencyS) || outputLatencyS < MIN_REPORTED_OUTPUT_LATENCY_S) return NaN;
  if (finite(sampleRate) && sampleRate > 0 && Math.abs(outputLatencyS - FINGERPRINTING_BLOCK_FRAMES / sampleRate) < 1e-9) return NaN;
  return outputLatencyS;
}

/** Whether a pair-derived schedule-to-speaker reading stops before the device. */
export function pairIsPreLatency(pairS: number, baseLatencyS: number | undefined | null): boolean {
  const floor = Math.max(MIN_REPORTED_OUTPUT_LATENCY_S, finite(baseLatencyS) ? baseLatencyS + PRE_LATENCY_MARGIN_S : 0);
  return pairS < floor;
}

export interface OutputStageInputs {
  /** Schedule-to-speaker from the output timestamp pair, seconds (smoothed or one
   *  reading); NaN or absent when the pair is unavailable. */
  pairS?: number;
  /** The context's raw `outputLatency`, seconds. */
  outputLatencyS?: number | null;
  /** The context's `baseLatency`, seconds. */
  baseLatencyS?: number | null;
  sampleRate?: number | null;
  /** A per-device strike calibration, seconds; NaN or absent when none. */
  strikeS?: number;
  /** The prior when nothing is known (default {@link OUTPUT_STAGE_PRIOR_S}). */
  priorS?: number;
}

/** The rule. See the module header for why each branch exists. */
export function deriveOutputStage({ pairS, outputLatencyS, baseLatencyS, sampleRate, strikeS, priorS = OUTPUT_STAGE_PRIOR_S }: OutputStageInputs = {}): OutputStage {
  if (finite(strikeS) && strikeS > 0) return { value: strikeS, source: 'strike' };
  const latency = knownOutputLatency(outputLatencyS, sampleRate);
  const pairOk = finite(pairS) && !pairIsPreLatency(pairS, baseLatencyS);
  if (Number.isFinite(latency) && pairOk) return { value: Math.max(pairS!, latency), source: 'measured' };
  if (Number.isFinite(latency)) return { value: latency, source: 'measured' };
  if (pairOk) return { value: pairS!, source: 'pair' };
  return { value: priorS, source: 'prior' };
}

/** The slice of an `AudioContext` the rule reads. */
export type OutputStageAudioLike = AudioView<'currentTime' | 'baseLatency' | 'outputLatency' | 'getOutputTimestamp', 'state' | 'sampleRate'>;

/**
 * One reading of the pair as schedule-to-speaker, seconds: a context time written now
 * is heard at `performanceTime + (currentTime - contextTime)`, so this is that instant
 * minus now. NaN when the context is not running or the pair is absent or zero (before
 * the first render Chromium reports zeros).
 */
export function pairScheduleToSpeaker(ac: OutputStageAudioLike, nowMs: number): number {
  if ((ac.state !== undefined && ac.state !== 'running') || typeof ac.getOutputTimestamp !== 'function') return NaN;
  const ts = ac.getOutputTimestamp();
  if (!finite(ts.contextTime) || !finite(ts.performanceTime) || !(ts.performanceTime > 0)) return NaN;
  return ts.performanceTime / 1000 + (ac.currentTime - ts.contextTime) - nowMs / 1000;
}

/** The output stage of one context from a single reading (no smoothing): for a
 *  consumer with its own context. `nowMs` is `performance.now()`. */
export function readOutputStage(ac: OutputStageAudioLike, nowMs: number, options: Pick<OutputStageInputs, 'strikeS' | 'priorS'> = {}): OutputStage {
  return deriveOutputStage({
    pairS: pairScheduleToSpeaker(ac, nowMs),
    outputLatencyS: ac.state === undefined || ac.state === 'running' ? ac.outputLatency : NaN,
    baseLatencyS: ac.baseLatency,
    sampleRate: ac.sampleRate,
    ...options,
  });
}
