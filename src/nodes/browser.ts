/**
 * The browser-only nodes (webcam, Web Audio synth, keyboard listener, canvas overlay, MIDI out),
 * re-exported for the app shell and the tests, and the app registry that combines them with the
 * pure {@link CORE_NODES} and the extensions' contributions (since #600 S6 it lives in the host,
 * `src/host/appRegistry.ts`, and is re-exported here). Importing this module pulls in TF.js /
 * MediaPipe through the webcam nodes.
 */

export { webcamHandsNode } from './sources/webcam_hands';
export { webcamFaceNode } from './sources/webcam_face';
export { webcamBodyNode, resultToBodyFrame } from './sources/webcam_body';
export { keyboardSourceNode } from './sources/keyboard';
export { storeControlsNode, makeStoreControlsNode } from '@/host/storeControls';
export { webAudioSynthNode } from './output/webaudio_synth';
export { canvasOverlayNode } from './output/canvas_overlay';
// The air instruments' sinks (drums, plucked strings) are the air extension's
// (`packages/ext-air/src/nodes/{drum,pluck}_out`), registered through its manifest.
// The browser-only Lyria engine (`./output/lyria_engine`) is deliberately NOT
// re-exported here (#188): the `lyria` node dynamically imports it the first time
// the generative layer is enabled, and a static re-export from this module — which
// the app shell imports — would put `@google/genai` back in the main bundle for
// every player. Only the facade + factory types are surfaced.
export type { GenerativeEngineFactory, GenerativeEngineOpts } from './output/generative';
export type { GenerativeStatus } from './output/lyria';

// The app registry itself lives in the host (#600 S6).
export { BROWSER_NODES, createAppRegistry, loadedAppRegistry } from '@/host/appRegistry';
