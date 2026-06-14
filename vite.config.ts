/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: process.env.VITE_PUBLIC_BASE || '/thoremin/',
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'frontend',
      emptyOutDir: true,
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        // The DAG engine + node library live under src/ and import via `@/...`.
        // The deployed React app uses relative imports, so pointing `@` at src/
        // is safe for it.
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    // Vitest config: the DAG core/nodes/music tests are pure TS (no DOM/audio),
    // so they run in the fast Node environment with no camera/GPU.
    test: {
      globals: true,
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  };
});
