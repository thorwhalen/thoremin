/**
 * The browser-only nodes (webcam, Web Audio synth, keyboard listener, canvas overlay, MIDI out),
 * re-exported for the app shell and the tests, and the app registry that combines them with the
 * pure {@link CORE_NODES} and the extensions' contributions (since #600 S6 it lives in the host,
 * `src/host/appRegistry.ts`, and is re-exported here). Importing this module pulls in TF.js /
 * MediaPipe through the webcam nodes.
 */

export { webcamHandsNode } from './sources/webcam_hands';
export { webcamFaceNode } from './sources/webcam_face';
export { keyboardSourceNode } from './sources/keyboard';
export { storeControlsNode, makeStoreControlsNode } from '@/host/storeControls';
export { webAudioSynthNode } from './output/webaudio_synth';
export { canvasOverlayNode } from './output/canvas_overlay';
// The air instruments' sinks (drums, plucked strings) are the air extension's
// (`packages/ext-air/src/nodes/{drum,pluck}_out`), registered through its manifest.

// The app registry itself lives in the host (#600 S6).
export { BROWSER_NODES, createAppRegistry, loadedAppRegistry } from '@/host/appRegistry';
