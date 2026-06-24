/**
 * Help content for the facial-expression detector — how to trigger each emotion,
 * what the classifier looks for, and where the model comes from. Rendered by the
 * info-icon panel (ExpressionHelp.tsx).
 *
 * The per-emotion guidance is grounded in the actual classifier prototypes
 * (music/expression.ts `EXPRESSION_PROTOTYPES`) and a research pass on how readily
 * MediaPipe's blendshape channels activate: several (noseSneer, mouthFrown,
 * browInnerUp, eyeWide) are under-reported by the model, which is exactly why
 * `sad`, `disgusted`, and `fearful` are the hard ones (flagged `hardToDetect`).
 */
import type { Emotion } from '@/music/expression';

export interface EmotionHelp {
  name: Emotion;
  /** The single most important action, one line. */
  keyAction: string;
  /** 1-3 short, achievable steps. */
  howTo: string;
  /** Why an attempt commonly fails. */
  commonMistake: string;
  /** How to disambiguate from a confusable neighbour. */
  avoidConfusion: string;
  /** The ARKit blendshape channels the classifier scores for this emotion. */
  blendshapes: string[];
  /** True when the model under-reports this emotion's channels (the hard ones). */
  hardToDetect?: boolean;
}

/** Where the model + the blendshape categories come from (for the panel header). */
export const MODEL_ORIGIN =
  'Expressions are read by Google’s MediaPipe Face Landmarker — it tracks 478 face points and outputs 52 “blendshape” values (named after Apple’s ARKit face shapes, e.g. jawOpen, browInnerUp). Your face is matched against a per-emotion template of expected blendshapes, and an emotion fires when it’s activated enough. These are AR-entertainment-grade signals: a few channels (nose-wrinkle, frown, inner-brow, eye-widen) read weakly, so the emotions that rely on them take more effort — those are marked “harder to detect” below, and you can lower their sensitivity bar in Expression sensitivity / mapping.';

/** Per-emotion how-to, in EMOTIONS order (happy, sad, angry, surprised, fearful, disgusted). */
export const EXPRESSION_HELP: EmotionHelp[] = [
  {
    name: 'happy',
    keyAction: 'Smile broadly with both mouth corners.',
    howTo: 'Pull both lip corners up and back into a clear, symmetric smile and let your cheeks lift. The model reads this one reliably.',
    commonMistake: 'A faint, closed-lip half-smile — the model wants a definite smile, not a polite one.',
    avoidConfusion: 'If your jaw drops open you may read as surprised — keep the mouth in a smile shape, not gaping.',
    blendshapes: ['mouthSmileLeft', 'mouthSmileRight', 'cheekSquintLeft', 'cheekSquintRight'],
  },
  {
    name: 'sad',
    keyAction: 'Turn both mouth corners down and drop the lower lip.',
    howTo: 'Pull both lip corners down into a frown and let the lower lip drop, while raising the inner brows. Exaggerate — the model under-reports frowns.',
    commonMistake: 'A subtle frown. A mild sad face barely moves the frown/inner-brow channels and never fires.',
    avoidConfusion: 'Don’t lower/furrow the brows (that reads angry) — keep them raised and knit inward.',
    blendshapes: ['mouthFrownLeft', 'mouthFrownRight', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'browInnerUp'],
    hardToDetect: true,
  },
  {
    name: 'angry',
    keyAction: 'Furrow and lower both brows hard.',
    howTo: 'Pull both eyebrows down and together into a strong furrow; optionally tense the lips. The brow-down channel is reliable, so a firm scowl fires cleanly.',
    commonMistake: 'Only squinting or pressing the lips without driving the brows down — the lowered brow is what carries it.',
    avoidConfusion: 'Don’t wrinkle the nose (that pushes toward disgust); lead with the lowered brow.',
    blendshapes: ['browDownLeft', 'browDownRight', 'noseSneerLeft', 'noseSneerRight', 'mouthPressLeft', 'mouthPressRight'],
  },
  {
    name: 'surprised',
    keyAction: 'Drop your jaw open and raise your brows.',
    howTo: 'Open your mouth (drop the jaw), widen your eyes, and raise your eyebrows. The open jaw is the strongest signal.',
    commonMistake: 'Raising brows with a closed mouth — without the jaw-open the score stays low.',
    avoidConfusion: 'If you knit the inner brows inward and tense up it tips toward fearful — keep it open and lifted.',
    blendshapes: ['jawOpen', 'eyeWideLeft', 'eyeWideRight', 'browOuterUpLeft', 'browOuterUpRight', 'browInnerUp'],
  },
  {
    name: 'fearful',
    keyAction: 'Widen the eyes AND drop the jaw together.',
    howTo: 'Open the eyes as wide as you can, knit the inner brows up-and-together, and drop the jaw — all at once, near-maximal. This is the hardest one.',
    commonMistake: 'A moderate, realistic fear face. Eye-widen and inner-brow barely register, so a non-maximal attempt lands just under the bar.',
    avoidConfusion: 'Vs surprised: knit the inner brows up-and-together and stretch the mouth, rather than a calm open-mouth lift.',
    blendshapes: ['jawOpen', 'eyeWideLeft', 'eyeWideRight', 'browInnerUp', 'mouthStretchLeft', 'mouthStretchRight'],
    hardToDetect: true,
  },
  {
    name: 'disgusted',
    keyAction: 'Wrinkle your nose and raise your upper lip.',
    howTo: 'Scrunch the nose and pull the upper lip up — a “something stinks” sneer — with a slight brow-lower. Drive the upper-lip raise strongly.',
    commonMistake: 'Relying on the nose wrinkle alone — the model pins noseSneer near zero, so without a strong upper-lip raise it’s too weak to fire.',
    avoidConfusion: 'Vs angry: lead with the nose/upper-lip sneer, not the lowered brow.',
    blendshapes: ['noseSneerLeft', 'noseSneerRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'browDownLeft', 'browDownRight'],
    hardToDetect: true,
  },
];

/** Authoritative reference links (the model + visual blendshape/emotion catalogs). */
export const HELP_REFERENCES: { title: string; url: string; shows: string }[] = [
  {
    title: 'MediaPipe Face Landmarker (Google AI Edge)',
    url: 'https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker',
    shows: 'The model: 478 landmarks + 52 blendshapes, and its model card.',
  },
  {
    title: 'ARKit face blendshapes — visual reference',
    url: 'https://arkit-face-blendshapes.com/',
    shows: 'A rendered face for each of the 52 blendshape channels by name.',
  },
  {
    title: 'The 7 universal expressions (Wikimedia, CC BY)',
    url: 'https://commons.wikimedia.org/wiki/File:Universal_emotions7.JPG',
    shows: 'Photographs of each target face, including sad, fear, disgust.',
  },
];
