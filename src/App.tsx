/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * FROZEN — the legacy hand-theremin app.
 *
 * This is the ORIGINAL (pre-DAG) front-end. It is reachable only at `?engine=legacy`
 * (alias `?engine=classic`); the bare URL mounts the DAG app (`src/app/App.tsx`), which
 * IS the product and where all new work goes.
 *
 * Frozen means: kept working, NOT developed. By convention this tree is excluded from
 * refactors — do not "clean it up", re-point it at new abstractions, or dedupe its
 * helpers against the DAG app's. It keeps its own copies on purpose, so a change to the
 * live app can never break it. Its dependency footprint (the TensorFlow.js hand-pose
 * stack, @mediapipe/hands) is retained for the same reason.
 *
 * The frozen tree is: this file → `components/Theremin.tsx` → `hooks/useAudioEngine.ts`,
 * `constants.ts`, the rest of `components/`, and the `plugins/` tree (the Lyria AI-DJ).
 *
 * If you are about to modify this file, you almost certainly want `src/app/` instead.
 */

import Theremin from './components/Theremin';
import { PluginProvider } from './plugins/PluginProvider';

export default function App() {
  return (
    <div className="min-h-screen bg-black">
      <PluginProvider>
        <Theremin />
      </PluginProvider>
    </div>
  );
}
