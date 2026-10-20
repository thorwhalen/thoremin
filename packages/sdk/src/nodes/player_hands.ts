/**
 * The player's two hands, named from the player's side (#249), and the hand landmarker's label for
 * each under the mirror convention. In the SDK (#674) because the air instruments and the harmony
 * slice's chord map and wheel both choose a hand by it.
 */
import type { Hand } from './domain';

export const PLAYER_HANDS = ['right', 'left'] as const;
export type PlayerHand = (typeof PLAYER_HANDS)[number];

/** MediaPipe's label for the player's hand, given the mirror convention. */
export function labelFor(hand: PlayerHand, mirrorHandedness: boolean): Hand['handedness'] {
  const raw = hand === 'right' ? 'Right' : 'Left';
  if (!mirrorHandedness) return raw;
  return raw === 'Right' ? 'Left' : 'Right';
}
