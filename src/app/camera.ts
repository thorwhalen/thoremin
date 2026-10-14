/**
 * What the instrument asks the camera for (step 4 of the 2026-10-05 timing plan, #240),
 * in one place: the host's `getUserMedia` reads it, and the latency script mirrors it.
 *
 * - **`frameRate: { ideal: 60 }`.** A free request: a camera that cannot (every built-in
 *   MacBook FaceTime HD format is 15 to 30 fps) grants what it has, and the delivered
 *   rate is measured by the timing resource, not assumed. Where it is granted, a frame
 *   waits half as long for the next capture (about 8 ms of mean lead), even while
 *   inference drops every other one. That wait is before the capture stamp, so it is
 *   not part of `captureToTick`.
 * - **1280x720 with an `aspectRatio` of 16:9.** The plan proposed 640x360, since the hand
 *   model sees 192 to 224 px crops. Measured in headless Chromium 153 on SwiftShader
 *   (`measure.mjs`, a fake camera downscaled from a 1280x720 clip), it did not hold: on
 *   the CPU delegate the per-frame cost is flat from 854x480 to 1280x720 (107 to 118 ms),
 *   so a smaller capture is not a latency lever there, and the size stays where it was.
 *   (The same measurement found NO hands at 640x360 on the CPU delegate: that was the
 *   model reading a rescaled camera frame through a wrong WebGL upload, fixed for every
 *   size by `src/nodes/sources/model_input.ts`, #324.) The aspect constraint keeps 16:9 explicit: pad layouts (the air drum) are
 *   stored in normalised DISPLAY coordinates, and a 4:3 mode would move every saved pad.
 * - **The front camera** (`facingMode: user`), so the mirrored view shows the player's
 *   own hands on a phone.
 *
 * All `ideal`: soft constraints never fail; the camera returns the closest mode it has.
 */

export interface CaptureProfile {
  width: number;
  height: number;
  frameRate: number;
}

/** The capture the instrument asks for. */
export const CAPTURE: CaptureProfile = Object.freeze({ width: 1280, height: 720, frameRate: 60 });

/** The `video` constraints for `getUserMedia`. */
export function cameraConstraints(profile: CaptureProfile = CAPTURE): MediaTrackConstraints {
  return {
    width: { ideal: profile.width },
    height: { ideal: profile.height },
    aspectRatio: { ideal: profile.width / profile.height },
    frameRate: { ideal: profile.frameRate },
    facingMode: { ideal: 'user' },
  };
}
