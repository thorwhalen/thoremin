/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Vite config doubles as the Vitest config (the `test` block). The `@` alias
// lets both the app and the tests import from `src/` with a stable prefix.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    // Most of our unit tests are pure TS (DAG core, nodes, music helpers) and
    // need no DOM. The few that touch DOM/canvas opt in per-file.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
