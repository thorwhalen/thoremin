/**
 * What the latency scripts share (#850): the fake camera's launch flags, and where a local camera
 * clip lives. One place, so a change reaches every script. The served app is `../../lib/preview.mjs`,
 * shared with the guide's pictures (#732).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
/** The camera clip kept under the app-data dir (never in the repo); see `measure.mjs` for making one. */
export const DEFAULT_CLIP = join(homedir(), '.local/share/thoremin/latency/hands_720p30.y4m');

/** Chromium flags for a fake camera: playing `clip` when given, its own test pattern otherwise. */
export function fakeCameraFlags(clip) {
  const flags = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (clip) flags.push(`--use-file-for-fake-video-capture=${clip}`);
  return flags;
}
