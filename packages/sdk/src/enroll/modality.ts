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
}

/** A general model as the matcher's inputs (P1's `matchLabels` options, minus the fallback). */
export type GeneralLabeling = Omit<LabelMatchOptions, 'fallback' | 'keepExisting'>;

/** Per-read options a modality may honour (hands: which hand). */
export interface ModalityOptions {
  /** A hand modality's side: `left`, `right`, `either` (ignored by the face). */
  hand?: 'left' | 'right' | 'either' | 'both';
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
  /** The modality's vector from the merged live vector, or null when the part is not in view. */
  read(merged: FeatureVector, options?: ModalityOptions): FeatureVector | null;
  /** Whether a key belongs to this modality (what a stored sample keeps). */
  keep(key: string): boolean;
  /** The general model that proposes names, if the modality has one. */
  general?(): GeneralLabeling;
  /** Nuisance proxies for the live tuning: camera distance, in order of preference. */
  readonly nuisance: { readonly distance?: readonly string[] };
  /** Plain words for moving a feature one way, for hints. */
  describe(featureId: string, sign: 1 | -1): string;
}

/** The vector with only the modality's keys (what a stored sample carries). */
export function keepOnly(modality: Pick<CarveModality, 'keep'>, vector: FeatureVector): FeatureVector {
  return Object.fromEntries(Object.entries(vector).filter(([k]) => modality.keep(k)));
}

/** A category label that names the modality's rest (case and spaces ignored). */
export function isNeutralLabel(modality: Pick<CarveModality, 'words'>, label: string): boolean {
  return label.trim().toLowerCase() === modality.words.neutral;
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
