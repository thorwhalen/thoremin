/**
 * Browser node registry — combines the pure {@link CORE_NODES} with the
 * browser-only nodes (webcam, Web Audio synth, keyboard listener, canvas
 * overlay). Importing this module pulls in TF.js / MediaPipe, so it must only
 * be imported by the app shell, never by Node tests.
 */
import { createRegistry, type NodeRegistry } from '@/dag';
import { CORE_NODES } from './index';
import { webcamHandsNode } from './sources/webcam_hands';
import { keyboardSourceNode } from './sources/keyboard';
import { storeControlsNode } from './sources/store_controls';
import { webAudioSynthNode } from './output/webaudio_synth';
import { canvasOverlayNode } from './output/canvas_overlay';

export { webcamHandsNode } from './sources/webcam_hands';
export { keyboardSourceNode } from './sources/keyboard';
export { storeControlsNode } from './sources/store_controls';
export { webAudioSynthNode } from './output/webaudio_synth';
export { canvasOverlayNode } from './output/canvas_overlay';

export const BROWSER_NODES = [
  webcamHandsNode,
  keyboardSourceNode,
  storeControlsNode,
  webAudioSynthNode,
  canvasOverlayNode,
];

/** Registry with every node available in the browser app. */
export function createAppRegistry(): NodeRegistry {
  return createRegistry([...CORE_NODES, ...BROWSER_NODES]);
}
