/**
 * The modality seam of the carve-out (#385 E1): ONE contract for the body part a player
 * carves their own categories from (face now; hands and body next), so the take, the carve,
 * the live tuning and the import guards are written once and a modality is a small object.
 *
 * What varies by modality, and only that, is here: which feature groups to claim, how to read
 * the modality's vector out of the merged live vector, which keys a stored sample keeps, the
 * general model that proposes names (if any), the nuisance a live tuning corrects, and the
 * words. Everything else (sessions, noise units, carving, matching, exemplars, the
 * categorizer file) stays modality-free in this folder.
 *
 * Pure and modality-free itself: the types plus a few helpers over any modality. The
 * implementations read the feature catalog, so they live beside it
 * (`../features/modalities/`). The DOM half (crop region, preview, play targets) is
 * `@thoremin/sdk-ui/enroll/modality`.
 */
import type { Invariance } from '../features/types';
import type { LabelMatchOptions } from './match';
import type { FeatureVector } from './types';

/** The words a modality's tool uses, so copy is written once with the noun filled in. */
export interface ModalityWords {
  /** One thing a player carves: `face`, `hand shape`, `pose`. */
  one: string;
  /** Several of them: `faces`. */
  many: string;
  /** The body part itself, for "relax your face". */
  part: string;
  /** A plural, id-safe name for ids and claim owners: `faces` (cue ids `faces-rest`). */
  slug: string;
  /** What an unnamed category is: `expression` (so `expression 3`). */
  category: string;
  /** The default name of the category that is the player's rest. */
  neutral: string;
  /** The name of the category at `index` (0-based) that nothing else names. */
  fallback(index: number): string;
  /** What the rest asks for, when "relax your <part>" is not it (a hand is held up, relaxed). */
  rest?: string;
  /** What the live test says when the part is not in view, when "No <part> in view" is not it
   *  (#382: a body half out of frame is "cannot see you"). */
  unseen?: string;
}

/**
 * One feature in a player's words (#385 E6): the movement it reads and what to do to make more or
 * less of it. Several features reading one movement share `movement`, so a hint says it once.
 */
export interface FeatureWords {
  /** The movement, as a noun phrase: `mouth open`. */
  name: string;
  /** The instruction for more of it: `open your mouth wider`. */
  more: string;
  /** The instruction for less of it: `close your mouth more`. */
  less: string;
  /** The movement's key, shared by the features that read it (`mouth-open`). Defaults to `name`. */
  movement?: string;
  /** The feature falls as the movement grows (an eye aspect ratio as the eye closes). */
  invert?: boolean;
  /** The feature is SIGNED around a rest of 0 and the movement is its size either way (a head
   *  turn: -20 and +20 degrees are both 20 degrees of it; a right-minus-left asymmetry). */
  signed?: boolean;
}

/** A general model as the matcher's inputs (P1's `matchLabels` options, minus the fallback). */
export type GeneralLabeling = Omit<LabelMatchOptions, 'fallback' | 'keepExisting'>;

/** Which hand a hand categorizer reads (#385 E8, #387 C4): one hand's shape, side-relative, so
 *  `either` makes the same category with whichever hand is in view. Stored on the categorizer. */
export const HAND_CHOICES = ['either', 'left', 'right'] as const;
export type HandChoice = (typeof HAND_CHOICES)[number];

/** Per-read options a modality may honour (hands: which hand). */
export interface ModalityOptions {
  /** A hand modality's side: `left`, `right`, `either` (ignored by the face). `both` (one joint
   *  vector, two-hand shapes) is reserved for later. */
  hand?: HandChoice | 'both';
  /** Read a pose and its mirror image as one (#382, #387 B10): a body categorizer with the mirror
   *  on reads "left arm up" and "right arm up" as the same pose. Off by default. */
  mirror?: boolean;
}

/**
 * A stick figure of one hold (#382): named joints, each `[x, y]` in torso lengths from the hip
 * midpoint, x to the player's right as a mirror shows it, y up. Drawn from the features the carve
 * measures, so it shows what was read and no one's picture; kept in the categorizer file, so an
 * imported or shared categorizer still shows what each category looks like.
 */
export type Skeleton = Readonly<Record<string, readonly [number, number]>>;

/**
 * A nuisance the take asks the player to demonstrate after the rest (#382): "hold any one pose and
 * move closer and further". Whatever moves meanwhile is down-weighted (`weightsFromNuisance`), so
 * where the player stands is not what they do.
 */
export interface NuisanceCueSpec {
  /** Id-safe, unique within the modality: the cue id is `<slug>-<key>`. */
  key: string;
  name: string;
  instruction: string;
  rationale: string;
  /** The confounds it demonstrates. */
  axes: readonly Invariance[];
  /** How long it lasts. */
  ms: number;
}

/**
 * The feature registry a modality's OWN keys resolve against (#385 E8): a modality whose
 * {@link CarveModality.project} renames the merged vector's keys (a side-relative hand:
 * `hand.left.index.curl` -> `index.curl`) says which ids exist and which group each is in, so a
 * session resolves its cues' groups against them instead of the catalog's ids.
 */
export interface FeatureSpace {
  readonly ids: readonly string[];
  groupOf(id: string): string | undefined;
}

/** One body part a player can carve categories from. Pure: no React, no DOM. */
export interface CarveModality {
  /** `face` | `hand` | `body`: stored as the categorizer file's `modality`. */
  readonly id: string;
  readonly words: ModalityWords;
  /** Feature groups to claim through feature demand while the tool reads the camera. */
  readonly groups: readonly string[];
  /** A cue's `collects`: the groups and the ids left out (where you sit is not what you do). */
  collects(): { groups: string[]; omit: string[] };
  /**
   * The vector the carve works in, from the merged live vector (#385 E8), when it is not the
   * merged vector itself: a side-relative hand renames one hand's keys here (and keeps its
   * positions, which crop the still). Applied once, where a tool reads its source; everything
   * after it (the take, the session, the live test) sees only projected vectors. Idempotent: a
   * projected vector projects to itself. Absent: the merged vector as is (the face).
   */
  project?(merged: FeatureVector, options?: ModalityOptions): FeatureVector;
  /** The registry a projected vector's keys resolve against; absent: the catalog's. */
  readonly space?: FeatureSpace;
  /** The modality's vector (its kept keys) from a merged or projected vector, or null when the
   *  part is not in view. */
  read(merged: FeatureVector, options?: ModalityOptions): FeatureVector | null;
  /** Whether a key of the vector the carve works in belongs to this modality (what a stored
   *  sample keeps, and what an imported file's features must include). For a modality with
   *  {@link project}, the keys are the projected ones. */
  keep(key: string): boolean;
  /** The general model that proposes names, if the modality has one. */
  general?(): GeneralLabeling;
  /** Nuisance proxies for the live tuning: camera distance, in order of preference. */
  readonly nuisance: { readonly distance?: readonly string[] };
  /** A feature in plain words, for the quality hints (#385 E6): undefined for a feature the
   *  modality has no words for (the hint then names the id). */
  describe(featureId: string): FeatureWords | undefined;
  /** The share (0..1) of a categorizer's TRAINED features a vector must have for the part to
   *  count as in view (#382: a body half out of frame "cannot be seen" rather than guessed at).
   *  Absent: any one trained feature will do (a face, a hand). */
  readonly minCoverage?: number;
  /** The nuisances the take demonstrates after the rest, in order (#382); none when absent. */
  readonly nuisanceCues?: readonly NuisanceCueSpec[];
  /** A stick figure of a vector (#382), kept with each sample; absent: the modality has none. */
  skeleton?(vector: FeatureVector): Skeleton | null;
}

/** Whether `vector` shows the part well enough to read it with `features` (a categorizer's): its
 *  `minCoverage` of them finite, or any one of them when it states none. */
export function inView(modality: Pick<CarveModality, 'minCoverage'>, vector: FeatureVector, features: readonly string[]): boolean {
  const bar = modality.minCoverage;
  if (bar === undefined) return features.some((f) => Number.isFinite(vector[f]));
  if (!features.length) return false;
  let present = 0;
  for (const f of features) if (Number.isFinite(vector[f])) present += 1;
  return present / features.length >= bar;
}

/** The vector the carve works in: the modality's projection, or the merged vector as is. */
export function projectVector(modality: Pick<CarveModality, 'project'>, merged: FeatureVector, options?: ModalityOptions): FeatureVector {
  return modality.project ? modality.project(merged, options) : merged;
}

/** A session's registry options for the modality (`createSession`'s `groupOf` and
 *  `allFeatureIds`): its own space when it has one, else nothing (the catalog). */
export function sessionSpace(modality: Pick<CarveModality, 'space'>): { groupOf?: (id: string) => string | undefined; allFeatureIds?: readonly string[] } {
  const space = modality.space;
  return space ? { groupOf: (id) => space.groupOf(id), allFeatureIds: space.ids } : {};
}

/** The vector with only the modality's keys (what a stored sample carries). */
export function keepOnly(modality: Pick<CarveModality, 'keep'>, vector: FeatureVector): FeatureVector {
  return Object.fromEntries(Object.entries(vector).filter(([k]) => modality.keep(k)));
}

/** A category label that names the modality's rest (case and spaces ignored). */
export function isNeutralLabel(modality: Pick<CarveModality, 'words'>, label: string): boolean {
  return label.trim().toLowerCase() === modality.words.neutral.trim().toLowerCase();
}

/**
 * Why a categorizer is not one of this modality's, or null when it is: a different stored
 * `modality`, or no feature of this modality at all (a file from before `modality` was stored).
 */
export function foreignModality(
  modality: Pick<CarveModality, 'id' | 'words' | 'keep'>,
  categorizer: { modality?: string; features: readonly string[] },
): string | null {
  const stored = categorizer.modality;
  if ((stored && stored !== modality.id) || !categorizer.features.some((f) => modality.keep(f))) {
    return `a ${stored ?? `non-${modality.id}`} categorizer, not a ${modality.id} one`;
  }
  return null;
}
