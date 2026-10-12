/**
 * The signs the recogniser knows, and how they are shown.
 *
 * Static: 24 letters of the fingerspelled alphabet, readable from one frame's handshape.
 * Motion: J and Z (the two letters drawn in the air: J traces a hook with the pinky, Z a
 * zigzag with the index) and the common words, every one of which is a movement (YES nods
 * a fist, NO snaps two fingers to the thumb, HELLO salutes outward, THANK YOU leaves the
 * chin, PLEASE and SORRY circle on the chest, BYE waves). Those need a window of frames,
 * not a frame: `motion.ts`.
 */

/** Every class id, in display order: the alphabet A-Z, then the words. */
export const SIGN_IDS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  'yes', 'no', 'hello', 'thankyou', 'please', 'sorry', 'bye',
] as const;
export type SignId = (typeof SIGN_IDS)[number];

/** The letters a single frame can show (all but J and Z). */
export const STATIC_SIGNS: readonly SignId[] = SIGN_IDS.filter((s) => s.length === 1 && s !== 'J' && s !== 'Z');
/** The signs that need movement over time. */
export const MOTION_SIGNS: readonly SignId[] = SIGN_IDS.filter((s) => !STATIC_SIGNS.includes(s));

const WORD_TEXT: Partial<Record<SignId, string>> = {
  yes: 'YES', no: 'NO', hello: 'HELLO', thankyou: 'THANK YOU', please: 'PLEASE', sorry: 'SORRY', bye: 'BYE',
};

/** How a sign is written on screen ("THANK YOU", "F"). */
export function signText(id: SignId): string {
  return WORD_TEXT[id] ?? id;
}

/** Short form for a bar label (a letter, or a word's first four letters). */
export function signShort(id: SignId): string {
  return id.length === 1 ? id : (WORD_TEXT[id] ?? id).replace(' ', '').slice(0, 5);
}

export const isLetter = (id: string): boolean => id.length === 1;
