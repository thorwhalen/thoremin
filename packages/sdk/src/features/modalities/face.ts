/**
 * The face as a carve modality (#385 E1): the face-specific half of the personal categorizer
 * tool ("Your faces", `@thoremin/ext-faces`), in one object. What it claims and omits is
 * `../face_groups.ts` (shared with the trainer's starter cues, so a face category means the
 * same features whichever tool made it), its general model is `../face_labels.ts` (the seven
 * expressions), and camera distance is its one nuisance.
 *
 * Every value here is the one ext-faces used before the seam existed; the seam changes where
 * they are read, not what they are.
 */
import type { CarveModality, ModalityWords } from '../../enroll/modality';
import type { FeatureVector } from '../../enroll/types';
import { FACE_FEATURES } from '../face_catalog';
import { FACE_TRAINING_GROUPS, faceCollects } from '../face_groups';
import { generalFaceLabeling } from '../face_labels';

const PREFIX = 'face.';

const FACE_WORDS: ModalityWords = {
  one: 'face',
  many: 'faces',
  part: 'face',
  slug: 'faces',
  category: 'expression',
  neutral: 'neutral',
  fallback: (i) => `expression ${i + 1}`,
};

const DESCRIPTION_BY_ID = new Map(FACE_FEATURES.map((f) => [f.id, f.description ?? f.id]));

const keep = (key: string): boolean => key.startsWith(PREFIX);

export const faceModality: CarveModality = {
  id: 'face',
  words: FACE_WORDS,
  groups: FACE_TRAINING_GROUPS,
  collects: () => faceCollects(),
  /** The `face.*` keys, or null when no face feature is finite (no face in view). */
  read(merged: FeatureVector): FeatureVector | null {
    let seen = false;
    const out: FeatureVector = {};
    for (const [k, x] of Object.entries(merged)) {
      if (!keep(k)) continue;
      out[k] = x;
      if (Number.isFinite(x)) seen = true;
    }
    return seen ? out : null;
  },
  keep,
  general: () => generalFaceLabeling(),
  /** Both grow as the face comes closer; the scale first. */
  nuisance: { distance: ['face.head.scale', 'face.head.distanceProxy'] },
  describe: (featureId, sign) => `${sign > 0 ? 'more' : 'less'}: ${DESCRIPTION_BY_ID.get(featureId) ?? featureId}`,
};
