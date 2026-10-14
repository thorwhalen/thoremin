/**
 * A saved categorizer made ready to PLAY in an instrument (#330 P4), and the reading the
 * instrument's chord renderer consumes.
 *
 * The renderer (`expression-chord`) was written for the general model's seven expressions. A
 * personal categorizer reaches it as the same `ExpressionScores`, with the player's own
 * categories alongside (`personal`), and each category STANDS IN for one expression:
 *
 *  1. "none of these" (a face nearest the taught Neutral, #385 E5, or beyond the reject radius)
 *     stands in for `neutral`, which plays silence by default, like a resting face on the
 *     general model; in an older file whose every face was a category, the resting category
 *     (named `neutral`, as that carve named it) does;
 *  2. a category named after an expression (the carve's one-to-one match, or a player who chose
 *     that word) stands in for it; the others are matched one-to-one among the expressions left
 *     (the matcher of P1, `matchLabels` over `generalFaceLabeling`, scored exactly as the carve
 *     scores: full-space means of the saved faces);
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
import { memberIndices, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { generalFaceLabeling } from '@thoremin/sdk/features/face_labels';
import { ABSENT_EXPRESSION, EMOTIONS, type Emotion, type ExpressionLabel, type ExpressionScores } from '@thoremin/sdk/music/expression';
import { isNeutralLabel } from '@thoremin/sdk/enroll/modality';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { fullMean } from './carving';
import { liveModel, type LiveModel, type Tuning } from '@thoremin/sdk/enroll/live';

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
 * The resting category of a file whose every face is a category (strangers read as the nearest
 * face; before #385 E5 the rest was carved as a category), by index, or -1: the one named
 * `neutral`, which the carve names it (by its faces) and P3's tuning reads it by. A saved file
 * keeps no resting faces of its own, so a player who renames it has made it a face like any
 * other: it then stands in for an expression, and they can silence it per category.
 */
export function neutralCategoryIndex(categorizer: PersonalCategorizer): number {
  if (categorizer.strangers !== 'nearest') return -1;
  return categorizer.categories.findIndex((c) => isNeutralLabel(faceModality, c.label));
}

/**
 * The expression each category stands in for (see the module header), in category order. The
 * same match that named the categories: a category NAMED after an expression (the carve's match,
 * or the player's own choice of that word) stands in for it; the rest are matched one-to-one
 * among the expressions left, on the same full-space means the carve scores
 * (`fullMean` over the saved samples), so a face the carve called "angry" plays angry's chord.
 */
export function standsForOf(categorizer: PersonalCategorizer): ExpressionLabel[] {
  const neutral = neutralCategoryIndex(categorizer);
  const out: (ExpressionLabel | null)[] = categorizer.categories.map((_, i) => (i === neutral ? 'neutral' : null));
  const taken = new Set<Emotion>();
  categorizer.categories.forEach((c, i) => {
    const named = EMOTIONS.find((e) => e === c.label.trim().toLowerCase());
    if (out[i] === null && named && !taken.has(named)) {
      out[i] = named;
      taken.add(named);
    }
  });
  const vectors = categorizer.samples.map((x) => x.vector);
  const members = memberIndices(categorizer);
  const open = categorizer.categories.flatMap((c, i) => (out[i] === null ? [{ i, id: c.id, label: '', centroid: fullMean(vectors, members[i]) }] : []));
  const labeling = generalFaceLabeling();
  const matches = matchLabels(open, { ...labeling, labels: EMOTIONS.filter((e) => !taken.has(e)), keepExisting: false });
  matches.forEach((m, r) => {
    if (m.matched) {
      out[open[r].i] = m.matched;
      taken.add(m.matched);
    }
  });
  const spare = EMOTIONS.filter((e) => !taken.has(e));
  return out.map((x) => x ?? spare.shift() ?? 'neutral');
}

/** A saved categorizer, resolved to play: its live model under its own tuning, and what each
 *  category stands in for. */
export function categorizerPlay(record: { id: string; name: string; categorizer: PersonalCategorizer; tuning?: Partial<Tuning> }): FaceCategorizerPlay {
  const live = liveModel(record.categorizer, record.tuning ?? {});
  return { id: record.id, name: record.name, live, standsFor: standsForOf(record.categorizer) };
}

/**
 * No reading (no face, or too few of its features) from `play`'s categorizer: absent, and
 * named as its own, so the readout says "none of these" rather than the general model's
 * `neutral` (#330 P6).
 */
export function absentReading(play: FaceCategorizerPlay): ExpressionScores {
  const cats = play.live.model.categories;
  return {
    ...ABSENT_EXPRESSION,
    scores: cats.map(() => 0),
    thresholds: cats.map(() => 0),
    fired: cats.map(() => false),
    personal: { categorizer: play.id, id: null, name: null, ids: cats.map((c) => c.id), names: cats.map((c) => c.label), standsFor: play.standsFor },
  };
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
      categorizer: play.id,
      id: index >= 0 ? cats[index].id : null,
      name: index >= 0 ? cats[index].label : null,
      ids: cats.map((c) => c.id),
      names: cats.map((c) => c.label),
      standsFor: play.standsFor,
    },
  };
}
