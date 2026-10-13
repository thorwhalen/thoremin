/**
 * The face's features in plain words (#385 E6, design C.4.8): what a quality hint says when two
 * of a player's faces are too close ("they differ mostly in mouth open; open your mouth wider for
 * open smile"). The catalog's descriptions are an engineer's ("MediaPipe blendshape jawOpen",
 * "Inner-lip gap / IOD"); a player needs the movement and what to do about it.
 *
 * The catalog measures one movement many ways (a mouth opening is `jawOpen`, the inner-lip gap,
 * the mouth aspect ratio, the chin drop, AU25 and AU26), so the table is by MOVEMENT: each lists
 * the feature ids that read it, and the ones that read it backwards (an eye aspect ratio falls as
 * the eye closes). A hint ranks movements, not ids, so one opening mouth is said once. Left and
 * right variants share their movement: which side MediaPipe calls left is not something a player
 * should have to know, and a one-sided difference is what the symmetry movements are for.
 *
 * Head turns are said without a direction ("further to one side"): the pose's sign convention is
 * the transform matrix's, and a hint that says "left" for the wrong side is worse than none. The
 * pose angles, the right-minus-left asymmetries and the jaw's lateral shift are SIGNED: their
 * movement is their size either way (`signed`), so "more" means further from straight, on the
 * side the face is already on.
 *
 * Directions were checked against the real recordings (`test/faces/face_words_direction.test.ts`):
 * the geometry features measure distances in image coordinates (y down, z nearer the camera more
 * negative), so several read their movement backwards and are listed under `down`.
 */
import type { FeatureWords } from '../../enroll/modality';

interface Movement {
  /** The dedup key, and the words. */
  words: Omit<FeatureWords, 'movement' | 'invert'>;
  /** Ids (after `face.`) that rise with the movement. */
  up: readonly string[];
  /** Ids (after `face.`) that fall as the movement grows. */
  down?: readonly string[];
  /** Ids (after `face.`) signed around 0, whose size is the movement (see the header). */
  signed?: readonly string[];
}

const bs = (...ids: string[]): string[] => ids.map((id) => `blendshape.${id}`);
const lr = (stem: string): string[] => [`${stem}Left`, `${stem}Right`];

const MOVEMENTS: Readonly<Record<string, Movement>> = {
  'mouth-open': {
    words: { name: 'mouth open', more: 'open your mouth wider', less: 'close your mouth more' },
    up: [...bs('jaw.open', ...lr('mouth.lowerDown')), 'geom.mouth.openness', 'geom.mouth.aspectRatio', 'geom.jaw.drop', 'au.au25_lipsPart', 'au.au26_jawDrop'],
  },
  smile: {
    words: { name: 'smile', more: 'smile wider', less: 'smile less' },
    up: [...bs(...lr('mouth.smile')), 'geom.mouth.cornerPullLeft', 'geom.mouth.cornerPullRight', 'au.au12_lipCornerPuller'],
  },
  'mouth-corners-down': {
    words: { name: 'mouth corners down', more: 'pull the corners of your mouth down more', less: 'pull the corners of your mouth down less' },
    up: [...bs(...lr('mouth.frown')), 'au.au15_lipCornerDepressor'],
  },
  pucker: {
    words: { name: 'lips pushed out', more: 'push your lips out more', less: 'push your lips out less' },
    up: [...bs('mouth.pucker'), 'geom.mouth.protrusion', 'au.au18_lipPucker'],
  },
  funnel: {
    words: { name: 'lips rounded', more: 'round your lips more, as in "oo"', less: 'round your lips less' },
    up: [...bs('mouth.funnel'), 'au.au22_lipFunneler'],
  },
  'mouth-stretch': {
    words: { name: 'mouth stretched wide', more: 'stretch your mouth wider', less: 'stretch your mouth less' },
    up: [...bs(...lr('mouth.stretch')), 'geom.mouth.width', 'au.au20_lipStretcher'],
  },
  'mouth-side': {
    words: { name: 'mouth pulled to one side', more: 'pull your mouth further to one side', less: 'keep your mouth more centred' },
    up: bs('mouth.left', 'mouth.right', 'jaw.left', 'jaw.right'),
    signed: ['symmetry.mouthSideShift', 'geom.jaw.lateralShift'],
  },
  // Upper and lower lip roll apart in a smile (the upper rolls in as the lower rolls out), so
  // they are two movements, and AU28 (their mean) a third.
  'upper-lip-rolled': {
    words: { name: 'upper lip rolled in', more: 'roll your upper lip in more', less: 'roll your upper lip in less' },
    up: bs('mouth.rollUpper'),
  },
  'lower-lip-rolled': {
    words: { name: 'lower lip rolled in', more: 'roll your lower lip in more', less: 'roll your lower lip in less' },
    up: bs('mouth.rollLower'),
  },
  'lips-sucked': {
    words: { name: 'both lips rolled in', more: 'roll both lips in more', less: 'roll both lips in less' },
    up: ['au.au28_lipSuck'],
  },
  'lips-pressed': {
    words: { name: 'lips pressed together', more: 'press your lips together harder', less: 'press your lips together less' },
    up: [...bs(...lr('mouth.press'), 'mouth.close'), 'au.au23_lipTightener'],
  },
  'upper-lip-up': {
    words: { name: 'upper lip raised', more: 'raise your upper lip more', less: 'raise your upper lip less' },
    up: [...bs(...lr('mouth.upperUp')), 'au.au10_upperLipRaiser'],
  },
  'chin-up': {
    words: { name: 'chin pushed up (a pout)', more: 'push your chin up more', less: 'push your chin up less' },
    up: [...bs('mouth.shrugUpper', 'mouth.shrugLower'), 'au.au17_chinRaiser'],
  },
  dimples: {
    words: { name: 'mouth corners tightened', more: 'tighten the corners of your mouth more', less: 'tighten the corners of your mouth less' },
    up: [...bs(...lr('mouth.dimple')), 'au.au14_dimpler'],
  },
  'jaw-forward': {
    words: { name: 'jaw pushed forward', more: 'push your jaw forward more', less: 'push your jaw forward less' },
    up: bs('jaw.forward'),
  },
  // Chin z minus glabella z. It should fall as the chin comes toward the camera, but an opening
  // mouth moves the chin back too, and the recording cannot tell the two apart: so its own
  // movement, said without a direction.
  'jaw-depth': {
    words: { name: 'jaw forward or back', more: 'move your jaw further forward or back', less: 'hold your jaw nearer where it rests' },
    up: [],
    signed: ['geom.jaw.thrust'],
  },
  'brows-up': {
    words: { name: 'eyebrows raised', more: 'raise your eyebrows higher', less: 'raise your eyebrows less' },
    up: [...bs(...lr('brow.outerUp')), 'geom.brow.raiseLeft', 'geom.brow.raiseRight', 'geom.brow.raiseAvg', 'au.au2_outerBrowRaiser'],
  },
  'inner-brows-up': {
    words: { name: 'inner eyebrows raised (a worried look)', more: 'lift the inner ends of your eyebrows more', less: 'lift the inner ends of your eyebrows less' },
    up: [...bs('brow.innerUp'), 'geom.brow.innerRaise', 'au.au1_innerBrowRaiser'],
  },
  'brows-down': {
    words: { name: 'eyebrows lowered and drawn together', more: 'frown with your eyebrows more', less: 'frown with your eyebrows less' },
    up: [...bs(...lr('brow.down')), 'au.au4_browLowerer'],
    // The inner brows' separation shrinks as they are drawn together.
    down: ['geom.brow.furrow'],
  },
  'eyes-closed': {
    words: { name: 'eyes closed', more: 'close your eyes more', less: 'open your eyes more' },
    up: [...bs(...lr('eye.blink')), 'au.au43_eyesClosed'],
    down: ['geom.eye.earLeft', 'geom.eye.earRight', 'geom.eye.earAvg', 'geom.eye.apertureLeft', 'geom.eye.apertureRight'],
  },
  squint: {
    words: { name: 'eyes squinted', more: 'squint more', less: 'squint less' },
    up: [...bs(...lr('eye.squint')), 'au.au7_lidTightener'],
  },
  'eyes-wide': {
    words: { name: 'eyes opened wide', more: 'open your eyes wider', less: 'open your eyes less wide' },
    up: [...bs(...lr('eye.wide')), 'au.au5_upperLidRaiser'],
  },
  'cheeks-puffed': {
    words: { name: 'cheeks puffed', more: 'puff your cheeks out more', less: 'puff your cheeks out less' },
    up: bs('cheek.puff'),
  },
  'cheeks-up': {
    words: { name: 'cheeks raised', more: 'raise your cheeks more, as in a real smile', less: 'raise your cheeks less' },
    up: [...bs(...lr('cheek.squint')), 'au.au6_cheekRaiser'],
    // The cheek's distance below the eye (y down): it shrinks as the cheek rises.
    down: ['geom.cheek.raiseLeft', 'geom.cheek.raiseRight'],
  },
  'nose-wrinkled': {
    words: { name: 'nose wrinkled', more: 'wrinkle your nose more', less: 'wrinkle your nose less' },
    up: [...bs(...lr('nose.sneer')), 'au.au9_noseWrinkler'],
    // The nose-to-inner-eye distance: it shrinks as the nose wrinkles.
    down: ['geom.nose.wrinkle'],
  },
  'head-turn': {
    words: { name: 'head turned', more: 'turn your head further to that side', less: 'turn your head back toward the camera' },
    up: [],
    signed: ['head.yaw'],
  },
  'head-nod': {
    words: { name: 'head tipped up or down', more: 'tip your head further', less: 'hold your head more level' },
    up: [],
    signed: ['head.pitch'],
  },
  'head-tilt': {
    words: { name: 'head tilted toward a shoulder', more: 'tilt your head further', less: 'hold your head more upright' },
    up: [],
    signed: ['head.roll'],
  },
  'lopsided-smile': {
    words: { name: 'a lopsided smile', more: 'make your smile more lopsided', less: 'smile more evenly' },
    up: [],
    signed: ['symmetry.smile', 'symmetry.mouthCorner'],
  },
  'one-brow': {
    words: { name: 'one eyebrow raised', more: 'raise one eyebrow more than the other', less: 'raise both eyebrows evenly' },
    up: [],
    signed: ['symmetry.browOuter'],
  },
  wink: {
    words: { name: 'a wink', more: 'close one eye more than the other', less: 'keep both eyes alike' },
    up: [],
    signed: ['symmetry.eye', 'symmetry.cheek'],
  },
};

/** Feature id -> its words, built once from {@link MOVEMENTS}. */
const BY_ID: ReadonlyMap<string, FeatureWords> = (() => {
  const out = new Map<string, FeatureWords>();
  for (const [movement, m] of Object.entries(MOVEMENTS)) {
    for (const id of m.up) out.set(`face.${id}`, { ...m.words, movement });
    for (const id of m.down ?? []) out.set(`face.${id}`, { ...m.words, movement, invert: true });
    for (const id of m.signed ?? []) out.set(`face.${id}`, { ...m.words, movement, signed: true });
  }
  return out;
})();

/** The plain words for a face feature, or undefined for one no movement reads (a position). */
export const faceWords = (featureId: string): FeatureWords | undefined => BY_ID.get(featureId);
