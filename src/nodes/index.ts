/**
 * Node library — pure, Node-safe nodes plus a registry builder.
 *
 * Only nodes that are safe to import in plain Node (no DOM/audio/webgl at
 * module load) live here. Browser-only nodes (webcam, hand detector, Web Audio
 * synth, keyboard, canvas overlay, Lyria) are registered separately by the app
 * shell so these stay testable in Vitest's `node` environment.
 */
import { createRegistry, type NodeRegistry } from '@thoremin/dag';

import { syntheticHandsNode } from './sources/synthetic_hands';
import { audioEventsNode } from './sources/audio_events';
import { replaySourceNode } from './sources/replay';
import { replaySourceTimedNode } from './sources/replay_timed';
import { replayHandsNode } from './sources/replay_hands';
import { handFeaturesNode } from './features/hand_features';
import { handsDwellNode } from './features/hands_dwell';
import { faceFeaturesNode } from './features/face_features';
import { faceControlsNode } from './features/face_controls';
import { faceExpressionNode } from './features/face_expression';
import { gestureClassifierNode } from './features/gesture_classifier';
import { faceFeatureVectorNode } from './features/face_feature_vector';
import { handFeatureVectorNode } from './features/hand_feature_vector';
import { voiceMappingNode } from './mapping/voice_mapping';
import { keyboardControlNode } from './mapping/keyboard_control';
import { synthMergeNode } from './mapping/synth_merge';
import { chordSelectNode } from './mapping/chord_select';
import { pickNode } from './mapping/pick';
import { oneEuroNode } from './mapping/one_euro';
import { delayNode } from './mapping/delay';
import { chordNode } from './music/chord';
import { expressionChordNode } from './music/expression_chord';
import { poseChordNode } from './music/pose_chord';
import { progressionNode } from './music/progression';
import { transportNode } from './music/transport';
import { scoreNode } from './music/score';
import { performanceNode } from './music/performance';

export { syntheticHandsNode } from './sources/synthetic_hands';
export { audioEventsNode } from './sources/audio_events';
export { replaySourceNode } from './sources/replay';
export { replaySourceTimedNode } from './sources/replay_timed';
export {
  stateGeneratorSource,
  stateGeneratorParams,
  tickRng,
  STATE_GENERATOR_OUTPUTS,
} from './sources/state_generator';
export type { StateGeneratorSpec, StateGeneratorInput, StateGeneratorParams } from './sources/state_generator';
export { replayHandsNode } from './sources/replay_hands';
export { BODY_SLOT_CONTRACT, BODY_SLOT_OUTPUT } from './sources/body_contract';
export {
  SOURCE_SLOT_CONTRACT,
  SOURCE_SLOT_OUTPUT,
  SOURCE_SLOT_INPUTS,
} from './sources/source_contract';
export type { SlotContract } from './slot_contract';
export { handFeaturesNode } from './features/hand_features';
export { handsDwellNode } from './features/hands_dwell';
export { faceFeaturesNode } from './features/face_features';
export { faceControlsNode } from './features/face_controls';
export { faceExpressionNode } from './features/face_expression';
export { gestureClassifierNode } from './features/gesture_classifier';
export type { Pose, GestureEvent } from './features/gesture_classifier';
export { faceFeatureVectorNode } from './features/face_feature_vector';
export { handFeatureVectorNode } from './features/hand_feature_vector';
export type { FeatureVector } from '@thoremin/sdk/features/catalog';
export { voiceMappingNode } from './mapping/voice_mapping';
// The voice mapping's `mods` contract (the body slice's router emits it; #600 S17b).
export { NEUTRAL_MODS } from '@thoremin/sdk/music/effects';
export type { VoiceMods } from '@thoremin/sdk/music/effects';
export { keyboardControlNode } from './mapping/keyboard_control';
export { synthMergeNode } from './mapping/synth_merge';
export { chordSelectNode } from './mapping/chord_select';
export { pickNode } from './mapping/pick';
export { oneEuroNode } from './mapping/one_euro';
export { delayNode } from './mapping/delay';
export { chordNode, voiceChord } from './music/chord';
export { expressionChordNode, CHORD_VOICE_ID_BASE, MAX_CHORD_VOICES } from './music/expression_chord';
export { poseChordNode, POSE_VOICE_ID_BASE, MAX_POSE_VOICES, yawToDegree } from './music/pose_chord';
export { progressionNode } from './music/progression';
export { transportNode } from './music/transport';
export { scoreNode, SCORE_VOICE_ID_BASE, DEMO_SCALE_NOTES, DEMO_LOOP_BEATS } from './music/score';
export { performanceNode } from './music/performance';
export * from '@thoremin/sdk/nodes/domain';

/** The pure node definitions, safe to instantiate anywhere (incl. Node tests). */
export const CORE_NODES = [
  syntheticHandsNode,
  audioEventsNode,
  replaySourceNode,
  replaySourceTimedNode,
  replayHandsNode,
  handFeaturesNode,
  handsDwellNode,
  faceFeaturesNode,
  faceControlsNode,
  faceExpressionNode,
  gestureClassifierNode,
  faceFeatureVectorNode,
  handFeatureVectorNode,
  voiceMappingNode,
  keyboardControlNode,
  synthMergeNode,
  chordSelectNode,
  pickNode,
  oneEuroNode,
  delayNode,
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
