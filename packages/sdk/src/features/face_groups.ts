/**
 * Which face features a training take attends to, in one place for every face trainer:
 * the trainer's starter cues (`src/app/enroll/starterCues.ts`) and the personal categorizer
 * session (`@thoremin/ext-faces`, #330) both build their cues' `collects` from these, so a
 * face category means the same features whichever tool made it.
 *
 * In the SDK (not beside the starter cues) because an extension imports only the SDK; the
 * enrolment core (`../enroll`) stays modality-free, and the face-specific choice lives here
 * with the face catalog it reads.
 */
import { FEATURE_GROUPS } from './catalog';

/**
 * The face groups a training take records. Everything the catalog measures on a face
 * EXCEPT the two gaze families: eye-direction is mostly involuntary and noisy, and a
 * category the player cannot hold is not a category.
 */
export const FACE_TRAINING_GROUPS: readonly string[] = FEATURE_GROUPS.filter(
  (g) => g.source === 'face' && g.id !== 'derived' && !g.id.endsWith('.gaze') && g.id !== 'face.gaze',
).map((g) => g.id);

/**
 * Raw frame position and size are where you SIT, not what you DO: left out of every
 * face cue, so a player who shifts in their chair between cues does not teach the
 * model that "a bit to the left" is an expression. (Camera distance is handled
 * separately, by demonstration — see the trainer's nuisance cue.)
 */
export const FACE_OMIT: readonly string[] = ['face.head.x', 'face.head.y', 'face.head.scale', 'face.head.distanceProxy'];

/** A face cue's `collects`: the given groups (all of {@link FACE_TRAINING_GROUPS} by default)
 *  minus {@link FACE_OMIT}. */
export const faceCollects = (groups: readonly string[] = FACE_TRAINING_GROUPS): { groups: string[]; omit: string[] } => ({
  groups: [...groups],
  omit: [...FACE_OMIT],
});
