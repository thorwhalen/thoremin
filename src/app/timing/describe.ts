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
 * a camera delivering under {@link LOW_LIGHT_FPS} (the usual cause is dim light), and
 * stamps that are not capture stamps (a sub-frame estimate then claims a precision the
 * stamp cannot carry).
 */
import type { TimingReading } from '@thoremin/sdk/timing/tracker';

/** A delivered rate under this (fps) is the low-light hint: the camera has lengthened
 *  its exposure. Cameras grant 24 to 30 in good light. */
export const LOW_LIGHT_FPS = 24;
/** The stamp mix is judged only once this many frames have been seen. */
export const MIN_FRAMES_FOR_STAMP_HINT = 30;
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

export function describeTiming(r: TimingReading): TimingDescription {
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

  if (r.audio.state === 'interrupted') warnings.push('audio interrupted: tap to resume');
  if (r.audio.state === 'running' && r.outputStage.source === 'prior') warnings.push('audio output latency unknown on this browser: run the strike test (?probe=latency)');
  if (r.outputStage.source !== 'prior' && r.outputStage.value >= HIGH_OUTPUT_STAGE_S) warnings.push(`your audio output adds ${ms(r.outputStage.value)}`);
  if (Number.isFinite(r.deliveredFps) && r.deliveredFps < LOW_LIGHT_FPS) warnings.push(`camera delivers ${r.deliveredFps.toFixed(0)} fps (low light?)`);
  if (total >= MIN_FRAMES_FOR_STAMP_HINT && r.dominantSource !== null && r.dominantSource !== 'capture') warnings.push(`frames carry ${r.dominantSource} stamps, not capture times`);
  return { line: r.frames > 0 ? parts.join(' · ') : '', warnings };
}
