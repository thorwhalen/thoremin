/**
 * The face session's live strip (#404) and the take's holds: the strip's cards, stills and
 * stick figures, the paused ghost, the take's samples, the names given in the strip and the
 * labelled holds a carve places. A concern of `createFaceSessionStore` (#746).
 */
import { liveStrip } from '@thoremin/sdk/enroll/bars';
import { type StripCardView, FACE_SESSION_DEFAULTS } from './state';
import { holdId } from '../thumbnails';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { FaceTake } from '../../lib/take';
import type { SampleInput, PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { type LabelledHolds, placeWith } from '@thoremin/sdk/enroll/sorting';
import { labelledHoldsOf, leanPairs, type LabelledResult, holdAllInCategory, withLabelsPlaced } from '../holdGroups';
import type { SessionCtx } from './locals';

/** The strip concern over the store's shared state. */
export function createStrip(ctx: SessionCtx) {
  const { deps, get, loc, modality, modalityOnly, set } = ctx;
  /** A new take's strip: nothing deleted, named or shown yet. */
  const clearStrip = () => {
    loc.dropped.clear();
    loc.holdNames.clear();
    loc.holdSides.clear();
    loc.lastMirrored = null;
    loc.keptIdx = [];
    loc.stripKey = '';
    loc.stripFigures.clear();
    loc.ghostAt = Number.NEGATIVE_INFINITY;
    set({ strip: [], stripOnce: [], ghost: null });
  };
  /** A hold's picture for the strip: its still once encoded, else its stick figure. */
  const stripThumb = (index: number, id: string): string | null => {
    let url = loc.urls.get(id);
    const still = url ? undefined : loc.stills.get(id);
    if (still) loc.urls.set(id, (url = URL.createObjectURL(still)));
    if (url) return url;
    if (!deps.figure || !modality.skeleton || !loc.take) return null;
    if (!loc.stripFigures.has(id)) {
      const point = loc.take.session().points()[index];
      const skeleton = point ? modality.skeleton(point.vector) : null;
      const fig = skeleton ? deps.figure(skeleton) : null;
      if (!fig) return null;
      loc.stripFigures.set(id, fig);
    }
    return loc.stripFigures.get(id) ?? null;
  };
  /** The live strip (#404) from the bars' online carve, set only when what it shows changed. */
  const refreshStrip = () => {
    const phase = get().phase;
    if (!loc.take || !loc.bars || !loc.takeId || (phase !== 'faces' && phase !== 'paused')) {
      if (loc.stripKey !== '') {
        loc.stripKey = '';
        set({ strip: [], stripOnce: [] });
      }
      return;
    }
    const tid = loc.takeId;
    const labels = loc.take.labels();
    const nameOf = (i: number): string => (loc.holdNames.get(i) ?? labels.get(i) ?? '').trim();
    // A named hold goes where Stop puts it: with the holds of its name (pinned there), whatever
    // the carve says; the carve's groups keep the unnamed ones.
    const byName = new Map<string, number[]>();
    const clusters = loc.bars
      .carve()
      .map((c) =>
        c.flatMap((p) => {
          const i = loc.keptIdx[p];
          if (i === undefined) return [];
          const name = nameOf(i).toLowerCase();
          if (!name) return [i];
          byName.set(name, [...(byName.get(name) ?? []), i]);
          return [];
        }),
      )
      .concat([...byName.values()]);
    const { cards, once } = liveStrip(clusters);
    const strip: StripCardView[] = cards.map((c) => ({ n: c.index + 1, like: c.like === null ? null : c.like + 1, name: nameOf(c.index) || null, thumb: stripThumb(c.index, holdId(tid, c.index)) }));
    const stripOnce = once.map((i) => i + 1);
    // The change key without the pictures' text (a stick figure is a data URL of kilobytes).
    const key = `${strip.map((c) => `${c.n}:${c.like ?? ''}:${c.name ?? ''}:${c.thumb ? c.thumb.length : 0}`).join('|')}/${stripOnce.join(',')}`;
    if (key === loc.stripKey) return;
    loc.stripKey = key;
    set({ strip, stripOnce });
  };
  /** While paused and a hold is forming, what it would be (#404), carved at most every
   *  `ghostMs`; null otherwise. */
  const refreshGhost = (vector: FeatureVector | null, tMs: number) => {
    const s = get();
    const forming =
      s.phase === 'paused' && (s.hold === 'settling' || s.hold === 'taken') && vector !== null && loc.bars !== null && loc.keptIdx.length > 0 && loc.keptIdx.length <= FACE_SESSION_DEFAULTS.ghostUpTo;
    if (!forming) {
      if (s.ghost !== null) set({ ghost: null });
      loc.ghostAt = Number.NEGATIVE_INFINITY;
      return;
    }
    if (tMs - loc.ghostAt < FACE_SESSION_DEFAULTS.ghostMs && s.ghost !== null) return;
    loc.ghostAt = tMs;
    const joins = loc.bars!.wouldBe(vector!);
    // Said in the strip's terms: the card it would join, by that card's group leader (one more
    // point can split a group, and the ghost must not contradict the cards).
    const first = joins ? Math.min(...joins.map((p) => loc.keptIdx[p])) + 1 : null;
    const card = first === null ? undefined : s.strip.find((c) => c.n === first);
    const like = first === null ? null : (card?.like ?? first);
    if (s.ghost?.like !== like || s.ghost === null) set({ ghost: { like } });
  };
  /** The take's holds, as the samples a categorizer is made of: their ids, the modality's
   *  keys only, and their supporting frames. */
  const takeSamples = (t: FaceTake, tid: string): SampleInput[] =>
    t
      .session()
      .points()
      .map((p, i) => ({ ...p, id: holdId(tid, i), vector: modalityOnly(p.vector), support: t.support(i), skeleton: modality.skeleton?.(p.vector) ?? null, mirrored: loc.holdSides.get(i) }));
  /** The take's labelled holds (#385 E7: bursts under a typed name), by name, as sample ids. */
  /** The take's holds by name: a burst's, or one given in the strip. */
  const holdNamesOf = (t: FaceTake): Map<number, string> => {
    // A name given in the strip (#404) is a burst's name given afterwards: it wins over one.
    const names = new Map(t.labels());
    for (const [i, name] of loc.holdNames) names.set(i, name);
    return names;
  };
  const labelledHolds = (t: FaceTake, tid: string): LabelledHolds[] => labelledHoldsOf(holdNamesOf(t), loc.dropped, tid);
  /** `r` with each lean's holds (#349) put and pinned where the hold they leaned on is. */
  const withLeans = <R extends { categorizer: PersonalCategorizer }>(r: R, t: FaceTake, tid: string): R => {
    const placed = placeWith(r.categorizer, leanPairs(t.leans(), loc.dropped, tid));
    return placed.ok ? { ...r, categorizer: placed.categorizer } : r;
  };
  /** `labelled` with every hold of the take that has no name of its own (and was not deleted in
   *  the strip) moved to category `id` and pinned there (#435). */
  const holdAllIn = (labelled: LabelledResult, t: FaceTake, tid: string, id: string): LabelledResult =>
    holdAllInCategory(labelled, { names: holdNamesOf(t), dropped: loc.dropped, count: t.pointCount(), takeId: tid, to: id });
  /** `c` with the take's labelled holds placed and pinned (unchanged when there are none). */
  const withLabels = (c: PersonalCategorizer, groups: readonly LabelledHolds[]): LabelledResult =>
    withLabelsPlaced(c, groups, { neutralLabel: modality.words.neutral, maxCategories: FACE_SESSION_DEFAULTS.maxCategories });
  return { clearStrip, stripThumb, refreshStrip, refreshGhost, takeSamples, holdNamesOf, labelledHolds, withLeans, holdAllIn, withLabels };
}
