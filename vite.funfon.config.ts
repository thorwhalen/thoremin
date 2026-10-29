/**
 * funfon: the standalone game pages (`play/`) built alone as an app of their own, served at
 * `/funfon/` with `play/index.html` as its home. The same pages ship inside thoremin's build under
 * `/thoremin/play/`; this build carries nothing else (no app shell, no extension, no camera).
 * `npm run build:funfon` writes `enlace_apps/funfon/frontend/`, the app dir tw_platform deploys
 * (`enlace_apps/funfon/app.toml`); the deployer sets `VITE_PUBLIC_BASE=/funfon/`.
 */
import path from 'path';
import { defineConfig } from 'vite';
import { PLAY_PAGES } from './play/pages';

export default defineConfig({
  root: path.resolve(__dirname, 'play'),
  base: process.env.VITE_PUBLIC_BASE || '/funfon/',
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'enlace_apps', 'funfon', 'frontend'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'play', 'index.html'),
        ...Object.fromEntries(PLAY_PAGES.map((p) => [p, path.resolve(__dirname, 'play', `${p}.html`)])),
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
