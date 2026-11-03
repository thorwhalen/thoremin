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

/**
 * Wait until the hand model has landed (#922). The instrument no longer waits for it, so the audio
 * running says nothing about the hands: until the hand source's `status` (the trunk's `cam`, read
 * through the debug handle `window.thoremin`) leaves `loading`, every frame is a frame with no
 * inference, and a measurement taken then measures the wrong pipeline. A model that cannot load
 * fails the run at once with its own message, rather than measuring an instrument with no hands.
 */
export async function waitForHandModel(page, { node = 'cam', timeout = 90_000 } = {}) {
  const handle = await page.waitForFunction(
    (id) => {
      const status = window.thoremin?.getOutput(id, 'status');
      return status && status.phase !== 'loading' ? status : null;
    },
    node,
    { timeout },
  );
  const status = await handle.jsonValue();
  if (status.phase === 'error') throw new Error(`the hand model did not load: ${status.message}`);
}
