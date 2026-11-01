/**
 * The built app served by `vite preview`, for every script that photographs or measures it
 * (`guide_media.mjs`, the latency scripts). One place, so the server's lifetime is right
 * everywhere (#732).
 *
 * The server must not outlive the script. Two things used to let it:
 *
 * - **A wrapper in between.** Spawned as `npx vite preview`, the child the script kills is npx
 *   (or the shell npm runs), and the `vite preview` grandchild keeps listening. The next run on
 *   the same port then refuses (`--strictPort`), and on a shared server the stray holds the port
 *   while photographing nothing. So vite is spawned directly, with this Node.
 * - **An exit that skips the cleanup.** The server is stopped by `stop()`, and also when the
 *   script exits for any other reason: a thrown error (the `exit` event), or SIGINT / SIGTERM
 *   (whose default action would end the script without an `exit` event).
 *
 * A port that already answers is refused before spawning: it would be another worktree's
 * build (with `--strictPort` the spawn would fail, and the script would photograph the other
 * build), so the caller is told to stop it or choose another port (#728).
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Where the app is served (vite `base`). */
export const BASE_PATH = '/thoremin/instruments/';

const SIGNALS = { SIGINT: 130, SIGTERM: 143 };

const answers = (url) => fetch(url).then(() => true, () => false);

/**
 * `vite preview` of the built bundle on `port`. Resolves to `{ proc, url, stop }` once the app
 * answers; `stop()` is idempotent, and runs on its own when the script exits.
 */
export async function startPreview(port, { attempts = 100, intervalMs = 200 } = {}) {
  const url = `http://localhost:${port}${BASE_PATH}`;
  if (await answers(url)) {
    throw new Error(`something already listens on port ${port} (another worktree's preview?). Stop it or pass --port <free port>.`);
  }
  const vite = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });

  const onSignal = Object.fromEntries(
    Object.entries(SIGNALS).map(([sig, code]) => [
      sig,
      () => {
        stop();
        process.exit(code);
      },
    ]),
  );
  function stop() {
    process.off('exit', stop);
    for (const [sig, handler] of Object.entries(onSignal)) process.off(sig, handler);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
  }
  process.on('exit', stop);
  for (const [sig, handler] of Object.entries(onSignal)) process.on(sig, handler);

  for (let i = 0; i < attempts; i++) {
    if (proc.exitCode !== null) {
      stop();
      throw new Error(`vite preview exited (code ${proc.exitCode}) before serving on port ${port}`);
    }
    try {
      if ((await fetch(url)).ok) return { proc, url, stop };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  stop();
  throw new Error(`vite preview did not come up on ${url} (did you run npm run build?)`);
}
