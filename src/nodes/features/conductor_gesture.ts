/**
 * The shaping hand's gesture (#457): how high it is held and which way its palm faces, the
 * conducting literature's expressive left hand (Kolesnik and Wanderley), as the numbers
 * ictus `createHandGesture` reads into loudness.
 *
 * The height is the hand's wrist on the torso (0 at the hips, 1 at the shoulders, the
 * transport's unit, #377) when a body frame is seen, else its height on the image. Hand
 * and pose frames come from the same camera, so each is read in its own frame heights.
 *
 * The palm. The normal of the palm plane is the cross product wrist->index MCP x
 * wrist->pinky MCP, and which way it points out of the palm flips with the hand's
 * chirality. The hand model's raw `handedness` label is a function of that chirality, so
 * one sign per label holds whatever the camera's mirroring: the palm's outward normal is
 * the cross product for `Right` and its negative for `Left`. Measured, not assumed: on
 * the ASL plugin's letter-B landmarks (a flat hand, palm toward the viewer), about 2,700
 * frames across eight datasets, both labels, image and world coordinates, at least 95 %
 * of frames per dataset and label agree. Image `y` points down, so `palmUp` is the
 * normal's `-y`: 1 palm up, -1 palm down, 0 facing the camera (or the orchestra).
 *
 * Pure: frames in, numbers out.
 */
import type { HandGestureFrame } from '@thoremin/ictus';
import { BLM, LM, type BodyFrame, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';

/** The palm's outward normal sign per raw handedness label (see the header). */
const PALM_SIGN: Record<Hand['handedness'], number> = { Right: 1, Left: -1 };

/** How far the palm faces up (-1..1), or undefined when the hand is degenerate. World
 *  keypoints when the detector gives them (metric, isotropic), else pixels with the
 *  model's depth in the same unit as x (MediaPipe's z is scaled like the image width). */
export function palmUp(hand: Hand, frame: Pick<HandsFrame, 'width'>): number | undefined {
  const world = hand.worldKeypoints && hand.worldKeypoints.length > LM.pinky_mcp ? hand.worldKeypoints : undefined;
  const kp = world ?? hand.keypoints;
  const zScale = world ? 1 : frame.width;
  const w = kp[LM.wrist];
  const i = kp[LM.index_mcp];
  const p = kp[LM.pinky_mcp];
  if (!w || !i || !p) return undefined;
  const a = { x: i.x - w.x, y: i.y - w.y, z: ((i.z ?? 0) - (w.z ?? 0)) * zScale };
  const b = { x: p.x - w.x, y: p.y - w.y, z: ((p.z ?? 0) - (w.z ?? 0)) * zScale };
  const n = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const m = Math.hypot(n.x, n.y, n.z);
  if (!(m > 1e-12)) return undefined;
  return (-PALM_SIGN[hand.handedness] * n.y) / m;
}

/** The hand's wrist on the torso (0 hips, 1 shoulders), or undefined without a body. */
function heightOnTorso(hand: Hand, frame: HandsFrame, body: BodyFrame | undefined): number | undefined {
  if (!body || body.present === false || !(body.height > 0)) return undefined;
  const L = body.landmarks;
  const ls = L[BLM.left_shoulder];
  const rs = L[BLM.right_shoulder];
  const lh = L[BLM.left_hip];
  const rh = L[BLM.right_hip];
  if (!ls || !rs || !lh || !rh) return undefined;
  const shY = (ls.y + rs.y) / 2 / body.height;
  const hipY = (lh.y + rh.y) / 2 / body.height;
  const torso = hipY - shY;
  if (!(torso > 1e-9)) return undefined;
  return (hipY - hand.keypoints[LM.wrist].y / frame.height) / torso;
}

/** One hands frame's shaping hand as the gesture's channels at `t`. */
export function handGestureFrame(hand: Hand, frame: HandsFrame, body: BodyFrame | undefined, t: number): HandGestureFrame {
  const torso = heightOnTorso(hand, frame, body);
  const height = torso ?? (frame.height > 0 ? -hand.keypoints[LM.wrist].y / frame.height : undefined);
  return { t, height, heightOn: torso === undefined ? 'image' : 'torso', palmUp: palmUp(hand, frame) };
}
