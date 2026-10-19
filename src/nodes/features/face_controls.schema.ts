/**
 * The `face_controls` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */
import { z } from 'zod';

const Params = z.object({
  /** Shared EMA smoothing 0..1 per tick (0 = instant, higher = smoother/slower). */
  smoothing: z.number().min(0).max(0.999).default(0.3),

  // --- Head pose (degrees) → bipolar [-1,1] axes ---
  /** Degrees of rotation (from the neutral zero) that reach full-scale ±1. */
  headRangeDeg: z.number().min(1).default(30),
  /** Degrees of deadzone around the neutral zero (pose noise + drift rejection). */
  headDeadzoneDeg: z.number().min(0).default(3),
  /** Neutral "facing the camera" zero per axis (degrees) — a calibration seam. */
  yawZeroDeg: z.number().default(0),
  pitchZeroDeg: z.number().default(0),
  rollZeroDeg: z.number().default(0),
  /** Per-axis gain (negative flips direction), applied after the deadzone. */
  yawGain: z.number().default(1),
  /**
   * NEGATIVE by default, and that is a measurement rather than a preference.
   *
   * MediaPipe's facial transformation matrix decodes chin-UP (looking at the ceiling)
   * as a NEGATIVE pitch — confirmed at −36.7° against a real recording in
   * `test/fixtures/video_head_pose/`, whose frames show exactly that pose. The axis's
   * intent (#146 check 2) is "tilt the chin up, the chord goes UP an octave", so the
   * raw sign has to be flipped. It shipped at +1 for a month, inverted, because the
   * axes were tuned with no camera and this convention is one `packages/sdk/src/nodes/domain.ts`
   * deliberately declines to assert.
   *
   * Pitch is settled and the other two are not: horizontal mirroring cannot affect
   * pitch, whereas yaw and roll flip with it, and whether a given recording is
   * mirrored is an iOS setting that is not in the file. See the fixture README.
   */
  pitchGain: z.number().default(-1),
  rollGain: z.number().default(1),

  // --- Blendshape → unipolar [0,1] / bipolar [-1,1] axes ---
  /** Rest deadzone for the jaw/brow/pucker channels (they read slightly active at rest). */
  mouthDeadzone: z.number().min(0).max(0.9).default(0.08),
  browDeadzone: z.number().min(0).max(0.9).default(0.1),
  puckerDeadzone: z.number().min(0).max(0.9).default(0.12),
  /** Deadzone for the bipolar smile↔frown axis. */
  smileDeadzone: z.number().min(0).max(0.9).default(0.06),
  /** Per-axis gain for the blendshape channels. */
  mouthGain: z.number().min(0).default(1),
  browGain: z.number().min(0).default(1),
  puckerGain: z.number().min(0).default(1),
  smileGain: z.number().min(0).default(1),
});
type Params = z.infer<typeof Params>;

/**
 * The node's params, re-exported as the SSOT for the `faceControls` **dial** (#76).
 *
 * Lifted 1:1 rather than restated, for the reason `OverlayDialSchema` exists in
 * `canvas_overlay.ts`: a dial that re-declares a node's params is a second shape that
 * drifts silently the first time one side gains a field. Because the dial IS this
 * schema, `commands/paths.ts` derives a `dial.setIn` leaf for every axis knob here with
 * no hand-maintenance — add a param below and it becomes settable from the panel, the
 * Cmd/Ctrl-K palette, the AI assistant and a keybinding at once.
 *
 * (Unlike `OverlayDialSchema` there is nothing to `.omit()`: every param here is a
 * per-instrument musical parameter, not a per-device tooling pref.)
 */
export const FaceControlsDialSchema = Params;
export type FaceControlsDialParams = Params;

/** The shipped defaults, as a plain value — the dial/store/schema default. */
export const DEFAULT_FACE_CONTROLS_DIAL: FaceControlsDialParams = FaceControlsDialSchema.parse({});
