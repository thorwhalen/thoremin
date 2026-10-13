/**
 * The face's words point the right way (#385 E6): a hint says "wrinkle your nose MORE" only if the
 * feature it read grows as the nose wrinkles. The geometry features measure distances in image
 * coordinates, so some read their movement backwards (`invert`); the adversarial review of E6
 * found three listed the wrong way, on the real recording.
 *
 * Checked on `video_face_expressions` (rest, smile, open smile): within each movement, every
 * feature that moves clearly between two segments moves the same way, once its `invert` is
 * applied, as the movement's anchor: its Action Unit where it has one (the mean of the left and
 * right blendshapes, steadier than either side), else its first blendshape. Signed
 * features (pose, asymmetries) are their size either way and are not compared.
 */
import { describe, expect, it } from 'vitest';
import { faceWords } from '@thoremin/sdk/features/modalities/face_words';
import { FACE_FEATURES } from '@thoremin/sdk/features/face_catalog';
import { recordedFrames, SEGMENTS, vectorOf } from '../helpers/faceRecording';

const frames = recordedFrames().map(vectorOf);
const mean = (id: string, [a, b]: readonly [number, number]): number => {
  const xs = frames.slice(a, b + 1).map((v) => v[id]).filter((x) => Number.isFinite(x));
  return xs.reduce((p, x) => p + x, 0) / xs.length;
};
const spread = (id: string): number => {
  const xs = frames.map((v) => v[id]).filter((x) => Number.isFinite(x));
  const m = xs.reduce((p, x) => p + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((p, x) => p + (x - m) ** 2, 0) / xs.length);
};
/** "Moves clearly": by more than this share of the feature's spread over the whole clip. */
const CLEAR = 0.5;

const PAIRS = [
  ['smile', 'rest'],
  ['open', 'rest'],
  ['open', 'smile'],
] as const;

describe('the face words point the right way on a real recording', () => {
  const byMovement = new Map<string, string[]>();
  for (const f of FACE_FEATURES) {
    const w = faceWords(f.id);
    if (!w || w.signed) continue;
    byMovement.set(w.movement!, [...(byMovement.get(w.movement!) ?? []), f.id]);
  }

  it('compares enough: the smile, mouth and cheek movements are all checked', () => {
    for (const m of ['smile', 'mouth-open', 'cheeks-up', 'nose-wrinkled', 'eyes-closed']) expect(byMovement.get(m)!.length).toBeGreaterThan(1);
  });

  for (const [movement, ids] of byMovement) {
    it(`${movement}: every feature that moves clearly agrees with the movement's blendshape`, () => {
      const anchor = ids.find((id) => id.startsWith('face.au.')) ?? ids.find((id) => id.startsWith('face.blendshape.'));
      if (!anchor) return;
      const disagree: string[] = [];
      for (const [a, b] of PAIRS) {
        const da = mean(anchor, SEGMENTS[a]) - mean(anchor, SEGMENTS[b]);
        if (!(Math.abs(da) > CLEAR * spread(anchor))) continue;
        for (const id of ids) {
          const d = (mean(id, SEGMENTS[a]) - mean(id, SEGMENTS[b])) * (faceWords(id)!.invert ? -1 : 1);
          if (Math.abs(d) > CLEAR * spread(id) && Math.sign(d) !== Math.sign(da)) disagree.push(`${id} (${a} - ${b})`);
        }
      }
      expect(disagree).toEqual([]);
    });
  }
});
