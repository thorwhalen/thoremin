/**
 * A synthetic chord-map performance: the chord hand's palm held over given points of the
 * DISPLAYED (mirrored) frame, and the other hand either still at a height (the melody) or
 * strumming down and back up at a steady period (the air guitar's strum). Self-made data,
 * safe to commit. Handedness is as the player sees it (play with `mirrorHandedness: false`).
 */
import { makeHandKeypoints, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';

export const W = 640;
export const H = 480;
const SCALE = 60;

/** A hand whose palm centre (the wrist and the four knuckles) is at display point `p`. */
export function palmAt(p: { x: number; y: number }, handedness: 'Left' | 'Right'): Hand {
  // makeHandKeypoints: the wrist at (cx, cy), the knuckles one hand-length up, centred on cx,
  // so the palm centre is (cx, cy - 0.8 scale). The display mirrors x.
  const cx = (1 - p.x) * W;
  const cy = p.y * H + 0.8 * SCALE;
  return { handedness, keypoints: makeHandKeypoints({ cx, cy, scale: SCALE, spread: 0.8, pinch: 0, handedness }) };
}

export interface ChordMapTake {
  duration: number;
  fps?: number;
  /** Where the chord hand's palm is at time t (display fractions), or null when it is not seen. */
  chordAt: (t: number) => { x: number; y: number } | null;
  /** Where the other hand's palm is (display fractions), or null; ignored while strumming. */
  otherAt?: (t: number) => { x: number; y: number } | null;
  /** Strum with the other hand (a wrist stroke) at this period, seconds. */
  strumPeriod?: number;
  depth?: number;
}

export function chordMapTake({ duration, fps = 30, chordAt, otherAt, strumPeriod, depth = 0.15 }: ChordMapTake): HandsFrame[] {
  const frames: HandsFrame[] = [];
  for (let i = 0; i < Math.round(duration * fps); i++) {
    const t = i / fps;
    const hands: Hand[] = [];
    const chord = chordAt(t);
    if (chord) hands.push(palmAt(chord, 'Left'));
    if (strumPeriod) {
      const y = 0.5 * H + depth * H * (1 - Math.cos((2 * Math.PI * t) / strumPeriod)) * 0.5;
      hands.push({ handedness: 'Right', keypoints: makeHandKeypoints({ cx: 0.15 * W, cy: y, scale: 50, spread: 0.6, pinch: 0, handedness: 'Right' }) });
    } else {
      const other = otherAt?.(t);
      if (other) hands.push(palmAt(other, 'Right'));
    }
    frames.push({ t, width: W, height: H, hands });
  }
  return frames;
}
