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
    // Vitest config: the DAG core/nodes/music tests are pure TS (no DOM/audio), so
    // `node` is the DEFAULT environment — they need no camera/GPU and stay fast.
    //
    // A `.test.tsx` file opts INTO jsdom with a `// @vitest-environment jsdom` docblock.
    // Those are the SHELL tests: whether a feature is reachable from the app's UI is a
    // question only a rendered component can answer, and the absence of any such test is
    // how a whole subsystem (the Feature Lab, #136) shipped to production unreachable
    // with 759 green tests.
    test: {
      globals: true,
      environment: 'node',
      include: ['test/**/*.test.{ts,tsx}'],
    },
  };
});
