/**
 * Browser node registry — combines the pure {@link CORE_NODES} with the
 * browser-only nodes (webcam, Web Audio synth, keyboard listener, canvas
 * overlay). Importing this module pulls in TF.js / MediaPipe, so it must only
 * be imported by the app shell, never by Node tests.
 */
import { createRegistry, type NodeRegistry } from '@thoremin/dag';
import { CORE_NODES } from './index';
import { webcamHandsNode } from './sources/webcam_hands';
import { webcamFaceNode } from './sources/webcam_face';
import { webcamBodyNode } from './sources/webcam_body';
import { keyboardSourceNode } from './sources/keyboard';
import { makeStoreControlsNode } from './sources/store_controls';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import { EXTENSIONS, loadExtensionNodes, loadedExtensionNodes } from '@/extensions';
import type { NodeDef } from '@thoremin/dag';
import { webAudioSynthNode } from './output/webaudio_synth';
import { canvasOverlayNode } from './output/canvas_overlay';
import { midiOutNode } from './output/midi_out';

export { webcamHandsNode } from './sources/webcam_hands';
export { webcamFaceNode } from './sources/webcam_face';
export { webcamBodyNode, resultToBodyFrame } from './sources/webcam_body';
export { keyboardSourceNode } from './sources/keyboard';
export { storeControlsNode, makeStoreControlsNode } from './sources/store_controls';
export { webAudioSynthNode } from './output/webaudio_synth';
export { canvasOverlayNode } from './output/canvas_overlay';
// The `midi-out` node's contract logic is Node-safe, but it is registered here
// (not in the pure CORE_NODES) because its default sink lazy-loads the browser-only
// WEBMIDI.js library; its facade types + browser adapter live alongside it.
export { midiOutNode } from './output/midi_out';
export type { MidiSink, MidiSinkFactory, MidiOpenResult, MidiStatus, MidiPhase } from './output/midi_out';
export { openWebMidiSink } from './output/midi_engine';
// The air instruments' sinks (drums, plucked strings) are the air extension's
// (`packages/ext-air/src/nodes/{drum,pluck}_out`), registered through its manifest.
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
  webcamBodyNode,
  keyboardSourceNode,
  webAudioSynthNode,
  canvasOverlayNode,
  midiOutNode,
];

/**
 * Registry with every node available in the browser app: the core library, the browser
 * sources and sinks, every extension's nodes, and a `store-controls` whose ports are
 * GENERATED from the extensions' dial slices and transient fields (the ADR's seam 6).
 */
export function createAppRegistry(extensions: readonly Extension[] = EXTENSIONS): NodeRegistry {
  const registry = createRegistry([...CORE_NODES, ...BROWSER_NODES, makeStoreControlsNode(extensions)]);
  for (const e of extensions) {
    if (e.provides && !e.load) {
      throw new Error(`createAppRegistry: extension "${e.id}" is a lazy stub (it names \`provides\`) with no \`load\`: pass the list from '@/extensions', which the build gives a loader, not the package's own export`);
    }
    // A lazy extension's nodes are registered at once when this page already loaded them (a
    // rebuilt registry stays synchronous); otherwise declared, for `registry.ensure` to load
    // when a graph names one (`docs/design/lazy-extensions.md`).
    const nodes = loadedExtensionNodes(e);
    if (nodes) registry.register(...(nodes as NodeDef<unknown>[]));
    // A tool-only lazy extension (no node types) has nothing to declare.
    else if (e.provides?.length) registry.declareLazy(e.provides, () => loadExtensionNodes(e));
  }
  return registry;
}

/** {@link createAppRegistry} with every lazy extension's nodes loaded: for the scripts and tests
 *  that list or run every node (the catalog, the golden graphs). The app never needs it. */
export async function loadedAppRegistry(extensions: readonly Extension[] = EXTENSIONS): Promise<NodeRegistry> {
  await Promise.all(extensions.map((e) => loadExtensionNodes(e)));
  return createAppRegistry(extensions);
}
