/**
 * Browser node registry — combines the pure {@link CORE_NODES} with the
 * browser-only nodes (webcam, Web Audio synth, keyboard listener, canvas
 * overlay). Importing this module pulls in TF.js / MediaPipe, so it must only
 * be imported by the app shell, never by Node tests.
 */
import { createRegistry, type NodeRegistry } from '@/dag';
import { CORE_NODES } from './index';
import { webcamHandsNode } from './sources/webcam_hands';
import { webcamFaceNode } from './sources/webcam_face';
import { keyboardSourceNode } from './sources/keyboard';
import { storeControlsNode } from './sources/store_controls';
import { webAudioSynthNode } from './output/webaudio_synth';
import { canvasOverlayNode } from './output/canvas_overlay';
import { midiOutNode } from './output/midi_out';

export { webcamHandsNode } from './sources/webcam_hands';
export { webcamFaceNode } from './sources/webcam_face';
export { keyboardSourceNode } from './sources/keyboard';
export { storeControlsNode } from './sources/store_controls';
export { webAudioSynthNode } from './output/webaudio_synth';
export { canvasOverlayNode } from './output/canvas_overlay';
// The `midi-out` node's contract logic is Node-safe, but it is registered here
// (not in the pure CORE_NODES) because its default sink lazy-loads the browser-only
// WEBMIDI.js library; its facade types + browser adapter live alongside it.
export { midiOutNode } from './output/midi_out';
export type { MidiSink, MidiSinkFactory, MidiOpenResult, MidiStatus, MidiPhase } from './output/midi_out';
export { openWebMidiSink } from './output/midi_engine';
// The browser-only Lyria engine (`./output/lyria_engine`) is deliberately NOT
// re-exported here (#188): the `lyria` node dynamically imports it the first time
// the generative layer is enabled, and a static re-export from this module — which
// the app shell imports — would put `@google/genai` back in the main bundle for
// every player. Only the facade + factory types are surfaced.
export type { GenerativeEngineFactory, GenerativeEngineOpts } from './output/generative';
export type { GenerativeStatus } from './output/lyria';

export const BROWSER_NODES = [
  webcamHandsNode,
  webcamFaceNode,
  keyboardSourceNode,
  storeControlsNode,
  webAudioSynthNode,
  canvasOverlayNode,
  midiOutNode,
];

/** Registry with every node available in the browser app. */
export function createAppRegistry(): NodeRegistry {
  return createRegistry([...CORE_NODES, ...BROWSER_NODES]);
}
