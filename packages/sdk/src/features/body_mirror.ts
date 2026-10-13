/**
 * The body's left/right mirror map (#381, body-movement B1): for every body feature, the
 * feature it becomes when the player is reflected left to right, and how its value
 * changes. With it a pose categorizer can store each sample twice, so "left arm up" and
 * "right arm up" are one category when the player asks for that (#387 B10: distinct by
 * default, a per-categorizer toggle; storing the toggle is the body modality's, B2).
 *
 * Three rules cover the catalog, and a test checks the map against a skeleton actually
 * reflected and relabelled:
 *
 *  - **Swap sides.** An id with a `left` or `right` segment (`body.angle.elbow.left`,
 *    `body.dir.forearm.right.out`) maps to its twin; `leaningLeft` and `leaningRight`
 *    swap too. The segment directions measure `out` away from the midline on each side,
 *    so they need nothing else.
 *  - **Negate** the signed lateral quantities: torso lean, head tilt, sway.
 *  - **Complement** (1 - x) the horizontal frame positions, which run 0..1 across the
 *    frame: a mirrored player stands at the mirrored place.
 *
 * Everything else (speeds, effort, extension, `handsCrossed`, the pulse) is symmetric
 * and maps to itself.
 */
import type { FeatureVector } from './types';
import { BODY_FEATURES } from './body_catalog';

/** How a value changes under the mirror. */
export type MirrorFlip = 'none' | 'negate' | 'complement';

export interface MirrorEntry {
  /** The feature this one becomes. */
  to: string;
  flip: MirrorFlip;
}

const NEGATE: ReadonlySet<string> = new Set(['body.angle.torso.lean', 'body.angle.head.tilt', 'body.shape.sway']);

const SWAP: Readonly<Record<string, string>> = { left: 'right', right: 'left', leaningLeft: 'leaningRight', leaningRight: 'leaningLeft' };

function mirrorId(id: string): string {
  return id.split('.').map((part) => SWAP[part] ?? part).join('.');
}

/** A horizontal frame position (0..1 across the frame): the `.x` positions and the centre
 *  of mass's x. */
function isFrameX(id: string): boolean {
  return (id.startsWith('body.pos.') || id.startsWith('body.shape.com.')) && id.endsWith('.x');
}

function flipOf(id: string): MirrorFlip {
  if (NEGATE.has(id)) return 'negate';
  if (isFrameX(id)) return 'complement';
  return 'none';
}

/** The mirror map over the whole body catalog, keyed by feature id. */
export const BODY_MIRROR: Readonly<Record<string, MirrorEntry>> = Object.fromEntries(
  BODY_FEATURES.map((f) => [f.id, { to: mirrorId(f.id), flip: flipOf(f.id) }]),
);

function applyFlip(v: number, flip: MirrorFlip): number {
  if (flip === 'negate') return -v;
  if (flip === 'complement') return 1 - v;
  return v;
}

/** The vector of the mirrored player. Keys outside the body catalog pass through unchanged. */
export function mirrorBodyVector(vector: FeatureVector): FeatureVector {
  const out: FeatureVector = {};
  for (const [id, v] of Object.entries(vector)) {
    const m = BODY_MIRROR[id];
    if (m) out[m.to] = applyFlip(v, m.flip);
    else out[id] = v;
  }
  return out;
}
