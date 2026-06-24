/**
 * `face-expression` node — turns the 52 MediaPipe/ARKit blendshapes of a
 * {@link FaceFrame} into a decided expression (one of six emotions or `neutral`),
 * the sibling of `face-features`. No extra model, no extra bytes: it scores the
 * blendshapes against FACS-grounded prototypes ({@link expressionActivations}) and
 * applies the research-grounded decision + stabilization stack:
 *
 *  - **per-emotion EMA smoothing** of the magnitude-aware activations, so each
 *    emotion's level eases rather than jumps;
 *  - **per-class thresholds** (from the live, user-tunable sensitivities) with
 *    **neutral as the abstention fallback** — if no emotion clears its bar the
 *    decision is `neutral` (the fix for a resting face reading as `angry`);
 *  - **enter/exit hysteresis** (the held label is judged against an easier exit
 *    threshold) plus a small **dwell** (a switch must persist a few frames) so the
 *    expression — which drives the chord in `expression-chord` — does not chatter.
 *
 * Pure + Node-safe (no DOM/MediaPipe): the live `webcam-face` node feeds it the
 * same `{ present, blendshapes }` frames the offline fixture replays. The live
 * per-emotion sensitivities arrive on the optional `sensitivity` input (from the
 * store); absent, the shipped {@link DEFAULT_EXPRESSION_SENSITIVITY} is used.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { FaceFrame } from '../domain';
import {
  EMOTIONS,
  ABSENT_EXPRESSION,
  expressionActivations,
  decideExpression,
  expressionThresholds,
  DEFAULT_EXPRESSION_SENSITIVITY,
  type ExpressionScores,
  type ExpressionSensitivity,
  type Emotion,
  type ExpressionLabel,
} from '@/music/expression';

const Params = z.object({
  /** Per-emotion EMA smoothing 0..1 (0 = instant, higher = smoother/slower). */
  smoothing: z.number().min(0).max(0.999).default(0.4),
  /** A label switch must persist this many frames before it is committed
   *  (dwell/debounce, on top of the per-emotion enter/exit hysteresis). */
  dwellFrames: z.number().int().min(1).max(30).default(2),
});
type Params = z.infer<typeof Params>;

const zeroActivations = (): Record<Emotion, number> =>
  Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Record<Emotion, number>;

export const faceExpressionNode = defineNode<Params>({
  type: 'face-expression',
  roles: ['feature'],
  title: 'Face Expression',
  description:
    'Face blendshapes → one of 6 emotions or neutral (per-class thresholds + neutral abstention, smoothing, enter/exit hysteresis, dwell).',
  inputs: [
    { name: 'face', kind: 'face-frame' },
    // Live per-emotion sensitivities [0,1] (from the store); optional → defaults.
    { name: 'sensitivity', kind: 'expression-sensitivity' },
  ],
  outputs: [{ name: 'expression', kind: 'face-expression' }],
  params: Params,
  make(p) {
    const smoothed = zeroActivations();
    let committed: ExpressionLabel = 'neutral';
    let candidate: ExpressionLabel | null = null;
    let candidateCount = 0;

    /** EMA toward the target activations (target 0 = decay toward rest). */
    const ema = (target: Record<Emotion, number>) => {
      for (const e of EMOTIONS) {
        smoothed[e] = smoothed[e] + (1 - p.smoothing) * ((target[e] ?? 0) - smoothed[e]);
      }
    };

    /** Read the live sensitivities, healing any missing emotion with the default. */
    const sensitivityFrom = (raw: unknown): ExpressionSensitivity => {
      const s = raw as Partial<ExpressionSensitivity> | undefined;
      if (!s) return DEFAULT_EXPRESSION_SENSITIVITY;
      const out = {} as ExpressionSensitivity;
      for (const e of EMOTIONS) {
        out[e] = typeof s[e] === 'number' ? (s[e] as number) : DEFAULT_EXPRESSION_SENSITIVITY[e];
      }
      return out;
    };

    /** Build the output record from the current smoothed state + sensitivities. */
    const toScores = (sensitivity: ExpressionSensitivity): ExpressionScores => {
      const thr = expressionThresholds(sensitivity);
      // `fired` reflects the same hysteresis the committed label uses.
      const decision = decideExpression(smoothed, sensitivity, committed);
      return {
        present: true,
        label: committed,
        scores: EMOTIONS.map((e) => smoothed[e]),
        thresholds: EMOTIONS.map((e) => thr[e]),
        fired: EMOTIONS.map((e) => decision.fired[e]),
      };
    };

    return {
      process(inputs) {
        const face = inputs.face as FaceFrame | undefined;
        const sensitivity = sensitivityFrom(inputs.sensitivity);

        if (!face || !face.present) {
          // Decay toward rest so a lost face relaxes to neutral rather than
          // freezing the last chord, and report absent.
          ema(zeroActivations());
          committed = 'neutral';
          candidate = null;
          candidateCount = 0;
          return { expression: { ...ABSENT_EXPRESSION } };
        }

        ema(expressionActivations(face.blendshapes));

        // Decide with hysteresis (the committed label is judged against its easier
        // exit threshold), then commit a switch only after it persists `dwellFrames`.
        const proposed = decideExpression(smoothed, sensitivity, committed).label;
        if (proposed === committed) {
          candidate = null;
          candidateCount = 0;
        } else {
          if (proposed === candidate) candidateCount++;
          else {
            candidate = proposed;
            candidateCount = 1;
          }
          if (candidateCount >= p.dwellFrames) {
            committed = proposed;
            candidate = null;
            candidateCount = 0;
          }
        }

        return { expression: toScores(sensitivity) };
      },
    };
  },
});
