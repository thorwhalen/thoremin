/**
 * The built app served by `vite preview`, for every script that photographs or measures it
 * (`guide_media.mjs`, the latency scripts). One place, so the server's lifetime is right
 * everywhere (#732).
 *
 * The server must not outlive the script. It used to, because it was a separate process: spawned
 * as `npx vite preview`, the child the script killed was npx and the `vite preview` grandchild
 * kept listening (the next run on the port then refused, and on a shared server the stray held
 * the port while photographing nothing). Spawning vite directly still left a child to reap on
 * every way a script can end (an error, SIGINT, SIGTERM, SIGHUP, SIGKILL), and a child's errors
 * went to a stderr nobody read.
 *
 * So vite runs IN this process, through its JS API. The port belongs to the script's own process
 * and the OS frees it however the script dies, with no signal handler or exit hook here; a
 * failure to start is thrown with vite's own message. The one duty left to the caller: call
 * `stop()` when done, on success too, or the open server keeps the script alive.
 *
 * The config is the repo's own `vite.config.ts`, found from `root` as the CLI finds it, so `base`
 * and `build.outDir` are the ones the build used.
 *
 * A port that already answers is refused first (#728): it would be another worktree's build, and
 * the script would photograph that one. `strictPort` alone misses a server bound to the other
 * address family of `localhost`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Resolved by walking up from smoke/lib/ to the repo root's node_modules (smoke/node_modules holds
// only Playwright), so every caller, in smoke/ or smoke/latency/, gets the app's own vite.
import { preview } from 'vite';

/** The repo root: vite's `root`, and where the callers find the guide and its pictures. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The camera app's page, under vite's `base`. */
const APP_PAGE = 'instruments/';
/**
 * How long the "already answers" probe waits. A listener that accepts the connection but never
 * replies would otherwise hang the probe (and the script) for as long as fetch's own timeouts.
 */
const PROBE_TIMEOUT_MS = 2000;

const answers = (url) => fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).then(() => true, () => false);

/**
 * `vite preview` of the built bundle on `port`, in this process. Resolves to `{ url, stop }` once
 * it listens; `stop()` closes the server (async, idempotent).
 */
export async function startPreview(port) {
  const origin = `http://localhost:${port}`;
  if (await answers(origin)) {
    throw new Error(`something already listens on port ${port} (another worktree's preview?). Stop it or pass --port <free port>.`);
  }
  const server = await preview({ root: ROOT, logLevel: 'warn', preview: { port, strictPort: true } });
  return { url: `${origin}${server.config.base}${APP_PAGE}`, stop: () => server.close() };
}
