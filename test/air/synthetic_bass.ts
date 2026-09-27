/**
 * A synthetic air-bass performance (#249): the fretting hand held a chosen number of its
 * own palm spans from the plucking hand, the plucking hand stroking down and back up at a
 * steady period (a smooth turn at the bottom: an air stroke, not a surface). Self-made
 * data only, safe to commit. Handedness is as the player sees it (no mirror), so the
 * node under test runs with `mirrorHandedness: false`.
 */
import { makeHandKeypoints, type HandsFrame } from '@/nodes/domain';

export interface BassTake {
  /** Seconds. */
  duration: number;
  fps?: number;
  /** The fretting hand's distance from the plucking hand at time t, in palm spans. */
  neck: (t: number) => number;
  /** Seconds per pluck (down and back up). */
  period?: number;
  /** Pluck depth as a fraction of the frame height. */
  depth?: number;
  /** Which hand plucks. */
  pluckHand?: 'right' | 'left';
}

const W = 640;
const H = 480;
const SCALE = 40; // px, ≈ the wrist-to-middle-knuckle palm span

export function bassTake({ duration, fps = 30, neck, period = 0.5, depth = 0.12, pluckHand = 'right' }: BassTake): HandsFrame[] {
  const frames: HandsFrame[] = [];
  const pluckX = pluckHand === 'right' ? 520 : 120;
  const dir = pluckHand === 'right' ? -1 : 1; // the neck runs away from the plucking hand
  for (let i = 0; i < Math.round(duration * fps); i++) {
    const t = i / fps;
    const pluckY = 0.55 * H + depth * H * (1 - Math.cos((2 * Math.PI * t) / period)) * 0.5;
    const fretX = pluckX + dir * neck(t) * SCALE;
    const pluckLabel = pluckHand === 'right' ? 'Right' : 'Left';
    const fretLabel = pluckHand === 'right' ? 'Left' : 'Right';
    const pluck = makeHandKeypoints({ cx: pluckX, cy: pluckY, scale: SCALE, spread: 0.6, pinch: 0, handedness: pluckLabel });
    const fret = makeHandKeypoints({ cx: fretX, cy: 0.5 * H, scale: SCALE, spread: 0.3, pinch: 0, handedness: fretLabel });
    frames.push({
      t,
      width: W,
      height: H,
      hands: [
        { handedness: pluckLabel, keypoints: pluck },
        { handedness: fretLabel, keypoints: fret },
      ],
    });
  }
  return frames;
}
