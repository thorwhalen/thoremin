/**
 * `face-expression` node — classifies the 52 MediaPipe/ARKit blendshapes of a
 * {@link FaceFrame} into a softmax distribution over the seven canonical
 * expressions (happy / sad / angry / surprised / fearful / disgusted / neutral),
 * the sibling of `face-features`. It uses {@link blendshapesToExpression} (cosine
 * similarity to FACS-grounded prototypes) — no extra model, no extra bytes — and
 * adds temporal stability the raw frame lacks:
 *
 *  - **per-class EMA smoothing** of the softmax (the simplex is preserved, since
 *    a convex blend of probability vectors is still a probability vector), so the
 *    distribution eases rather than jumps;
 *  - **argmax margin-hold hysteresis**, so the winning expression (which drives
 *    the chord in `expression-chord`) only switches when a challenger leads by a
 *    margin — preventing chord chatter at decision boundaries.
 *
 * Pure + Node-safe (no DOM/MediaPipe): the live `webcam-face` node feeds it the
 * same `{ present, blendshapes }` frames the offline fixture replays.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { FaceFrame } from '../domain';
import {
  EXPRESSIONS,
  ABSENT_EXPRESSION,
  blendshapesToExpression,
  type ExpressionScores,
} from '@/music/expression';

const NEUTRAL_INDEX = EXPRESSIONS.indexOf('neutral');

const Params = z.object({
  /** Per-class EMA smoothing 0..1 (0 = instant, higher = smoother/slower). */
  smoothing: z.number().min(0).max(0.999).default(0.4),
  /** Softmax temperature; lower = sharper distribution. */
  temperature: z.number().min(0.01).max(2).default(0.12),
  /** A challenger must lead the held expression by this probability margin
   *  before the argmax switches (hysteresis against chord flicker). */
  holdMargin: z.number().min(0).max(1).default(0.06),
});
type Params = z.infer<typeof Params>;

/** Rest distribution: certain neutral. */
const restProbs = (): number[] => EXPRESSIONS.map((l) => (l === 'neutral' ? 1 : 0));

export const faceExpressionNode = defineNode<Params>({
  type: 'face-expression',
  roles: ['feature'],
  title: 'Face Expression',
  description:
    'Face blendshapes → softmax over 7 expressions (happy/sad/angry/surprised/fearful/disgusted/neutral) with smoothing + hysteresis.',
  inputs: [{ name: 'face', kind: 'face-frame' }],
  outputs: [{ name: 'expression', kind: 'face-expression' }],
  params: Params,
  make(p) {
    const smoothed = restProbs();
    let held = NEUTRAL_INDEX;

    const ema = (targets: number[]) => {
      for (let i = 0; i < smoothed.length; i++) {
        smoothed[i] = smoothed[i] + (1 - p.smoothing) * (targets[i] - smoothed[i]);
      }
    };

    return {
      process(inputs) {
        const face = inputs.face as FaceFrame | undefined;
        if (!face || !face.present) {
          // Decay toward rest so a lost face relaxes to neutral rather than
          // freezing the last chord, and report absent.
          ema(restProbs());
          held = NEUTRAL_INDEX;
          return { expression: { ...ABSENT_EXPRESSION } };
        }

        const raw = blendshapesToExpression(face.blendshapes, { temperature: p.temperature });
        ema(raw.probs);

        // Argmax of the SMOOTHED distribution, with margin-hold hysteresis.
        let argmax = 0;
        for (let i = 1; i < smoothed.length; i++) if (smoothed[i] > smoothed[argmax]) argmax = i;
        if (argmax !== held && smoothed[argmax] - smoothed[held] < p.holdMargin) argmax = held;
        held = argmax;

        const probs = [...smoothed];
        const out: ExpressionScores = {
          present: true,
          probs,
          label: EXPRESSIONS[argmax],
          confidence: probs[argmax],
        };
        return { expression: out };
      },
    };
  },
});
