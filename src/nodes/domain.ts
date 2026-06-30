/**
 * Domain types flowing on the DAG's edges, plus helpers to synthesize hand
 * landmark geometry (used by the synthetic source and by tests, so we never
 * need a camera to exercise the feature/mapping/synthesis stages).
 *
 * Landmark indices follow MediaPipe Hands (21 points). We also tolerate named
 * keypoints (as emitted by @tensorflow-models/hand-pose-detection).
 */
import type { SoundId } from '@/music/sounds';

export interface Keypoint {
  x: number;
  y: number;
  z?: number;
  /** MediaPipe/TFJS keypoint name, e.g. 'index_finger_tip'. Optional. */
  name?: string;
}

export type Handedness = 'Left' | 'Right';

export interface Hand {
  handedness: Handedness;
  /** 21 keypoints in pixel coordinates of the source frame. */
  keypoints: Keypoint[];
  score?: number;
}

/** One frame of detected hands, carrying the source frame dimensions. */
export interface HandsFrame {
  width: number;
  height: number;
  hands: Hand[];
}

/** Per-hand features derived from landmarks, all normalized to [0, 1]. */
export interface SingleHandFeatures {
  present: boolean;
  /** Index-fingertip horizontal position, 0 = left edge, 1 = right edge. */
  x: number;
  /** Index-fingertip vertical position, 0 = top, 1 = bottom. */
  y: number;
  /** Hand openness: 0 = closed fist, 1 = fully spread. */
  openness: number;
  /** Thumb-to-index pinch: 0 = wide apart, 1 = touching. */
  pinch: number;
}

export interface HandFeatures {
  left: SingleHandFeatures;
  right: SingleHandFeatures;
}

export const ABSENT_HAND: SingleHandFeatures = {
  present: false,
  x: 0,
  y: 0,
  openness: 0,
  pinch: 0,
};

/** Synthesis parameters for one voice. */
export interface VoiceParams {
  /** Stable voice id (0 = right, 1 = left, by convention). */
  id: number;
  present: boolean;
  freq: number;
  gain: number;
  /** Instrument timbre — an id from the {@link SoundId} registry. */
  sound: SoundId;
  /**
   * Live tone brightness, 0 (dark/mellow) .. 1 (open/present). Drives a
   * per-voice low-pass in the synth so gestures (e.g. hand openness) shape
   * timbre expressively. Optional; absent is treated as 1 (fully open).
   */
  brightness?: number;
  /**
   * Live vibrato amount, 0 (none) .. 1 (full). Adds pitch wobble on top of any
   * preset vibrato, so gestures (e.g. pinch) add expression. Optional; absent
   * is treated as 0 (no added vibrato).
   */
  vibrato?: number;
  /**
   * Stereo pan, -1 (hard left) .. +1 (hard right). Lets hand position place the
   * voice in the stereo field. Optional; absent is treated as 0 (centre).
   */
  pan?: number;
}

export interface SynthParams {
  voices: VoiceParams[];
}

/**
 * What the player's facial expression maps to (the face-mapping chooser, #64):
 *  - `none`   : no face detection or mapping (the model never loads).
 *  - `timbre` : expression continuously shapes the active voices (smile→brightness,
 *               open mouth→vibrato).
 *  - `chord`  : expression selects a diatonic triad on the current seven-note scale.
 */
export const FACE_MAPPINGS = ['none', 'timbre', 'chord'] as const;
export type FaceMapping = (typeof FACE_MAPPINGS)[number];

/** Map the legacy boolean `faceEnabled` (pre-#64) onto the tri-state mapping: a
 * saved `true` becomes `timbre` (the old behaviour), `false`/absent → `none`. The
 * single source of truth for this migration, shared by the store persist migrate,
 * the preset preprocess, and the store-controls snapshot fallback. */
export function legacyFaceToMapping(faceEnabled: boolean | undefined): FaceMapping {
  return faceEnabled ? 'timbre' : 'none';
}

// ---- Face (MediaPipe Face Landmarker blendshapes) ------------------------

/**
 * One frame of face data: the 52 MediaPipe blendshape scores (each 0..1),
 * keyed by name (e.g. `mouthSmileLeft`, `jawOpen`, `browInnerUp`). Produced by
 * the browser `webcam-face` node or by `scripts/video_to_face.py`.
 */
export interface FaceFrame {
  present: boolean;
  blendshapes: Record<string, number>;
  /** Normalized (0..1) face landmark points in the source frame, for drawing the
   *  face mesh overlay. Optional — the feature/expression nodes ignore it. */
  landmarks?: { x: number; y: number }[];
}

/** Normalized expression controls derived from blendshapes, all 0..1. */
export interface FaceFeatures {
  present: boolean;
  /** Smile amount (mouth corners up). */
  smile: number;
  /** Jaw drop / open mouth. */
  mouthOpen: number;
  /** Eyebrows raised. */
  browRaise: number;
  /** Eyebrows furrowed/lowered. */
  browFurrow: number;
  /** Both eyes closed (blink). */
  eyeBlink: number;
}

export const ABSENT_FACE: FaceFeatures = {
  present: false,
  smile: 0,
  mouthOpen: 0,
  browRaise: 0,
  browFurrow: 0,
  eyeBlink: 0,
};

/**
 * Lifecycle + detection status of the lazy `webcam-face` model, surfaced so the
 * UI can give the player feedback (issue #65): is the model loading, ready, or
 * did it fail to load, and is a face currently in frame.
 */
export type FaceStatusPhase = 'idle' | 'loading' | 'ready' | 'error';
export interface FaceStatus {
  phase: FaceStatusPhase;
  /** A face is currently detected in frame (only meaningful while `ready`). */
  faceDetected: boolean;
}
export const ABSENT_FACE_STATUS: FaceStatus = { phase: 'idle', faceDetected: false };

// ---- MediaPipe Hands landmark indices ------------------------------------

export const LM = {
  wrist: 0,
  thumb_cmc: 1,
  thumb_mcp: 2,
  thumb_ip: 3,
  thumb_tip: 4,
  index_mcp: 5,
  index_pip: 6,
  index_dip: 7,
  index_tip: 8,
  middle_mcp: 9,
  middle_pip: 10,
  middle_dip: 11,
  middle_tip: 12,
  ring_mcp: 13,
  ring_pip: 14,
  ring_dip: 15,
  ring_tip: 16,
  pinky_mcp: 17,
  pinky_pip: 18,
  pinky_dip: 19,
  pinky_tip: 20,
} as const;

const NAME_TO_INDEX: Record<string, number> = {
  wrist: 0,
  thumb_tip: 4,
  index_finger_mcp: 5,
  index_finger_tip: 8,
  middle_finger_mcp: 9,
  middle_finger_tip: 12,
  ring_finger_tip: 16,
  pinky_finger_tip: 20,
};

/**
 * Fetch a keypoint by MediaPipe index, falling back to matching by `name` when
 * keypoints are named but possibly reordered.
 */
export function kp(hand: Hand, index: number): Keypoint | undefined {
  const byIndex = hand.keypoints[index];
  if (byIndex) return byIndex;
  // Fallback: find the name that maps to this index.
  const name = Object.keys(NAME_TO_INDEX).find((n) => NAME_TO_INDEX[n] === index);
  if (name) return hand.keypoints.find((k) => k.name === name);
  return undefined;
}

export function dist2d(a: Keypoint, b: Keypoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---- Synthetic hand geometry ---------------------------------------------

export interface SyntheticHandSpec {
  /** Hand center x in pixels. */
  cx: number;
  /** Hand center y in pixels. */
  cy: number;
  /** Overall hand size in pixels (wrist-to-middle-MCP scales with this). */
  scale: number;
  /** 0 = closed fist (tips near palm), 1 = fully open (tips extended). */
  spread: number;
  /** 0 = thumb & index apart, 1 = pinched together. */
  pinch: number;
  handedness: Handedness;
}

/**
 * Build a plausible 21-point hand pointing "up" (toward smaller y), so the
 * feature extractor produces controlled, monotonic features. Used by the
 * synthetic source and tests.
 *
 * Layout: wrist at (cx, cy), palm/MCP knuckles one `scale` above the wrist,
 * fingertips a further `scale * (0.4 + 0.9*spread)` above the knuckles. The
 * thumb sits to the side and swings toward the index tip as `pinch` -> 1.
 */
export function makeHandKeypoints(spec: SyntheticHandSpec): Keypoint[] {
  const { cx, cy, scale, spread, pinch } = spec;
  const pts: Keypoint[] = new Array(21);
  const set = (i: number, x: number, y: number) => {
    pts[i] = { x, y };
  };

  const knuckleY = cy - scale; // one hand-length up
  const tipReach = scale * (0.4 + 0.9 * Math.max(0, Math.min(1, spread)));
  // Four fingers (index, middle, ring, pinky) fan out horizontally.
  const fingerX = [-0.45, -0.15, 0.15, 0.45].map((f) => cx + f * scale);

  set(LM.wrist, cx, cy);

  // index / middle / ring / pinky: mcp, pip, dip, tip
  const fingerMcp = [LM.index_mcp, LM.middle_mcp, LM.ring_mcp, LM.pinky_mcp];
  const fingerTip = [LM.index_tip, LM.middle_tip, LM.ring_tip, LM.pinky_tip];
  const fingerPip = [LM.index_pip, LM.middle_pip, LM.ring_pip, LM.pinky_pip];
  const fingerDip = [LM.index_dip, LM.middle_dip, LM.ring_dip, LM.pinky_dip];
  for (let f = 0; f < 4; f++) {
    const fx = fingerX[f];
    set(fingerMcp[f], fx, knuckleY);
    set(fingerPip[f], fx, knuckleY - tipReach * 0.45);
    set(fingerDip[f], fx, knuckleY - tipReach * 0.75);
    set(fingerTip[f], fx, knuckleY - tipReach);
  }

  // Thumb: starts out to the (left) side; swings toward the index tip on pinch.
  const indexTip = pts[LM.index_tip];
  const thumbBaseX = cx - 0.7 * scale;
  const thumbBaseY = cy - 0.3 * scale;
  set(LM.thumb_cmc, cx - 0.5 * scale, cy - 0.1 * scale);
  set(LM.thumb_mcp, thumbBaseX, thumbBaseY);
  // ip and tip interpolate from the "open" thumb position toward the index tip.
  const openThumbTip = { x: cx - 0.9 * scale, y: cy - scale * 0.8 };
  const tipX = openThumbTip.x + pinch * (indexTip.x - openThumbTip.x);
  const tipY = openThumbTip.y + pinch * (indexTip.y - openThumbTip.y);
  set(LM.thumb_ip, (thumbBaseX + tipX) / 2, (thumbBaseY + tipY) / 2);
  set(LM.thumb_tip, tipX, tipY);

  return pts;
}
