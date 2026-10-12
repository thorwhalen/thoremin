/**
 * The hand as a classifier sees it: 21 MediaPipe landmarks made independent of where the
 * hand is, how big it looks and which hand it is. MUST stay identical to the training
 * featurisation (`scripts/asl/asl_common.py`), or the weights mean nothing; the fixture
 * test in `test/asl/` pins the two together.
 *
 * The shipped model reads {@link geoFeatures} (angles, distances, orientation), which
 * generalised best across corpora. Two older views remain for comparison and research:
 * - `world`: MediaPipe's metric 3D landmarks, wrist-relative, divided by the wrist to
 *   middle-knuckle length (so a child's hand and an adult's match).
 * - `image`: the pixel landmarks (z scaled like x), wrist-relative, divided by the same
 *   bone's 2D length. It keeps what the world view blurs: how the hand is turned to the
 *   camera, which is what tells H from U and P from K.
 *
 * A left hand is mirrored (x negated) so one model serves both hands: a fingerspeller may
 * sign with either, and the letters are mirror images of each other.
 */

export interface Point3 {
  x: number;
  y: number;
  z?: number;
}

/** One detected hand, in the shape thoremin's (and MediaPipe's) hand frames carry. */
export interface HandInput {
  handedness: 'Left' | 'Right';
  /** 21 landmarks in pixels (z as MediaPipe gives it: relative depth, in units of image width). */
  keypoints: readonly Point3[];
  /** 21 landmarks in metres, hand-centred. */
  worldKeypoints?: readonly Point3[];
}

export type FeatureKind = 'world' | 'image' | 'both' | 'geo' | 'geo+image';

/** Landmark indices used here (MediaPipe's 21-point hand). */
export const WRIST = 0;
export const MIDDLE_MCP = 9;
export const LANDMARKS = 21;

function canon(points: readonly Point3[], zScale: number, mirror: boolean, planarScale: boolean): number[] {
  const w = points[WRIST]!;
  const m = points[MIDDLE_MCP]!;
  const dx = m.x - w.x;
  const dy = m.y - w.y;
  const dz = ((m.z ?? 0) - (w.z ?? 0)) * zScale;
  const len = planarScale ? Math.hypot(dx, dy) : Math.hypot(dx, dy, dz);
  const s = len > 0 ? len : 1;
  const out: number[] = [];
  for (let i = 0; i < LANDMARKS; i++) {
    const p = points[i]!;
    const x = (p.x - w.x) / s;
    out.push(mirror ? -x : x, (p.y - w.y) / s, (((p.z ?? 0) - (w.z ?? 0)) * zScale) / s);
  }
  return out;
}

/** The world view (63 numbers), or null when the hand has no world landmarks. */
export function worldFeatures(hand: HandInput): number[] | null {
  const wk = hand.worldKeypoints;
  if (!wk || wk.length < LANDMARKS) return null;
  return canon(wk, 1, hand.handedness === 'Left', false);
}

/** The image view (63 numbers). `width` scales MediaPipe's z into pixels like x. */
export function imageFeatures(hand: HandInput, width: number): number[] | null {
  if (hand.keypoints.length < LANDMARKS) return null;
  return canon(hand.keypoints, width, hand.handedness === 'Left', true);
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const n = norm(a);
  return n > 1e-9 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const FINGERS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]] as const;
const TIPS = [4, 8, 12, 16, 20] as const;

/**
 * The geometric view (66 numbers), the shipped model's input: what the hand's SHAPE is,
 * nearly independent of who signs, the camera and the corpus. From the image landmarks as
 * 3D pixels (z scaled like x), mirrored for a left hand, wrist-relative and divided by the
 * wrist to middle-knuckle length:
 *  - each finger's flexion: the cosine at its three inner joints (15);
 *  - the spread between adjacent fingers, and of the thumb against the index (4);
 *  - the fingertips' pairwise distances (10), their distance to the wrist (5), and the
 *    thumb tip's distance to eight knuckles (8): what tells M from N from S from T;
 *  - how the hand is turned to the camera: the palm's up, across and normal directions (9)
 *    and each finger's pointing direction (15): what tells H from U, P from K, G from Q.
 * Mirrors `geo_features` in `scripts/asl/asl_common.py`.
 */
export function geoFeatures(hand: HandInput, width: number): number[] | null {
  const k = hand.keypoints;
  if (k.length < LANDMARKS) return null;
  const mirror = hand.handedness === 'Left' ? -1 : 1;
  const raw: V3[] = k.slice(0, LANDMARKS).map((p) => [p.x * mirror, p.y, (p.z ?? 0) * width]);
  const w = raw[0]!;
  const rel = raw.map((p) => sub(p, w));
  const s = norm(rel[MIDDLE_MCP]!) || 1;
  const P = rel.map((p): V3 => [p[0] / s, p[1] / s, p[2] / s]);
  const f: number[] = [];
  for (const ch of FINGERS) {
    for (let j = 1; j < 4; j++) f.push(dot(unit(sub(P[ch[j]!]!, P[ch[j - 1]!]!)), unit(sub(P[ch[j + 1]!]!, P[ch[j]!]!))));
  }
  for (const [a, b] of [[1, 2], [2, 3], [3, 4]] as const) {
    f.push(dot(unit(sub(P[FINGERS[a][2]]!, P[FINGERS[a][1]]!)), unit(sub(P[FINGERS[b][2]]!, P[FINGERS[b][1]]!))));
  }
  f.push(dot(unit(sub(P[3]!, P[2]!)), unit(sub(P[6]!, P[5]!))));
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) f.push(norm(sub(P[TIPS[i]!]!, P[TIPS[j]!]!)));
  for (const t of TIPS) f.push(norm(P[t]!));
  for (const kk of [5, 6, 9, 10, 13, 14, 17, 18]) f.push(norm(sub(P[4]!, P[kk]!)));
  const up = unit(P[9]!);
  const across = unit(sub(P[5]!, P[17]!));
  const normal = unit(cross(P[5]!, P[17]!));
  f.push(...up, ...across, ...normal);
  for (const t of TIPS) f.push(...unit(sub(P[t]!, P[t - 3]!)));
  return f;
}

/** The feature vector of `kind`, or null when the hand lacks what that kind needs. */
export function handFeatures(hand: HandInput, width: number, kind: FeatureKind = 'geo'): number[] | null {
  if (kind === 'geo') return geoFeatures(hand, width);
  if (kind === 'geo+image') {
    const g = geoFeatures(hand, width);
    const i = imageFeatures(hand, width);
    return g && i ? [...g, ...i] : null;
  }
  if (kind === 'world') return worldFeatures(hand);
  if (kind === 'image') return imageFeatures(hand, width);
  const a = worldFeatures(hand);
  const b = imageFeatures(hand, width);
  return a && b ? [...a, ...b] : null;
}
