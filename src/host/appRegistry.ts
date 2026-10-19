/**
 * The app's node registry (#600 S6: in the host, beside the contribution registry it folds): the
 * core node library, the browser-only nodes, and what the listed extensions contribute (their
 * nodes, lazily declared or registered; `store-controls`' generated ports; the fan-in pools and
 * the overlay sized for their branches and elements). `src/nodes/browser.ts` re-exports it, so the
 * many existing imports of `@/nodes/browser` keep working.
 */
import { createRegistry, type NodeDef, type NodeRegistry } from '@thoremin/dag';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import { CORE_NODES } from '@/nodes/index';
import { webcamHandsNode } from '@/nodes/sources/webcam_hands';
import { webcamFaceNode } from '@/nodes/sources/webcam_face';
import { keyboardSourceNode } from '@/nodes/sources/keyboard';
import { webAudioSynthNode } from '@/nodes/output/webaudio_synth';
import { canvasOverlayNode, makeCanvasOverlayNode } from '@/nodes/output/canvas_overlay';
import { makeSynthMergeNode } from '@/nodes/mapping/synth_merge';
import { makeChordSelectNode } from '@/nodes/mapping/chord_select';
import { makeStoreControlsNode } from './storeControls';
import { CONTRIBUTIONS, foldContributions, loadExtensionNodes, loadedExtensionNodes } from './contributions';

export const BROWSER_NODES = [
  webcamHandsNode,
  webcamFaceNode,
  keyboardSourceNode,
  webAudioSynthNode,
  canvasOverlayNode,
];

/**
 * Registry with every node available in the browser app: the core library, the browser
 * sources and sinks, every extension's nodes, and a `store-controls` whose ports are
 * GENERATED from the extensions' dial slices and transient fields (the ADR's seam 6).
 */
export function createAppRegistry(extensions: readonly Extension[] = CONTRIBUTIONS.extensions): NodeRegistry {
  // The fan-in nodes are sized for what this list of extensions can compose (#600 S4); the core
  // library's default-sized ones are left out in their favour.
  const { pools, overlayElements } = extensions === CONTRIBUTIONS.extensions ? CONTRIBUTIONS : foldContributions(extensions);
  // ...and the overlay grows a port per input of each element the extensions contribute (#600 S5).
  const sized = [makeSynthMergeNode(pools.merge), makeChordSelectNode(pools.chords), makeCanvasOverlayNode(overlayElements, pools.categories)];
  const keep = (n: { type: string }) => !sized.some((s) => s.type === n.type);
  const registry = createRegistry([...CORE_NODES.filter(keep), ...BROWSER_NODES.filter(keep), makeStoreControlsNode(extensions), ...sized]);
  for (const e of extensions) {
    if (e.provides && !e.load) {
      throw new Error(`createAppRegistry: extension "${e.id}" is a lazy stub (it names \`provides\`) with no \`load\`: pass the list from '@/host/contributions', which the build gives a loader, not the package's own export`);
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
export async function loadedAppRegistry(extensions: readonly Extension[] = CONTRIBUTIONS.extensions): Promise<NodeRegistry> {
  await Promise.all(extensions.map((e) => loadExtensionNodes(e)));
  return createAppRegistry(extensions);
}
