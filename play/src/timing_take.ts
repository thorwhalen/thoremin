/**
 * What the Audio timing page keeps from a finished take, and the lines it says (#881). Two takes,
 * two homes: a tap-along measures the player (round trip plus anticipation), kept as the games'
 * timing offset in this browser (`./offset`); a loopback measures the device (the speaker heard by
 * the microphone, no player), kept as this device's input stage, the per-device record the camera
 * app shares (`@thoremin/sdk-ui/audio/inputStage`). A refused take keeps nothing and says why.
 *
 * DOM-free: the page passes the setters, so a test runs the page's decision with the real store.
 */
import type { CalibrationMode, CalibrationTakeResult } from '@thoremin/games/calibrate';
import type { InputStage } from '@thoremin/sdk/timing/input_stage';
import type { InputStageRecord } from '@thoremin/sdk-ui/audio/inputStage';
import type { StoredOffset } from './offset';

/** The mode select's labels, in the order shown (the first is the default). */
export const TAKE_MODE_LABELS: Record<CalibrationMode, string> = {
  tap: 'Tap along',
  loopback: 'Loopback (speaker on, no tapping)',
};

/** What to do, per mode. */
export const TAKE_MODE_HINTS: Record<CalibrationMode, string> = {
  tap: "Clicks play: tap the table or clap on every one, firmly. Your timing offset is kept in this browser and used by Sing Along and Play Along. Headphones make it cleaner.",
  loopback: "Clicks play and the microphone hears them: speaker on, no headphones, a quiet room, and no tapping. It measures this device's microphone delay (its input stage), kept for every listening page and the camera app on this device.",
};

/** The microphone for a timing take: no processing at all (echo cancellation would cancel the very clicks a loopback hears). */
export const RAW_MICROPHONE = { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as const;

export interface KeepTakeDeps {
  writeOffset(v: StoredOffset): boolean;
  setInputStage(stage: InputStage): void;
  now(): Date;
}

/** Keep an accepted take where its mode keeps it; returns why nothing was kept, or null when it was. */
export function keepTake(mode: CalibrationMode, result: CalibrationTakeResult, deps: KeepTakeDeps): string | null {
  if (result.refusal) return result.refusal;
  if (mode === 'tap') {
    deps.writeOffset({ offset: result.offset, spread: result.spread, at: deps.now().toISOString() });
    return null;
  }
  const stage = result.inputStage?.stage;
  if (!stage) return result.inputStage?.refusal ?? 'the take measured no input stage';
  deps.setInputStage(stage);
  return null;
}

const ms = (s: number) => Math.round(s * 1000);

/** One line: the input stage in force, where it came from and, when stored, when it was measured. */
export function inputStageLine(inForce: InputStage, record: InputStageRecord | null): string {
  const head = `Microphone delay in force: ${ms(inForce.seconds)} ms`;
  if (record && record.source === inForce.source && record.seconds === inForce.seconds) return `${head} (${record.source}, measured ${record.at.slice(0, 10)}).`;
  if (inForce.source === 'reported') return `${head} (as the browser reports it; a loopback take measures it).`;
  return `${head} (${inForce.source}: not measured; a loopback take measures it).`;
}
