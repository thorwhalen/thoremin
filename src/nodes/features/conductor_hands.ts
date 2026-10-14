/**
 * The conductor's reading of a hands frame (split from `conductor.ts`, #557): which hand
 * beats, which hand shapes, the tracked point in frame heights, and what counts as a new
 * camera frame. Pure functions of a frame and the conductor's params; no state.
 */
import { LM, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import type { ConductorDialParams as Params, ConductorHand } from './conductor';

/** MediaPipe's label for the player's hand, given the mirror convention. */
export function labelFor(hand: Exclude<ConductorHand, 'auto'>, mirrorHandedness: boolean): Hand['handedness'] {
  const raw = hand === 'right' ? 'Right' : 'Left';
  if (!mirrorHandedness) return raw;
  return raw === 'Right' ? 'Left' : 'Right';
}

/** The hand that shapes the expression (#378): the one `expressionHand` names (#457);
 *  with `auto`, while an ARM of the body beats on a named side, the other hand (the
 *  conducting literature's expressive hand), otherwise the conductor's hand choice. */
export function shapingHand(frame: HandsFrame, cfg: Params): Hand | undefined {
  if (cfg.expressionHand !== 'auto') {
    const label = labelFor(cfg.expressionHand, cfg.mirrorHandedness);
    return frame.hands.find((h) => h.handedness === label);
  }
  if (cfg.source === 'body' && (cfg.bodyPoint === 'impact' || cfg.bodyPoint === 'wrist') && cfg.hand !== 'auto') {
    const label = labelFor(cfg.hand === 'right' ? 'left' : 'right', cfg.mirrorHandedness);
    return frame.hands.find((h) => h.handedness === label);
  }
  return pickHand(frame, cfg);
}

export function pickHand(frame: HandsFrame, cfg: Params): Hand | undefined {
  if (!frame.hands.length) return undefined;
  if (cfg.hand === 'auto') {
    const preferred = labelFor('right', cfg.mirrorHandedness);
    return frame.hands.find((h) => h.handedness === preferred) ?? frame.hands[0];
  }
  const label = labelFor(cfg.hand, cfg.mirrorHandedness);
  return frame.hands.find((h) => h.handedness === label);
}

/** Two samples closer than this (seconds) are not two camera frames: a stamp-source
 *  switch (a clock stamp followed by an estimated one, pushed forward to stay
 *  increasing) can put them a millisecond apart, and a backward difference over that
 *  would latch the speed fallback. No camera this app meets exceeds 240 fps. */
export const MIN_SAMPLE_SPACING = 0.004;

/** Whether a frame is a new observation: the same object again, or a distinct copy
 *  carrying the same stamp (a replayed recording stores every tick, so a camera frame
 *  comes back as two parsed copies), is not. */
export const isFresh = (f: { t?: number } | undefined, prev: { t?: number } | undefined): boolean =>
  f !== prev && !(!!f && !!prev && f.t !== undefined && f.t === prev.t);

/** The tracked point of a hand, in frame heights (the hand detector's unit). */
export function handPoint(hand: Hand, frame: HandsFrame, c: Params, t: number): { t: number; x: number; y: number } {
  const kp = hand.keypoints[c.point === 'wrist' ? LM.wrist : LM.index_tip];
  return { t, x: kp.x / frame.height, y: kp.y / frame.height };
}
