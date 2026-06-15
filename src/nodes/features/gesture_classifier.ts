/**
 * `gesture-classifier` node — turns continuous hand features into DISCRETE poses
 * (fist / open / pinch / neutral) and emits edge events on transitions. This is
 * the discrete-gesture modality: a recognized pose can trigger things (change
 * scale, stab a chord, toggle a mode, mute) rather than continuously modulate.
 *
 * Pure; stateful only to detect enter/exit edges across ticks. Hysteresis avoids
 * flicker at the thresholds. Classification priority: pinch > fist > open, since
 * a pinch also lowers openness.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { ABSENT_HAND, type HandFeatures, type SingleHandFeatures } from '../domain';

export type Pose = 'pinch' | 'fist' | 'open' | 'neutral' | 'absent';
export interface GestureEvent {
  hand: 'left' | 'right';
  pose: Pose;
  edge: 'enter' | 'exit';
}

const Params = z.object({
  pinchOn: z.number().min(0).max(1).default(0.6),
  pinchOff: z.number().min(0).max(1).default(0.45),
  fistBelow: z.number().min(0).max(1).default(0.25),
  openAbove: z.number().min(0).max(1).default(0.6),
  /** Hysteresis margin applied to fist/open thresholds. */
  hysteresis: z.number().min(0).max(0.5).default(0.05),
});
type Params = z.infer<typeof Params>;

function classify(f: SingleHandFeatures, prev: Pose, p: Params): Pose {
  if (!f.present) return 'absent';
  // Pinch wins, with hysteresis so it doesn't chatter.
  if (prev === 'pinch' ? f.pinch > p.pinchOff : f.pinch > p.pinchOn) return 'pinch';
  const h = p.hysteresis;
  if (prev === 'fist' ? f.openness < p.fistBelow + h : f.openness < p.fistBelow) return 'fist';
  if (prev === 'open' ? f.openness > p.openAbove - h : f.openness > p.openAbove) return 'open';
  return 'neutral';
}

export const gestureClassifierNode = defineNode<Params>({
  type: 'gesture-classifier',
  title: 'Gesture Classifier',
  description: 'Hand features → discrete poses (fist/open/pinch) + enter/exit edge events.',
  inputs: [{ name: 'features', kind: 'hand-features' }],
  outputs: [
    { name: 'poses', kind: 'poses' },
    { name: 'events', kind: 'gesture-events' },
  ],
  params: Params,
  make(p) {
    const prev: Record<'left' | 'right', Pose> = { left: 'absent', right: 'absent' };
    return {
      process(inputs) {
        const f = (inputs.features as HandFeatures | undefined) ?? {
          left: { ...ABSENT_HAND },
          right: { ...ABSENT_HAND },
        };
        const events: GestureEvent[] = [];
        const poses: Record<'left' | 'right', Pose> = { left: 'absent', right: 'absent' };
        for (const hand of ['left', 'right'] as const) {
          const pose = classify(f[hand], prev[hand], p);
          poses[hand] = pose;
          if (pose !== prev[hand]) {
            // Exiting the old meaningful pose, then entering the new one.
            if (prev[hand] !== 'neutral' && prev[hand] !== 'absent') {
              events.push({ hand, pose: prev[hand], edge: 'exit' });
            }
            if (pose !== 'neutral' && pose !== 'absent') {
              events.push({ hand, pose, edge: 'enter' });
            }
            prev[hand] = pose;
          }
        }
        return { poses, events };
      },
    };
  },
});
