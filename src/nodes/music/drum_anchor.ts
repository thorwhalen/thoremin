/**
 * The point on a hand that an air drum tracks (#246): the one definition of "where the
 * stick is" shared by the live `air-drum` node and the offline drum scorer
 * (`scripts/air/lib_drum_strokes.ts`), so a number in the research doc and the sound the
 * player hears come from the same point.
 *
 * Why not the wrist. On real drum footage the pose wrists catch about half the hits a
 * drummer plays (`docs/research/air-instruments.md` §7.3): a roll is played from the
 * fingers and the rebound, the stick tip travels and the wrist barely moves. What the
 * wrist misses is a ROTATION of the hand, and the hand landmarks see that rotation: the
 * line from the heel of the hand to the thumb-index fulcrum is the stick's own axis in a
 * matched grip. So the stick tip is estimated as that line extended past the fulcrum,
 *
 *     tip = fulcrum + length * (fulcrum - heel),
 *
 * with `length` in GRIP LENGTHS (the heel-to-fulcrum distance). Scaling the hand's own
 * segment rather than a unit vector is what keeps the estimate honest under
 * foreshortening: a stick pointing at the camera and the grip segment along it shrink by
 * the same factor in the image (a collinear projection preserves ratios), so the tip
 * comes in toward the hand exactly as the real tip would. A player with no stick gets the
 * same lever: a virtual stick that turns a small wrist flick into a stroke-sized
 * movement, which is what makes a finger-and-wrist stroke detectable at all. The timing
 * of a pure rotation does not depend on `length` at all (any lever turns where the
 * rotation turns); the length only sets how far the tip travels.
 *
 * The lever amplifies EVERYTHING the hand does, not only strokes: a pinch or an opening
 * hand tilts the grip line, and landmark jitter shakes it. So the stick tip's stroke
 * gates are counted in the stick's REACH ({@link stickReach}: the hand's own size in the
 * image times the lever), not in frame heights: {@link STICK_MIN_STROKE_REACH} and
 * {@link STICK_MIN_SPEED_REACH}. On the committed recordings at the default length, the
 * gestures that are not strokes (pinching, opening, sweeping, two hands moving) move the
 * tip at most 0.35 reach at 1 reach per second, and every stroke (conducting beats, the
 * synthetic wrist strokes, the softest of them included) at least 0.55 at 8, whatever
 * the hand's size in the frame (a hand close to the camera and one far from it differ by
 * a factor of ten in pixels and not at all in reaches). A gate in
 * frame heights cannot tell those apart: scaled up it silences a player standing back,
 * left at the wrist's value it drums on a pinch close to the camera
 * (`test/subframe/drum_anchor.test.ts` pins both sides).
 *
 * Pure: keypoints in, a point out, in the keypoints' own units.
 */
import { LM, type Keypoint } from '../domain';

/** The tracked points an air drum can follow. `wrist` and `indexTip` are single
 *  landmarks; `stickTip` is the estimate above. */
export const DRUM_ANCHOR_POINTS = ['wrist', 'indexTip', 'stickTip'] as const;
export type DrumAnchorPoint = (typeof DRUM_ANCHOR_POINTS)[number];

/** Default virtual-stick length past the fulcrum, in grip lengths. A 40 cm stick held a
 *  third of the way from its butt reaches about four grip lengths past the fulcrum; three
 *  keeps the tip in frame for a player close to the camera. */
export const DEFAULT_STICK_LENGTH = 3;

type Point = { x: number; y: number };

const mean = (ps: readonly Keypoint[]): Point => ({
  x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
  y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
});

/** The stick's fulcrum in a matched grip: between the thumb's pad and the index finger's
 *  middle joint. */
export function gripFulcrum(kp: readonly Keypoint[]): Point {
  return mean([kp[LM.thumb_ip], kp[LM.thumb_tip], kp[LM.index_pip]]);
}

/** The heel of the hand, where the stick's butt leaves the palm: between the wrist and
 *  the pinky's knuckle. */
export function gripHeel(kp: readonly Keypoint[]): Point {
  return mean([kp[LM.wrist], kp[LM.pinky_mcp]]);
}

/** The estimated stick tip: the heel-to-fulcrum line extended `length` grip lengths past
 *  the fulcrum. */
export function stickTip(kp: readonly Keypoint[], length: number = DEFAULT_STICK_LENGTH): Point {
  const f = gripFulcrum(kp);
  const h = gripHeel(kp);
  return { x: f.x + length * (f.x - h.x), y: f.y + length * (f.y - h.y) };
}

/** The stick tip's smallest stroke at the default `minStroke` dial (which scales it in
 *  proportion), in REACHES: the stick's length from the heel of the hand, `1 + length`
 *  grip lengths. A tip travel counted in reaches is, near enough, the hand's rotation in
 *  radians, so it does not change with the stick's length or the hand's size. */
export const STICK_MIN_STROKE_REACH = 0.45;
/** The stick tip's slowest stroke at the default `minSpeed` dial, reaches per second. */
export const STICK_MIN_SPEED_REACH = 2.5;

/** One reach, in the keypoints' units: `(1 + stickLength)` grip lengths. */
export function stickReach(kp: readonly Keypoint[], stickLength: number = DEFAULT_STICK_LENGTH): number {
  return (1 + stickLength) * gripLength(kp);
}

/** The grip length in the image: heel of the hand to the fulcrum, in the keypoints' units. */
export function gripLength(kp: readonly Keypoint[]): number {
  const f = gripFulcrum(kp);
  const h = gripHeel(kp);
  return Math.hypot(f.x - h.x, f.y - h.y);
}

/** Whether a point's stroke gates are counted in grip lengths (a lever) or frame heights. */
export function gatesInGrips(point: DrumAnchorPoint): boolean {
  return point === 'stickTip';
}

/** The tracked point of a 21-landmark hand, or `undefined` when a landmark it needs is
 *  missing. */
export function anchorPoint(kp: readonly Keypoint[], point: DrumAnchorPoint, o: { stickLength?: number } = {}): Point | undefined {
  if (kp.length < 21) return point === 'wrist' && kp[LM.wrist] ? { x: kp[LM.wrist].x, y: kp[LM.wrist].y } : undefined;
  switch (point) {
    case 'wrist':
      return { x: kp[LM.wrist].x, y: kp[LM.wrist].y };
    case 'indexTip':
      return { x: kp[LM.index_tip].x, y: kp[LM.index_tip].y };
    case 'stickTip':
      return stickTip(kp, o.stickLength ?? DEFAULT_STICK_LENGTH);
  }
}
