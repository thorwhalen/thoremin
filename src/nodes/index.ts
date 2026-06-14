/**
 * Node library — pure, Node-safe nodes plus a registry builder.
 *
 * Only nodes that are safe to import in plain Node (no DOM/audio/webgl at
 * module load) live here. Browser-only nodes (webcam, hand detector, Web Audio
 * synth, keyboard, canvas overlay, Lyria) are registered separately by the app
 * shell so these stay testable in Vitest's `node` environment.
 */
import { createRegistry, type NodeRegistry } from '@/dag';

import { syntheticHandsNode } from './sources/synthetic_hands';
import { replaySourceNode } from './sources/replay';
import { handFeaturesNode } from './features/hand_features';
import { voiceMappingNode } from './mapping/voice_mapping';
import { keyboardControlNode } from './mapping/keyboard_control';
import { indirectMapNode } from './mapping/indirect_map';
import { lyriaNode } from './output/lyria';

export { syntheticHandsNode } from './sources/synthetic_hands';
export { replaySourceNode } from './sources/replay';
export { handFeaturesNode } from './features/hand_features';
export { voiceMappingNode } from './mapping/voice_mapping';
export { keyboardControlNode } from './mapping/keyboard_control';
export { indirectMapNode } from './mapping/indirect_map';
export { lyriaNode } from './output/lyria';
export type { GenerativeEngine, GenerativeSteer, GenerativeConfig, WeightedPrompt } from './output/generative';
export * from './domain';

/** The pure node definitions, safe to instantiate anywhere (incl. Node tests). */
export const CORE_NODES = [
  syntheticHandsNode,
  replaySourceNode,
  handFeaturesNode,
  voiceMappingNode,
  keyboardControlNode,
  indirectMapNode,
  lyriaNode,
];

/** Build a registry pre-loaded with the pure node library. */
export function createCoreRegistry(): NodeRegistry {
  return createRegistry(CORE_NODES);
}
