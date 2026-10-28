/**
 * A hand built for the physical theremin's tests: an adult-sized hand in metres (world landmarks)
 * projected into an image at a chosen place and scale, with each finger's curl and the palm's yaw
 * set by hand. The synthetic source's hand (`makeHandKeypoints`) keeps its fingers straight, so
 * it cannot show a finger opening; this one bends each finger at its three joints toward the palm.
 */
import type { Hand, Handedness, Keypoint } from '@thoremin/sdk/nodes/domain';

export interface TestHandSpec {
  /** The wrist-to-knuckles centre in image pixels. */
  cx: number;
  cy: number;
  /** Image pixels per metre at the hand. */
  pxPerM: number;
  /** Per finger curl, 0 straight .. 1 fully curled (thumb, index, middle, ring, pinky). */
  curl?: Partial<Record<'thumb' | 'index' | 'middle' | 'ring' | 'pinky', number>>;
  /** The palm's turn about the vertical axis, radians: 0 faces the camera, pi/2 faces sideways. */
  yaw?: number;
  /** The palm's tilt about the horizontal axis, radians: pi/2 faces down. */
  pitch?: number;
  handedness?: Handedness;
}

type V = [number, number, number];
const FINGERS = [
  { name: 'index', base: [-0.034, -0.045, 0] as V, lengths: [0.045, 0.026, 0.021] },
  { name: 'middle', base: [-0.011, -0.047, 0] as V, lengths: [0.049, 0.029, 0.023] },
  { name: 'ring', base: [0.011, -0.045, 0] as V, lengths: [0.045, 0.027, 0.022] },
  { name: 'pinky', base: [0.031, -0.04, 0] as V, lengths: [0.035, 0.02, 0.019] },
] as const;

/** Rotate a point by yaw (about y) then pitch (about x). */
function orient([x, y, z]: V, yaw: number, pitch: number): V {
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
  return [x1, y2, z2];
}

/** A finger chain from its base: three segments, each bent `curl * 85` degrees more toward the palm (-z). */
function chain(base: V, lengths: readonly number[], curl: number, dir0: V): V[] {
  const out: V[] = [base];
  const theta = curl * (85 * Math.PI) / 180;
  let p = base;
  for (let k = 0; k < lengths.length; k++) {
    const a = (k + 1) * theta;
    // Bend the initial direction toward -z by angle a, in the plane of dir0 and z.
    const d: V = [dir0[0] * Math.cos(a), dir0[1] * Math.cos(a), -Math.sin(a)];
    p = [p[0] + d[0] * lengths[k], p[1] + d[1] * lengths[k], p[2] + d[2] * lengths[k]];
    out.push(p);
  }
  return out;
}

export function testHand(spec: TestHandSpec): Hand {
  const curl = spec.curl ?? {};
  const world: V[] = new Array(21);
  world[0] = [0, 0.045, 0];
  const thumb = chain([-0.03, 0.025, 0], [0.035, 0.03, 0.025], curl.thumb ?? 0, [-Math.SQRT1_2, -Math.SQRT1_2, 0]);
  for (let i = 0; i < 4; i++) world[1 + i] = thumb[i];
  FINGERS.forEach((f, i) => {
    const pts = chain(f.base, f.lengths, curl[f.name] ?? 0, [0, -1, 0]);
    for (let j = 0; j < 4; j++) world[5 + 4 * i + j] = pts[j];
  });
  const oriented = world.map((p) => orient(p, spec.yaw ?? 0, spec.pitch ?? 0));
  const worldKeypoints: Keypoint[] = oriented.map(([x, y, z]) => ({ x, y, z }));
  const keypoints: Keypoint[] = oriented.map(([x, y, z]) => ({ x: spec.cx + x * spec.pxPerM, y: spec.cy + y * spec.pxPerM, z }));
  return { handedness: spec.handedness ?? 'Left', keypoints, worldKeypoints, score: 1 };
}
