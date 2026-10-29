/**
 * What the latency scripts share (#850): the built app served by `vite preview`, the fake camera's
 * launch flags, and where a local camera clip lives. One place, so a change reaches every script.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..', '..');
/** Where the app is served (vite `base`). */
export const BASE_PATH = '/thoremin/instruments/';
/** The camera clip kept under the app-data dir (never in the repo); see `measure.mjs` for making one. */
export const DEFAULT_CLIP = join(homedir(), '.local/share/thoremin/latency/hands_720p30.y4m');

/** Chromium flags for a fake camera: playing `clip` when given, its own test pattern otherwise. */
export function fakeCameraFlags(clip) {
  const flags = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (clip) flags.push(`--use-file-for-fake-video-capture=${clip}`);
  return flags;
}

/** `vite preview` of the built bundle on `port`: `{ proc, url }`; the caller kills `proc`. */
export async function startPreview(port) {
  // vite itself, not through npx: killing an npx wrapper can leave the server running
  // and the next run failing on --strictPort.
  const vite = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = `http://localhost:${port}${BASE_PATH}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return { proc, url };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`vite preview did not come up on ${url} (did you run npm run build?)`);
}
