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
import { replayHandsNode } from './sources/replay_hands';
import { syntheticBodyNode } from './sources/synthetic_body';
import { replayBodyNode } from './sources/replay_body';
import { handFeaturesNode } from './features/hand_features';
import { faceFeaturesNode } from './features/face_features';
import { faceControlsNode } from './features/face_controls';
import { conductorNode } from './features/conductor';
import { faceExpressionNode } from './features/face_expression';
import { gestureClassifierNode } from './features/gesture_classifier';
import { faceFeatureVectorNode } from './features/face_feature_vector';
import { handFeatureVectorNode } from './features/hand_feature_vector';
import { bodyFeatureVectorNode } from './features/body_feature_vector';
import { voiceMappingNode } from './mapping/voice_mapping';
import { keyboardControlNode } from './mapping/keyboard_control';
import { indirectMapNode } from './mapping/indirect_map';
import { synthMergeNode } from './mapping/synth_merge';
import { chordSelectNode } from './mapping/chord_select';
import { pickNode } from './mapping/pick';
import { oneEuroNode } from './mapping/one_euro';
import { lyriaNode } from './output/lyria';
import { chordNode } from './music/chord';
import { expressionChordNode } from './music/expression_chord';
import { poseChordNode } from './music/pose_chord';
import { progressionNode } from './music/progression';
import { transportNode } from './music/transport';
import { scoreNode } from './music/score';
import { performanceNode } from './music/performance';

export { syntheticHandsNode } from './sources/synthetic_hands';
export { replaySourceNode } from './sources/replay';
export { replayHandsNode } from './sources/replay_hands';
export { syntheticBodyNode } from './sources/synthetic_body';
export { replayBodyNode } from './sources/replay_body';
export { BODY_SLOT_CONTRACT, BODY_SLOT_OUTPUT } from './sources/body_contract';
export {
  SOURCE_SLOT_CONTRACT,
  SOURCE_SLOT_OUTPUT,
  SOURCE_SLOT_INPUTS,
} from './sources/source_contract';
export type { SlotContract } from './slot_contract';
export { handFeaturesNode } from './features/hand_features';
export { faceFeaturesNode } from './features/face_features';
export { faceControlsNode } from './features/face_controls';
export {
  conductorNode,
  ConductorDialSchema,
  DEFAULT_CONDUCTOR_DIAL,
  MusicalTimeSchema,
  CONDUCTOR_HANDS,
  CONDUCTOR_POINTS,
} from './features/conductor';
export type { ConductorDialParams, ConductorHand, ConductorPoint } from './features/conductor';
export { faceExpressionNode } from './features/face_expression';
export { gestureClassifierNode } from './features/gesture_classifier';
export type { Pose, GestureEvent } from './features/gesture_classifier';
export { faceFeatureVectorNode } from './features/face_feature_vector';
export { handFeatureVectorNode } from './features/hand_feature_vector';
export { bodyFeatureVectorNode } from './features/body_feature_vector';
export type { FeatureVector } from '@/features/catalog';
export { voiceMappingNode } from './mapping/voice_mapping';
export { keyboardControlNode } from './mapping/keyboard_control';
export { indirectMapNode } from './mapping/indirect_map';
export { synthMergeNode } from './mapping/synth_merge';
export { chordSelectNode } from './mapping/chord_select';
export { pickNode } from './mapping/pick';
export { oneEuroNode } from './mapping/one_euro';
export { lyriaNode } from './output/lyria';
export { chordNode, voiceChord } from './music/chord';
export { expressionChordNode, CHORD_VOICE_ID_BASE, MAX_CHORD_VOICES } from './music/expression_chord';
export { poseChordNode, POSE_VOICE_ID_BASE, MAX_POSE_VOICES, yawToDegree } from './music/pose_chord';
export { progressionNode } from './music/progression';
export { transportNode } from './music/transport';
export { scoreNode, SCORE_VOICE_ID_BASE, DEMO_SCALE_NOTES } from './music/score';
export { performanceNode } from './music/performance';
export type { GenerativeEngine, GenerativeSteer, GenerativeConfig, WeightedPrompt, GenerativeEngineFactory, GenerativeEngineOpts } from './output/generative';
export type { GenerativeStatus } from './output/lyria';
export * from './domain';

/** The pure node definitions, safe to instantiate anywhere (incl. Node tests). */
export const CORE_NODES = [
  syntheticHandsNode,
  replaySourceNode,
  replayHandsNode,
  syntheticBodyNode,
  replayBodyNode,
  handFeaturesNode,
  faceFeaturesNode,
  faceControlsNode,
  conductorNode,
  faceExpressionNode,
  gestureClassifierNode,
  faceFeatureVectorNode,
  handFeatureVectorNode,
  bodyFeatureVectorNode,
  voiceMappingNode,
  keyboardControlNode,
  indirectMapNode,
  synthMergeNode,
  chordSelectNode,
  pickNode,
  oneEuroNode,
  lyriaNode,
  chordNode,
  expressionChordNode,
  poseChordNode,
  progressionNode,
  transportNode,
  scoreNode,
  performanceNode,
];

/** Build a registry pre-loaded with the pure node library. */
export function createCoreRegistry(): NodeRegistry {
  return createRegistry(CORE_NODES);
}
