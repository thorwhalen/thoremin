/**
 * What the camera status line says about the timing resource (step 0 of the timing
 * plan): one short line a player can read, plus the warnings that need acting on.
 *
 * Pure, so the words are unit-tested without a DOM: the shell chip and the latency
 * probe's panel render the same text. The line names what the resource measured (the
 * delivered camera rate, how many frames carry a real capture stamp, the frame's age,
 * the output stage with its source); a warning fires only for what the player can act
 * on or must know: an interrupted audio route ("tap to resume"), an output stage this
 * browser cannot report (so a predicted hit may still sound late: run the strike test),
 * a camera delivering under {@link LOW_LIGHT_FPS} (the usual cause is dim light), an
 * audio output that ran dry in the last minute (with the low-latency hint in force, the line
 * names the box, since the smaller buffer is the likely cause; #240), and
 * stamps that are not capture stamps (a sub-frame estimate then claims a precision the
 * stamp cannot carry). That last hint is about a BROWSER's stamps: frames with no stamp
 * at all (a synthetic source) or whose stamp was not used (a replay) earn no hint, since
 * there is nothing the player or the browser could do about them. The line also carries
 * the runtime checks of #318 when they matter: a timer coarser than half a millisecond,
 * and a browser whose frames never carry the camera's `captureTime`.
 */
import { UNSTAMPED_SOURCE, type TimingReading } from '@thoremin/sdk/timing/tracker';

/** A delivered rate under this (fps) is the low-light hint: the camera has lengthened
 *  its exposure. Cameras grant 24 to 30 in good light. */
export const LOW_LIGHT_FPS = 24;
/** The stamp mix is judged only once this many frames have been seen. */
export const MIN_FRAMES_FOR_STAMP_HINT = 30;
/** A timer coarser than this (seconds) is named in the line: Firefox and Safari round
 *  `performance.now()` to 1 ms without cross-origin isolation (#318). */
export const COARSE_TIMER_S = 0.0005;

/** An output stage above this (seconds) is far beyond a wired or built-in output
 *  (Bluetooth adds 100 to 200 ms): worth a line of its own. */
export const HIGH_OUTPUT_STAGE_S = 0.1;

export interface TimingDescription {
  /** One short line; empty before any frame. */
  line: string;
  warnings: string[];
}

const ms = (s: number) => `${Math.round(s * 1000)} ms`;

const SOURCE_WORD: Record<string, string> = { measured: 'measured', pair: 'from the audio clock', prior: 'assumed', strike: 'from the strike test' };

/** What the host knows that the reading does not. */
export interface DescribeOptions {
  /** The low-latency hint is in force (the per-device box, `audioPrefs.lowLatency`, was
   *  ticked when the context was created, on a browser that honours it): a glitch then
   *  names it. */
  lowLatencyAudio?: boolean;
}

export function describeTiming(r: TimingReading, { lowLatencyAudio = false }: DescribeOptions = {}): TimingDescription {
  const warnings: string[] = [];
  const parts: string[] = [];
  const total = Object.values(r.stampSources).reduce((n, c) => n + c, 0);
  if (Number.isFinite(r.deliveredFps)) parts.push(`${r.deliveredFps.toFixed(0)} fps`);
  else if (Number.isFinite(r.framePeriod) && r.framePeriod > 0) parts.push(`${(1 / r.framePeriod).toFixed(0)} fps processed`);
  if (total > 0) {
    const capture = r.stampSources.capture ?? 0;
    parts.push(`capture stamps ${Math.round((100 * capture) / total)} %`);
  }
  if (Number.isFinite(r.frameAge.mean)) parts.push(`age ${ms(r.frameAge.mean)}`);
  if (r.skippedFrames > 0) parts.push(`${r.skippedFrames} skipped`);
  parts.push(`out ${ms(r.outputStage.value)} ${SOURCE_WORD[r.outputStage.source] ?? r.outputStage.source}`);
  // The runtime checks (#318): what bounds every stamp's precision. Named only when it
  // matters: a timer at 1 ms, and a browser that never hands over a capture time.
  const timer = r.runtime?.timerResolution;
  if (typeof timer === 'number' && Number.isFinite(timer) && timer >= COARSE_TIMER_S) parts.push(`timer ${ms(timer)}${r.runtime.crossOriginIsolated === false ? ' (not isolated)' : ''}`);
  if (r.captureTimeAvailable === false) parts.push('no captureTime');

  if (r.audio.state === 'interrupted') warnings.push('audio interrupted: tap to resume');
  if (r.audio.state === 'running' && r.outputStage.source === 'prior') warnings.push('audio output latency unknown on this browser: run the strike test (?probe=latency)');
  if (r.outputStage.source !== 'prior' && r.outputStage.value >= HIGH_OUTPUT_STAGE_S) warnings.push(`your audio output adds ${ms(r.outputStage.value)}`);
  const glitches = r.audio.glitches?.recent ?? 0;
  if (glitches > 0) {
    const times = glitches === 1 ? 'once' : `${glitches} times`;
    warnings.push(lowLatencyAudio ? `audio glitched ${times}: turn off low-latency audio` : `audio glitched ${times} in the last minute`);
  }
  if (Number.isFinite(r.deliveredFps) && r.deliveredFps < LOW_LIGHT_FPS) warnings.push(`camera delivers ${r.deliveredFps.toFixed(0)} fps (low light?)`);
  if (total >= MIN_FRAMES_FOR_STAMP_HINT && r.dominantSource !== null && r.dominantSource !== 'capture' && r.dominantSource !== UNSTAMPED_SOURCE) {
    warnings.push(`frames carry ${r.dominantSource} stamps, not capture times`);
  }
  return { line: r.frames > 0 ? parts.join(' · ') : '', warnings };
}
