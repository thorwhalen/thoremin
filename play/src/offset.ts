/**
 * The player's timing offset on a standalone page (the app keeps it as a device pref, `gamesPrefs`):
 * what Audio timing measured (the round trip plus the player's anticipation, seconds), kept in this
 * browser's storage (`./stored`) and subtracted by the timed games (Sing Along, Play Along Lessons).
 *
 * A player who measured it in the camera app before the listening games left it (#894) keeps it
 * (#895): with none of its own, a page adopts the camera app's measurement once (same origin, so
 * the camera app's stored controls are readable here) and keeps it as its own.
 */
import { stored } from './stored';

export interface StoredOffset {
  offset: number;
  spread: number;
  /** ISO date of the take. */
  at: string;
}

const OFFSET = stored<StoredOffset>('funfon.playerOffset', (v): v is StoredOffset => typeof v === 'object' && v !== null && Number.isFinite((v as StoredOffset).offset));

/** Where the camera app persists its controls (`CONTROLS_STORAGE_KEY` in `src/app/store`; a page
 *  never imports the app, so the key is written twice and a test holds them equal). */
export const CAMERA_APP_CONTROLS_KEY = 'thoremin-controls';

type CameraControls = { state?: { gamesPrefs?: Record<string, unknown> } };
const CAMERA_APP = stored<CameraControls>(CAMERA_APP_CONTROLS_KEY, (v): v is CameraControls => typeof v === 'object' && v !== null);
const finiteOr = (x: unknown, fallback: number | null) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

/** The camera app's measured offset (its `gamesPrefs`, from a take: `source` other than `none`). */
export function cameraAppOffset(): StoredOffset | null {
  const p = CAMERA_APP.read()?.state?.gamesPrefs;
  const offset = finiteOr(p?.offset, null);
  if (!p || !p.source || p.source === 'none' || offset === null) return null;
  return { offset, spread: finiteOr(p.spread, 0)!, at: typeof p.measuredAt === 'string' ? p.measuredAt : '' };
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
