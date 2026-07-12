/**
 * `face-features` node — turns a {@link FaceFrame} (52 MediaPipe blendshapes)
 * into a small set of normalized expression controls (smile, mouthOpen,
 * browRaise, browFurrow, eyeBlink), each 0..1, with optional gain + smoothing.
 *
 * The face analogue of `hand-features`: pure and deterministic, so it is the
 * first face edge we record and test from a replay (e.g. the
 * `video_face_expressions` fixture). These controls are the *direct* facial
 * mapping surface — e.g. smile→brightness, mouthOpen→amplitude — wired in the
 * mapping layer. The browser `webcam-face` node produces the input.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { clamp01 } from '@/features/math';
import { ABSENT_FACE, type FaceFeatures, type FaceFrame } from '../domain';

const Params = z.object({
  /** Global multiplier applied to each control before clamping (expressiveness). */
  gain: z.number().min(0).default(1),
  /** Exponential smoothing 0..1 per tick (0 = instant, higher = smoother/slower). */
  smoothing: z.number().min(0).max(0.999).default(0),
});
type Params = z.infer<typeof Params>;

export const faceFeaturesNode = defineNode<Params>({
  type: 'face-features',
  roles: ['feature'],
  title: 'Face Features',
  description: 'Face blendshapes → normalized expression controls (smile, mouthOpen, brow, blink).',
  inputs: [{ name: 'face', kind: 'face-frame' }],
  outputs: [{ name: 'features', kind: 'face-features' }],
  params: Params,
  make(p) {
    // Smoothed state per control, so expressions ease rather than jump.
    const prev: Record<keyof Omit<FaceFeatures, 'present'>, number> = {
      smile: 0,
      mouthOpen: 0,
      browRaise: 0,
      browFurrow: 0,
      eyeBlink: 0,
    };

    return {
      process(inputs) {
        const face = inputs.face as FaceFrame | undefined;
        if (!face || !face.present) {
          // Decay toward rest so a lost face doesn't freeze the last expression.
          for (const k of Object.keys(prev) as (keyof typeof prev)[]) {
            prev[k] = p.smoothing * prev[k];
          }
          return { features: { ...ABSENT_FACE } };
        }

        const bs = (name: string): number => face.blendshapes[name] ?? 0;
        const avg = (...xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

        const targets: Record<keyof typeof prev, number> = {
          smile: avg(bs('mouthSmileLeft'), bs('mouthSmileRight')),
          mouthOpen: bs('jawOpen'),
          browRaise: avg(bs('browInnerUp'), bs('browOuterUpLeft'), bs('browOuterUpRight')),
          browFurrow: avg(bs('browDownLeft'), bs('browDownRight')),
          eyeBlink: avg(bs('eyeBlinkLeft'), bs('eyeBlinkRight')),
        };

        const out: FaceFeatures = { ...ABSENT_FACE, present: true };
        for (const k of Object.keys(targets) as (keyof typeof prev)[]) {
          const target = clamp01(targets[k] * p.gain);
          prev[k] = prev[k] + (1 - p.smoothing) * (target - prev[k]);
          out[k] = prev[k];
        }
        return { features: out };
      },
    };
  },
});
