/**
 * The conductor's reading of a hands frame (split from `conductor.ts`, #557): which hand
 * beats, which hand shapes, and the tracked point in frame heights. Pure functions of a
 * frame and the conductor's params; no state. Which hand is chosen goes through the SDK's
 * `preferredHand`, the rule the host's hand-count policy steers the landmarker by (#784), so
 * the hand the conductor reads and the hand the model is asked to track cannot drift apart;
 * what counts as a new camera frame is the SDK's `isFreshFrame` (#964).
 */
import { LM, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { preferPlayerHand, preferredHand, type PlayerHand } from '@thoremin/sdk/nodes/player_hands';
import type { ConductorDialParams as Params } from './conductor.schema';

/** The player's `hand` in the frame, read through the conductor's mirror convention. */
const playerHand = (frame: HandsFrame, hand: PlayerHand, cfg: Params): Hand | undefined => preferredHand(frame.hands, preferPlayerHand(hand, cfg.mirrorHandedness));

/** The hand that shapes the expression (#378): the one `expressionHand` names (#457);
 *  with `auto`, while an ARM of the body beats on a named side, the other hand (the
 *  conducting literature's expressive hand), otherwise the conductor's hand choice. */
export function shapingHand(frame: HandsFrame, cfg: Params): Hand | undefined {
  if (cfg.expressionHand !== 'auto') return playerHand(frame, cfg.expressionHand, cfg);
  if (cfg.source === 'body' && (cfg.bodyPoint === 'impact' || cfg.bodyPoint === 'wrist') && cfg.hand !== 'auto') {
    return playerHand(frame, cfg.hand === 'right' ? 'left' : 'right', cfg);
  }
  return pickHand(frame, cfg);
}

/** The hand that beats: the one `hand` names, or with `auto` the player's right hand, else any. */
export function pickHand(frame: HandsFrame, cfg: Params): Hand | undefined {
  if (cfg.hand !== 'auto') return playerHand(frame, cfg.hand, cfg);
  return playerHand(frame, 'right', cfg) ?? frame.hands[0];
}

/** Two samples closer than this (seconds) are not two camera frames: a stamp-source
 *  switch (a clock stamp followed by an estimated one, pushed forward to stay
 *  increasing) can put them a millisecond apart, and a backward difference over that
 *  would latch the speed fallback. No camera this app meets exceeds 240 fps. */
export const MIN_SAMPLE_SPACING = 0.004;

/** The tracked point of a hand, in frame heights (the hand detector's unit). */
export function handPoint(hand: Hand, frame: HandsFrame, c: Params, t: number): { t: number; x: number; y: number } {
  const kp = hand.keypoints[c.point === 'wrist' ? LM.wrist : LM.index_tip];
  return { t, x: kp.x / frame.height, y: kp.y / frame.height };
}
