/**
 * The browser smoke harness (#209): Playwright over the BUILT bundle.
 *
 * Self-contained on purpose. `smoke/` is its own npm project (its own package.json,
 * lockfile and node_modules), so `@playwright/test` never enters the app's
 * package.json or the shared node_modules, and `npm test` (vitest, `test/**` only)
 * never sees these files. Run it with `npm run smoke` from the repo root; CI runs it
 * as its own job (`.github/workflows/smoke.yml`).
 *
 * The web server is the production build served by `vite preview` — the same
 * artefact `deploy.yml` ships — at the deployed base path (`/thoremin/`). The
 * browser is Chromium with autoplay allowed, so "Tap to play" can start the
 * AudioContext without a real gesture, and with a fake camera so `getUserMedia`
 * would never block (the suite boots with `?slot.source=synthetic-hands`, which
 * skips the camera entirely; the flags are a belt for a test that forgets to).
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.SMOKE_PORT ?? 4173);
/** The deployed base path (vite.config.ts `base`). */
export const BASE_PATH = '/thoremin/';

export default defineConfig({
  testDir: './tests',
  // `*.smoke.ts`, never `*.test.ts`: vitest's include is `test/**`, but a distinct
  // suffix keeps the two suites unmistakable in an editor too.
  testMatch: '**/*.smoke.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
  },
  webServer: {
    // Build first so the harness exercises exactly what ships, then serve it.
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
