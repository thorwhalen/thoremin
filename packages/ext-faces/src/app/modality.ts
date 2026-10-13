/**
 * The face's app half of the carve modality (#385 E1): the one place the tool says which
 * modality it carves. A still is cropped to the face (#385 E3): a box around the nose tip
 * (`face.head.x`, `face.head.y`, normalised) sized by the outer-eye span (`face.head.scale`,
 * normalised to the frame's width), so a face far from the camera fills the still as one
 * close to it does. A face categorizer is played by the instrument's `faceCategorizer` dial.
 */
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { CarveModalityUi, PixelBox } from '@thoremin/sdk-ui/enroll/modality';

export const FACE_CROP = {
  /** The box's side in outer-eye spans: the face is about two and a half spans wide and tall
   *  with the forehead and chin, a little more keeps the jaw in. */
  sideSpans: 2.8,
  /** How far the box's centre sits above the nose tip, as a share of the side (the nose is
   *  below the middle of a face). */
  raise: 0.08,
} as const;

/** The face box in video pixels, or null when the vector does not place the face. */
export function faceRegion({ vector, width, height }: { vector: FeatureVector; width: number; height: number }, crop: { sideSpans: number; raise: number } = FACE_CROP): PixelBox | null {
  const x = vector['face.head.x'];
  const y = vector['face.head.y'];
  const span = vector['face.head.scale'];
  if (![x, y, span, width, height].every(Number.isFinite) || !(span > 0) || !(width > 0) || !(height > 0)) return null;
  const side = crop.sideSpans * span * width;
  return { x: x * width - side / 2, y: y * height - side / 2 - crop.raise * side, w: side, h: side };
}

export const faceModalityUi: CarveModalityUi = {
  modality: faceModality,
  region: (live) => faceRegion(live),
  targets: [{ kind: 'dial', id: 'faceCategorizer', label: "the instrument's Face categorizer" }],
};
