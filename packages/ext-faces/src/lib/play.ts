/**
 * A saved categorizer made ready to PLAY in an instrument (#330 P4), and the reading the
 * instrument's chord renderer consumes.
 *
 * The renderer (`expression-chord`) was written for the general model's seven expressions. A
 * personal categorizer reaches it as the same `ExpressionScores`, with the player's own
 * categories alongside (`personal`), and each category STANDS IN for one expression:
 *
 *  1. in partition mode, the resting category (named `neutral`, as the carve names it) stands
 *     in for `neutral`, which plays silence by default, like a resting face on the general
 *     model; in reject mode "none of these" does;
 *  2. the others are matched one-to-one with the general model's expressions (the matcher of
 *     P1, `matchLabels` over `generalFaceLabeling`, the player's names ignored: the match is
 *     about the faces, not what they were called);
 *  3. a category the general model does not recognise takes the next expression no other
 *     category took, in `EMOTIONS` order, so every category plays a different chord by default;
 *     past seven, `neutral`.
 *
 * So the defaults come from the matcher, and the chord a category plays defaults to the one the
 * instrument already gives the expression it stands in for. The player overrides it per
 * category (the `faceCategorizer.degrees` dial).
 *
 * Pure: no store, no DOM.
 */
import { matchLabels } from '@thoremin/sdk/enroll/match';
import { modelFromCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { TrainedModel } from '@thoremin/sdk/enroll/types';
import { generalFaceLabeling } from '@thoremin/sdk/features/face_labels';
import { EMOTIONS, type Emotion, type ExpressionLabel, type ExpressionScores } from '@thoremin/sdk/music/expression';
import { NEUTRAL_LABEL } from './carving';
import { liveModel, type LiveModel, type Tuning } from './live';

/** A categorizer resolved for the DAG: what the `face-categorizer` node reads (a transient). */
export interface FaceCategorizerPlay {
  /** The saved record's id: the instrument's dial names it, and the node plays this model
   *  only while the dial still does (a switch never plays the previous one). */
  id: string;
  name: string;
  live: LiveModel;
  /** The expression each category stands in for, aligned with `live.model.categories`. */
  standsFor: ExpressionLabel[];
}

/**
 * The partition-mode category that is the resting face, by index, or -1: the one named
 * `neutral`, which the carve names it (by its faces) and P3's tuning reads it by. A saved file
 * keeps no resting faces of its own, so a player who renames it has made it a face like any
 * other: it then stands in for an expression, and they can silence it per category.
 */
export function neutralCategoryIndex(categorizer: PersonalCategorizer): number {
  if (categorizer.mode !== 'partition') return -1;
  return categorizer.categories.findIndex((c) => c.label.trim().toLowerCase() === NEUTRAL_LABEL);
}

/** The expression each category stands in for (see the module header), in category order. */
export function standsForOf(categorizer: PersonalCategorizer, model: TrainedModel = modelFromCategorizer(categorizer)): ExpressionLabel[] {
  const neutral = neutralCategoryIndex(categorizer);
  const out: (ExpressionLabel | null)[] = model.categories.map((_, i) => (i === neutral ? 'neutral' : null));
  const open = model.categories.filter((_, i) => out[i] === null);
  const matches = matchLabels(
    open.map((c) => ({ id: c.id, label: '', centroid: c.centroid })),
    { ...generalFaceLabeling(), keepExisting: false },
  );
  const taken = new Set<Emotion>();
  const byId = new Map(matches.map((m) => [m.id, m.matched]));
  model.categories.forEach((c, i) => {
    const m = byId.get(c.id);
    if (out[i] === null && m) {
      out[i] = m;
      taken.add(m);
    }
  });
  const spare = EMOTIONS.filter((e) => !taken.has(e));
  return out.map((x) => x ?? spare.shift() ?? 'neutral');
}

/** A saved categorizer, resolved to play: its live model under its own tuning, and what each
 *  category stands in for. */
export function categorizerPlay(record: { id: string; name: string; categorizer: PersonalCategorizer; tuning?: Partial<Tuning> }): FaceCategorizerPlay {
  const live = liveModel(record.categorizer, record.tuning ?? {});
  return { id: record.id, name: record.name, live, standsFor: standsForOf(record.categorizer, live.model) };
}

/**
 * One frame's reading as the renderer's `ExpressionScores`: `label` the expression the settled
 * category stands in for (`neutral` for none of these), `scores` each category's membership,
 * `fired` the settled one, and `personal` the player's categories.
 */
export function toExpressionScores(
  play: FaceCategorizerPlay,
  reading: { categoryId: string | null; memberships: Readonly<Record<string, number>> },
): ExpressionScores {
  const cats = play.live.model.categories;
  const index = reading.categoryId === null ? -1 : cats.findIndex((c) => c.id === reading.categoryId);
  return {
    present: true,
    label: index >= 0 ? (play.standsFor[index] ?? 'neutral') : 'neutral',
    scores: cats.map((c) => reading.memberships[c.id] ?? 0),
    thresholds: cats.map(() => 0),
    fired: cats.map((_, i) => i === index),
    personal: {
      id: index >= 0 ? cats[index].id : null,
      name: index >= 0 ? cats[index].label : null,
      ids: cats.map((c) => c.id),
      names: cats.map((c) => c.label),
      standsFor: play.standsFor,
    },
  };
}
