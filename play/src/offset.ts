/**
 * The player's timing offset on a standalone page (the app keeps it as a device pref, `gamesPrefs`):
 * what Audio timing measured (the round trip plus the player's anticipation, seconds), kept in this
 * browser's storage (`./stored`) and subtracted by the timed games (Sing Along, Play Along Lessons).
 *
 * A player who measured it in the camera app before the listening games left it (#894) keeps it
 * (#895): with none of its own, a page adopts the camera app's measurement once (same origin, so
 * the camera app's stored controls are readable here) and keeps it as its own.
 *
 * An offset is measured on heard times already moved back by the device's input stage IN FORCE
 * during the take (the runner subtracts it), so it is only true under that stage. It is kept with
 * that stage ({@link StoredOffset.stage}), and a game subtracts {@link offsetFor}: the offset moved
 * by however much the stage changed since (a loopback take that measures the device, #881, must
 * not shift every judged onset). An offset kept before it carried a stage counts as measured under
 * the prior, the stage a page converted with before any was stored.
 */
import { INPUT_STAGE_PRIOR_S } from '@thoremin/sdk/timing/input_stage';
import { stored } from './stored';

export interface StoredOffset {
  offset: number;
  spread: number;
  /** ISO date of the take. */
  at: string;
  /** The input stage in force during the take, seconds (absent: measured under the prior). */
  stage?: number;
}

const finiteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const OFFSET = stored<StoredOffset>(
  'funfon.playerOffset',
  (v): v is StoredOffset => typeof v === 'object' && v !== null && finiteNumber((v as StoredOffset).offset) && ((v as StoredOffset).stage === undefined || finiteNumber((v as StoredOffset).stage)),
);

/** The offset a game subtracts under the input stage in force now (0 with none measured). */
export function offsetFor(v: StoredOffset | null, stageNowS: number): number {
  return v ? v.offset + (v.stage ?? INPUT_STAGE_PRIOR_S) - stageNowS : 0;
}

/** Where the camera app persists its controls (`CONTROLS_STORAGE_KEY` in `src/app/store`; a page
 *  never imports the app, so the key is written twice and a test holds them equal). */
export const CAMERA_APP_CONTROLS_KEY = 'thoremin-controls';

type CameraControls = { state?: { gamesPrefs?: Record<string, unknown> } };
const CAMERA_APP = stored<CameraControls>(CAMERA_APP_CONTROLS_KEY, (v): v is CameraControls => typeof v === 'object' && v !== null);
/** The sources of a measured offset, and its bound: the camera app's `gamesPrefs` schema (a page
 *  never imports the slice, and a slice this build does not list is carried, never healed). Only a
 *  TAP offset is adopted: the camera app's `loopback` offset is the device's round trip, which a
 *  page now measures as its input stage (#881), so adopting it too would subtract the device twice. */
const MEASURED_SOURCES: readonly unknown[] = ['tap'];
const MAX_OFFSET_S = 0.5;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The camera app's measured offset (its `gamesPrefs`, from a take), or null. */
export function cameraAppOffset(): StoredOffset | null {
  const p = CAMERA_APP.read()?.state?.gamesPrefs;
  if (!p || !MEASURED_SOURCES.includes(p.source) || !finite(p.offset) || Math.abs(p.offset) > MAX_OFFSET_S) return null;
  return { offset: p.offset, spread: finite(p.spread) ? p.spread : 0, at: typeof p.measuredAt === 'string' ? p.measuredAt : '' };
}

/** This page's offset; with none yet, the camera app's, adopted once (written as this page's). */
export function readOffset(): StoredOffset | null {
  const own = OFFSET.read();
  if (own) return own;
  const adopted = cameraAppOffset();
  if (adopted) OFFSET.write(adopted);
  return adopted;
}
export const writeOffset = (v: StoredOffset): boolean => OFFSET.write(v);

/** One line for a page: the offset in use, or that there is none yet. */
export function offsetLine(v: StoredOffset | null): string {
  return v ? `Your timing: ${Math.round(v.offset * 1000)} ms (measured ${v.at.slice(0, 10)}).` : 'No timing measured yet: Audio timing measures it in half a minute.';
}
