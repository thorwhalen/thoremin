/**
 * The hand's app half of the carve modality (#385 E8): "Your hand shapes". A still is cropped to
 * the hand: the box around the wrist and the five fingertips (the positions the projected vector
 * keeps: `wrist.x`, `index.tip.y`, ...), made square and widened by a margin, so a hand far from
 * the camera fills its still as one close to it does. A skeleton (the wrist to each fingertip,
 * through the palm's centre) is drawn over it as it is taken, so the picture shows what the
 * camera read as well as what it saw.
 *
 * Positions are read as the live `hand-feature-vector` node writes them: x MIRRORED for the
 * selfie view (`mirrorX`, its default). The still is cropped from the unmirrored video and then
 * mirrored, so x is un-mirrored here.
 *
 * A hand categorizer is played through the category bindings (a command per category); the
 * degree renderer and the air guitar's vocabulary are follow-ups (#385).
 */
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { CarveModalityUi, PixelBox, PixelPoint } from '@thoremin/sdk-ui/enroll/modality';

export const HAND_CROP = {
  /** Margin around the wrist-and-fingertips box, as a share of its longer side, on each side. */
  margin: 0.2,
  /** The positions are mirrored in x (the live node's default). */
  mirrored: true,
} as const;

const TIPS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

/** A position of the projected vector in video pixels, or null when it is not finite. */
function at(vector: FeatureVector, key: string, width: number, height: number, mirrored: boolean): PixelPoint | null {
  const x = vector[`${key}.x`];
  const y = vector[`${key}.y`];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: (mirrored ? 1 - x : x) * width, y: y * height };
}

/** The hand box in video pixels, or null when the vector does not place the hand. */
export function handRegion({ vector, width, height }: { vector: FeatureVector; width: number; height: number }, crop: { margin: number; mirrored: boolean } = HAND_CROP): PixelBox | null {
  if (!(width > 0) || !(height > 0)) return null;
  const pts = ['wrist', ...TIPS.map((t) => `${t}.tip`)].map((k) => at(vector, k, width, height, crop.mirrored)).filter((p): p is PixelPoint => p !== null);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const side = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0);
  if (!(side > 0)) return null;
  const full = side * (1 + 2 * crop.margin);
  const cx = (x0 + Math.max(...xs)) / 2;
  const cy = (y0 + Math.max(...ys)) / 2;
  return { x: cx - full / 2, y: cy - full / 2, w: full, h: full };
}

/** The skeleton in video pixels: the wrist through the palm's centre to each fingertip. */
export function handSkeleton({ vector, width, height }: { vector: FeatureVector; width: number; height: number }, mirrored: boolean = HAND_CROP.mirrored): PixelPoint[][] | null {
  const wrist = at(vector, 'wrist', width, height, mirrored);
  if (!wrist) return null;
  const palm = at(vector, 'palm', width, height, mirrored);
  const lines: PixelPoint[][] = [];
  for (const t of TIPS) {
    const tip = at(vector, `${t}.tip`, width, height, mirrored);
    if (tip) lines.push(palm && t !== 'thumb' ? [wrist, palm, tip] : [wrist, tip]);
  }
  return lines.length > 0 ? lines : null;
}

export const handModalityUi: CarveModalityUi = {
  modality: handModality,
  region: (live) => handRegion(live),
  overlay: (live) => handSkeleton(live),
  targets: [{ kind: 'command', id: 'category-binding', label: 'a command per category (the Gestures tool)' }],
};
