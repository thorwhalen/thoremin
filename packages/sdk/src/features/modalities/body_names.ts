/**
 * Default names for body poses (#383, body-movement B3; #387 B9: "both by context"): a small
 * hand-written prototype categorizer over the pose features, which is all a default needs (the
 * player edits every name). There is no learned general body model, and inventing one is not
 * worth it (design §4.5).
 *
 * Three vocabularies, chosen by the categorizer's context ({@link bodyVocabulary}):
 *
 * - **standing**: `rest`, `arms up`, `left arm up`, `right arm up`, `arms out`, `hands together`,
 *   `lean left`, `lean right`, `crouch`;
 * - **seated**: the same minus `crouch`, chosen when the categorizer's trained features have no
 *   leg feature (the visibility mask dropped the legs for the whole take, as under a desk);
 * - **conductor**: `ready`, `fermata`, `cut-off`, `rest`, when the categorizer was made for the
 *   conductor (the Conductor tool's "Teach my conducting poses"; `vocabulary: 'conductor'` on the
 *   file). These are the names the conductor's transport override reads (#384).
 *
 * With the mirror on (#387 B10) a pose and its mirror image are one category, so the sided names
 * merge: `one arm up`, `lean`.
 *
 * Every rule reads a category's CENTROID in the pose space, on the catalog's own scales: segment
 * elevations in degrees in the torso's frame (`body.dir.*`), the wrist's rise above its shoulder
 * in torso lengths, wrist-to-wrist over shoulder width, the torso's signed lean (positive toward
 * the player's left shoulder) and the knee angle (180 = straight). A rule is a product of ramps,
 * each from a `*From` value (score 0) to a `*Full` value (score 1), so a missing feature scores 0
 * and never names anything. The names are assigned one-to-one by `matchLabels` over these scores
 * with the per-label bar, and a category no rule reaches gets the modality's fallback, `pose n`.
 */
import type { GeneralContext, GeneralLabeling } from '../../enroll/modality';
import type { FeatureVector } from '../../enroll/types';

/** The thresholds of the prototype poses (see the module header for the scales). */
export const BODY_POSE_RULES = {
  /** An arm up: the wrist well above its shoulder, the upper arm raised. */
  upRiseFrom: 0.2,
  upRiseFull: 0.6,
  upElevFrom: 30,
  upElevFull: 60,
  /** An arm down: the wrist far below its shoulder (a hanging arm is about -1.05). */
  downRiseFrom: -0.5,
  downRiseFull: -0.85,
  /** An arm out: the upper arm out to the side, the wrist near shoulder height. */
  outElevFrom: 50,
  outElevFull: 75,
  outLevelFrom: 0.5,
  outLevelFull: 0.25,
  /** Hands together: wrist-to-wrist under shoulder width (about 1.2 at rest). */
  togetherFrom: 0.6,
  togetherFull: 0.3,
  /** A lean: the torso's sideways lean, degrees. */
  leanFrom: 8,
  leanFull: 14,
  /** A crouch: the straighter knee bent below this (degrees; 180 = straight). */
  crouchFrom: 160,
  crouchFull: 135,
  /** A conductor's ready: the forearm raised in front while the upper arm stays down. */
  readyForeFrom: 15,
  readyForeFull: 35,
  readyUpperFrom: 0,
  readyUpperFull: -25,
  /** A fermata: an arm held high (wrist above the shoulder, upper arm raised). */
  fermataRiseFrom: 0.2,
  fermataRiseFull: 0.6,
  fermataElevFrom: 25,
  fermataElevFull: 45,
  /** The bar a rule's score must reach to give its name. */
  minScore: 0.5,
} as const;

export type BodyPoseRules = typeof BODY_POSE_RULES;

/** The vocabularies by id. `standing` and `seated` are chosen by coverage; `conductor` by the
 *  categorizer's `vocabulary`. */
export const BODY_VOCABULARIES = {
  standing: ['rest', 'arms up', 'left arm up', 'right arm up', 'arms out', 'hands together', 'lean left', 'lean right', 'crouch'],
  seated: ['rest', 'arms up', 'left arm up', 'right arm up', 'arms out', 'hands together', 'lean left', 'lean right'],
  conductor: ['ready', 'fermata', 'cut-off', 'rest'],
} as const satisfies Record<string, readonly string[]>;

export type BodyVocabularyId = keyof typeof BODY_VOCABULARIES;

/** The context a categorizer can ask for by name (`vocabulary` on the file); the others are
 *  chosen by coverage. */
export const BODY_VOCABULARY_CONTEXTS = ['conductor'] as const;

/** The sided names that merge under the mirror, and the side-free name they become. */
const MIRRORED: Readonly<Record<string, string>> = {
  'left arm up': 'one arm up',
  'right arm up': 'one arm up',
  'lean left': 'lean',
  'lean right': 'lean',
};

/** Whether a feature id reads the legs (what a seated take, its legs masked, never has). */
export function isLegFeature(id: string): boolean {
  return /^body\.dir\.(thigh|shank)\./.test(id) || /^body\.angle\.(knee|hip)\./.test(id) || id === 'body.shape.stance' || id === 'body.shape.height';
}

/** Which vocabulary names a categorizer with this context: the one it asks for, else seated when
 *  its features are known and none reads the legs, else standing. */
export function bodyVocabulary(context: GeneralContext = {}): BodyVocabularyId {
  if (context.vocabulary === 'conductor') return 'conductor';
  if (context.features && context.features.length > 0 && !context.features.some(isLegFeature)) return 'seated';
  return 'standing';
}

/** The labels a context names with (the mirror merges the sided ones), in pool order. */
export function bodyLabels(context: GeneralContext = {}): string[] {
  const base: readonly string[] = BODY_VOCABULARIES[bodyVocabulary(context)];
  if (!context.mirror) return [...base];
  return [...new Set(base.map((l) => MIRRORED[l] ?? l))];
}

const ramp = (x: number | undefined, from: number, full: number): number => {
  if (x === undefined || !Number.isFinite(x)) return 0;
  const t = (x - from) / (full - from);
  return Math.max(0, Math.min(1, t));
};

/**
 * Every prototype's score for a pose centroid, by name (the sided names and their mirrored
 * merges both). Pure; a feature the centroid lacks scores its rules 0.
 */
export function bodyPoseScores(c: FeatureVector, rules: BodyPoseRules = BODY_POSE_RULES): Record<string, number> {
  const side = (s: 'left' | 'right') => {
    const rise = c[`body.pos.wrist.${s}.rise`];
    const up = c[`body.dir.upperArm.${s}.up`];
    const out = c[`body.dir.upperArm.${s}.out`];
    const fore = c[`body.dir.forearm.${s}.up`];
    return {
      up: ramp(rise, rules.upRiseFrom, rules.upRiseFull) * ramp(up, rules.upElevFrom, rules.upElevFull),
      down: ramp(rise, rules.downRiseFrom, rules.downRiseFull),
      out: ramp(out, rules.outElevFrom, rules.outElevFull) * ramp(Number.isFinite(rise) ? Math.abs(rise) : NaN, rules.outLevelFrom, rules.outLevelFull),
      ready: ramp(fore, rules.readyForeFrom, rules.readyForeFull) * ramp(up, rules.readyUpperFrom, rules.readyUpperFull),
      fermata: ramp(rise, rules.fermataRiseFrom, rules.fermataRiseFull) * ramp(up, rules.fermataElevFrom, rules.fermataElevFull),
    };
  };
  const L = side('left');
  const R = side('right');
  const lean = c['body.angle.torso.lean'];
  const leanLeft = ramp(lean, rules.leanFrom, rules.leanFull);
  const leanRight = ramp(Number.isFinite(lean) ? -lean : NaN, rules.leanFrom, rules.leanFull);
  const knees = [c['body.angle.knee.left'], c['body.angle.knee.right']].filter((x) => Number.isFinite(x));
  const crouch = knees.length > 0 ? ramp(Math.max(...knees), rules.crouchFrom, rules.crouchFull) : 0;
  const bothUp = L.up * R.up;
  const leftUp = L.up * (1 - R.up) * (1 - R.out);
  const rightUp = R.up * (1 - L.up) * (1 - L.out);
  const anyLean = Math.max(leanLeft, leanRight);
  return {
    rest: L.down * R.down * (1 - anyLean) * (1 - crouch),
    'arms up': bothUp,
    'left arm up': leftUp,
    'right arm up': rightUp,
    'one arm up': Math.max(leftUp, rightUp),
    'arms out': L.out * R.out,
    'hands together': ramp(c['body.shape.openness'], rules.togetherFrom, rules.togetherFull) * (1 - bothUp),
    'lean left': leanLeft,
    'lean right': leanRight,
    lean: anyLean,
    crouch,
    ready: L.ready * R.ready,
    fermata: Math.max(L.fermata, R.fermata),
    'cut-off': Math.max(L.out, R.out),
  };
}

/** The body's general model for a context: its vocabulary as a labeling over a category's
 *  centroid (the names a fresh carve proposes, one-to-one). */
export function generalBodyLabeling(context: GeneralContext = {}, rules: BodyPoseRules = BODY_POSE_RULES): GeneralLabeling {
  const labels = bodyLabels(context);
  return {
    labels,
    score: (centroid) => {
      const all = bodyPoseScores(centroid, rules);
      return Object.fromEntries(labels.map((l) => [l, all[l] ?? 0]));
    },
    minScore: rules.minScore,
  };
}
