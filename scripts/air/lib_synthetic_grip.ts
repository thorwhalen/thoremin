/**
 * A synthetic drummer's hand gripping a synthetic stick (#246): 21 MediaPipe-layout
 * landmarks posed rigidly on an `an.impacts` stick, so the air drum's anchor points (the
 * wrist, the index fingertip, the estimated stick tip of `packages/sdk/src/nodes/music/drum_anchor.ts`)
 * can be scored against the clip's ground-truth impacts.
 *
 * The geometry. An `an.impacts` stick rotates about a fixed `pivot` (its butt, "the
 * hand") toward its `tip`. The hand is placed so the wrist JOINT sits on that pivot
 * (the wrist landmark a third of a grip length across the axis from it, so it barely
 * moves): the stroke is a pure wrist stroke, the hand and stick turning together about the wrist
 * joint, which is the case §7.3 of `docs/research/air-instruments.md` says the pose
 * wrist cannot see. Arm participation is added on top: the whole hand and stick
 * translate by `arm` times the tip's displacement from its rest position, so `arm = 0`
 * is a pure wrist stroke and a large `arm` approaches the whole-arm air drummer, whose
 * wrist carries the stroke. Scaling the tip's trajectory about its rest point keeps its
 * turning times, so the clip's truth stays the truth at every `arm`.
 *
 * The hand is a fixed matched-grip layout in the stick's frame, in GRIP LENGTHS (the
 * heel-to-fulcrum distance the stick-tip estimate scales), with the fulcrum at the
 * origin and the heel one grip length behind it on the stick's axis, so the estimate is
 * exact at `stickLength = TRUE_STICK_LENGTH` and zero noise. Landmark noise is seeded
 * Gaussian, in grip lengths.
 *
 * Self-made data only (this file is the whole provenance), safe to commit.
 */
import type { HandsFrame, Keypoint } from '@thoremin/sdk/nodes/domain';

/** The stick's reach past the fulcrum, in grip lengths, in this synthetic grip. */
export const TRUE_STICK_LENGTH = 4;

/** Matched-grip landmark layout, (along the stick, across it), grip lengths, origin at the
 *  fulcrum. The mean of the thumb IP, thumb tip and index PIP is the origin; the mean of
 *  the wrist and the pinky MCP is (-1, 0). */
const GRIP: readonly (readonly [number, number])[] = [
  [-1.1, 0.35], // 0 wrist
  [-0.8, 0.45], // 1 thumb cmc
  [-0.45, 0.4], // 2 thumb mcp
  [-0.15, 0.25], // 3 thumb ip
  [0.1, 0.15], // 4 thumb tip
  [-0.35, -0.25], // 5 index mcp
  [0.05, -0.4], // 6 index pip
  [-0.05, -0.6], // 7 index dip
  [-0.25, -0.65], // 8 index tip
  [-0.5, -0.35], // 9 middle mcp
  [-0.2, -0.6], // 10
  [-0.35, -0.8], // 11
  [-0.55, -0.75], // 12 middle tip
  [-0.65, -0.4], // 13 ring mcp
  [-0.4, -0.65], // 14
  [-0.55, -0.8], // 15
  [-0.7, -0.75], // 16 ring tip
  [-0.9, -0.35], // 17 pinky mcp
  [-0.7, -0.6], // 18
  [-0.8, -0.7], // 19
  [-0.9, -0.65], // 20 pinky tip
];

/** One `an.impacts` frame's stick: its butt (the pivot) and tip, pixels. */
export interface StickPose {
  t: number;
  width: number;
  height: number;
  pivot: { x: number; y: number };
  tip: { x: number; y: number };
}

export interface GripOptions {
  /** Arm participation: the hand translates by this times the tip's displacement from
   *  its rest (first-frame) position. 0 = a pure wrist stroke. Default 0. */
  arm?: number;
  /** Landmark noise, standard deviation in grip lengths. Default 0. */
  noise?: number;
  /** Noise seed. Default 1. */
  seed?: number;
  /** MediaPipe's label for the hand (the mirrored webcam labels the player's right hand
   *  'Left'). Default 'Left'. */
  handedness?: 'Left' | 'Right';
}

/** mulberry32 + Box-Muller: a small seeded Gaussian. */
function gaussian(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

/** The gripping hand on every frame of a stick clip, as the air drum's input. */
export function gripFrames(poses: readonly StickPose[], o: GripOptions = {}): HandsFrame[] {
  const { arm = 0, noise = 0, seed = 1, handedness = 'Left' } = o;
  if (poses.length === 0) return [];
  const rest = poses[0].tip;
  const rand = gaussian(seed);
  return poses.map((p) => {
    const dx = p.tip.x - p.pivot.x;
    const dy = p.tip.y - p.pivot.y;
    const len = Math.hypot(dx, dy);
    const u = { x: dx / len, y: dy / len };
    const n = { x: -u.y, y: u.x };
    // The wrist joint sits on the pivot, the tip on the stick's tip: 1.1 grip lengths
    // from the wrist to the fulcrum along the axis, then TRUE_STICK_LENGTH to the tip.
    const g = len / (-GRIP[0][0] + TRUE_STICK_LENGTH);
    const shift = { x: arm * (p.tip.x - rest.x), y: arm * (p.tip.y - rest.y) };
    const fx = p.pivot.x - GRIP[0][0] * g * u.x + shift.x;
    const fy = p.pivot.y - GRIP[0][0] * g * u.y + shift.y;
    const keypoints: Keypoint[] = GRIP.map(([a, b]) => ({
      x: fx + g * (a * u.x + b * n.x) + noise * g * rand(),
      y: fy + g * (a * u.y + b * n.y) + noise * g * rand(),
    }));
    return { width: p.width, height: p.height, hands: [{ handedness, keypoints }] };
  });
}

/** Parse an `an.impacts` `keypoints.ndjson` (the stick object's pivot and tip). */
export function parseStickClip(ndjson: string, object = 'stick'): StickPose[] {
  const out: StickPose[] = [];
  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as { t: number; value: { width: number; height: number; keypoints: { object: string; name: string; x: number; y: number }[] } };
    const k = (name: string) => rec.value.keypoints.find((p) => p.object === object && p.name === name);
    const pivot = k('pivot');
    const tip = k('tip');
    if (!pivot || !tip) continue;
    out.push({ t: rec.t, width: rec.value.width, height: rec.value.height, pivot: { x: pivot.x, y: pivot.y }, tip: { x: tip.x, y: tip.y } });
  }
  return out;
}
