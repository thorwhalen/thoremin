/**
 * Domain types flowing on the DAG's edges (the port kinds), plus helpers to synthesize
 * hand and body landmark geometry (used by the synthetic sources and by tests, so we never
 * need a camera to exercise the feature/mapping/synthesis stages). The facade: each kind
 * lives in `domain/` (`frame_timing`, `hands`, `face`, `body`, `synth`, `category`), and
 * this module re-exports all of it, so importers name `@thoremin/sdk/nodes/domain` only.
 */
export { FRAME_TIME_SOURCES, CLOCK_DERIVED_SOURCES, isClockDerived, frameTime, FrameTimingSchema } from './domain/frame_timing';
export type { FrameTiming } from './domain/frame_timing';
export { KeypointSchema, HandSchema, HandsFrameSchema, FINGER_NAMES, ABSENT_HAND, LM, kp, dist2d, dist3d, makeHandKeypoints } from './domain/hands';
export type { Keypoint, Handedness, Hand, HandsFrame, FingerName, FingerCloseness, SingleHandFeatures, HandFeatures, SyntheticHandSpec } from './domain/hands';
export { FACE_MAPPINGS, legacyFaceToMapping, ZERO_HEAD_POSE, matrixToHeadPose, ABSENT_FACE, ABSENT_FACE_CONTROLS, ABSENT_FACE_STATUS } from './domain/face';
export type { FaceMapping, FaceFrame, HeadPose, FaceFeatures, FaceControls, FaceStatusPhase, FaceStatus } from './domain/face';
export { BLM, BODY_LANDMARK_NAMES, BODY_LANDMARK_COUNT, BODY_BONES, BodyFrameSchema, EMPTY_BODY_FRAME, BODY_MODELS, ABSENT_BODY_STATUS, blm, makeBodyKeypoints } from './domain/body';
export type { BodyLandmarkName, BodyFrame, BodyModel, BodyStatus, SyntheticBodySpec } from './domain/body';
export type { VoiceParams, SynthParams } from './domain/synth';
export type { CategoryScores } from './domain/category';
