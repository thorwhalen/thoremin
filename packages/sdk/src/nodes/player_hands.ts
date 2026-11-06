/**
 * The player's two hands, named from the player's side (#249), and the hand landmarker's label for
 * each under the mirror convention. In the SDK (#674) because the air instruments and the harmony
 * slice's chord map and wheel both choose a hand by it.
 *
 * Also the hand a ONE-hand reader wants when two are in view (#784): told to look for one hand,
 * the landmarker holds whichever it found first, so a reader that picks its hand relative to the
 * other (the conductor's right hand, ASL's higher hand) can be handed the wrong one. A reader
 * states which it wants as a {@link HandPreference}, in the frame's own terms (a raw label, or the
 * image's height), so the host can tell from the last frame whether the tracked hand is the wanted
 * one (`src/instruments/hands.ts`) without knowing the reader's mirror convention.
 */
import { LM, type Hand } from './domain';

export const PLAYER_HANDS = ['right', 'left'] as const;
export type PlayerHand = (typeof PLAYER_HANDS)[number];

/**
 * Whether the hand model's Left/Right labels must be swapped to name the player's hand: no, for
 * the live camera and any unmirrored video (#995). MediaPipe labels the hand it sees on an
 * unmirrored image as the person's own: on the player's own takes, the hand the player calls
 * their right is labelled `Right` in every frame (1544 of 1544; the Python pipeline on the same
 * video 1558 of 1559), and the `Right` hand is on the camera image's left, where a facing
 * player's right hand is, in 8,639 of 8,643 two-hand frames of the 11 live takes. The selfie VIEW is mirrored (the
 * display, `mirrorX`); the frames the model reads are not. `true` is for a mirrored RECORDING
 * (the recorder's overlay video). Every instrument's `mirrorHandedness` defaults to this.
 */
export const DEFAULT_MIRROR_HANDEDNESS = false;

/**
 * A stored dial value's `mirrorHandedness: true`, dropped so the dial heals to
 * {@link DEFAULT_MIRROR_HANDEDNESS} (#995). Until then `true` was every hand instrument's default
 * and no panel sets it, so a stored `true` is the old default, never a player's choice: every
 * returning player and every saved instrument had the hands swapped. A slice's persist step (the
 * hot store, once per slice version) and the saved-instrument heal (a layer has no version, so
 * it is applied on every load; it changes nothing the second time).
 */
export function dropOldMirrorDefault(old: unknown): unknown {
  if (!old || typeof old !== 'object' || (old as { mirrorHandedness?: unknown }).mirrorHandedness !== true) return old;
  const { mirrorHandedness: _old, ...rest } = old as Record<string, unknown>;
  return rest;
}

/** MediaPipe's label for the player's hand, given the mirror convention. */
export function labelFor(hand: PlayerHand, mirrorHandedness: boolean): Hand['handedness'] {
  const raw = hand === 'right' ? 'Right' : 'Left';
  if (!mirrorHandedness) return raw;
  return raw === 'Right' ? 'Left' : 'Right';
}

/**
 * The hand a one-hand reader wants when two are in view (#784): the hand with a raw landmarker
 * label (`label`: what a reader that matches `labelFor` wants), or the hand whose wrist is highest
 * in the image (`higher`: ASL's signing hand).
 */
export type HandPreference = { readonly kind: 'label'; readonly handedness: Hand['handedness'] } | { readonly kind: 'higher' };

/** The higher hand: ASL's signing hand (the hand that signs is held up, the other rests). */
export const PREFER_HIGHER_HAND: HandPreference = Object.freeze({ kind: 'higher' });

/** The preference of a reader that wants the player's `hand`, under its mirror convention. */
export function preferPlayerHand(hand: PlayerHand, mirrorHandedness: boolean): HandPreference {
  return { kind: 'label', handedness: labelFor(hand, mirrorHandedness) };
}

/** Whether two preferences want the same hand. */
export function sameHandPreference(a: HandPreference, b: HandPreference): boolean {
  return a.kind === b.kind && (a.kind !== 'label' || a.handedness === (b as typeof a).handedness);
}

/** The wrist's height in the image (pixels down), or undefined for a hand without one. */
const wristY = (hand: Hand): number | undefined => hand.keypoints[LM.wrist]?.y;

/**
 * The hand of `hands` that `preference` picks: the first with the label, or the one whose wrist is
 * highest in the image (smallest y; a hand without a wrist is never picked). Undefined when none is.
 */
export function preferredHand(hands: readonly Hand[], preference: HandPreference): Hand | undefined {
  if (preference.kind === 'label') return hands.find((h) => h.handedness === preference.handedness);
  let best: Hand | undefined;
  for (const h of hands) {
    const y = wristY(h);
    if (y !== undefined && (best === undefined || y < wristY(best)!)) best = h;
  }
  return best;
}
