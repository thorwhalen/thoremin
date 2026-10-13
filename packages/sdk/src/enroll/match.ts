/**
 * Default names for learned categories, one-to-one (#330): which label a general model
 * would give each category, with no label given twice.
 *
 * ## Why a global assignment, not a per-category argmax
 *
 * A player's personal categories are carved from their own take, so two of them can sit
 * close to the same general-model prototype: a smile and a smile with the mouth open both
 * score "happy" first. Naming each category by its own best label then gives two
 * categories the same name, and a name is what a binding is carried by (`carryBindings`
 * drops a name two categories share). So the labels are assigned GLOBALLY: the assignment
 * of labels to categories that maximises the total score, each label used at most once.
 * That is the rectangular assignment problem, solved exactly by the Hungarian algorithm
 * ({@link assignMax}); `optimalExpressionToDegree` in `music/expression.ts` brute-forces
 * the square 7x7 case of the same problem, which does not scale past a handful of labels.
 *
 * ## A label is earned, not handed out
 *
 * A category whose best available score is below `minScore` gets a FALLBACK name
 * ("category 3") rather than a label the general model does not actually believe. Scores
 * under the bar are treated as zero BEFORE the assignment, so a weak pair can neither win a
 * label nor distort the optimum for the others. `minScore` may be one number or one per
 * label (the face scorer passes the general model's own firing thresholds, so a category
 * is called "happy" only if the general model would fire "happy" on its centroid).
 *
 * ## The player's names win
 *
 * These are defaults. A category that already carries a label keeps it (`keepExisting`,
 * on by default), and that label leaves the pool, so re-cutting k after the player named
 * some categories proposes names only for the rest.
 *
 * Generic over modality: the labels and the score function are inputs. A face host passes
 * the expression scorer from `features/face_labels.ts`; a hand host passes its own.
 */
import type { Category, FeatureVector, TrainedModel } from './types';

/**
 * The maximum-total-score assignment of rows to columns of a rectangular matrix, each row
 * and each column used at most once. Returns, per row, its column (or -1 when there are
 * more rows than columns and the row got none). Exact (Hungarian algorithm with
 * potentials, O(n^2 m)); deterministic for a given matrix. Non-finite entries count as 0,
 * and finite ones are clamped to +/-{@link SCORE_LIMIT} so no cost can overflow.
 */
/** The magnitude scores are clamped to: far beyond any real score, far below overflow. */
export const SCORE_LIMIT = 1e150;

export function assignMax(score: readonly (readonly number[])[]): number[] {
  const rows = score.length;
  const cols = rows === 0 ? 0 : Math.max(...score.map((r) => r.length));
  if (rows === 0 || cols === 0) return new Array(rows).fill(-1);
  const at = (i: number, j: number): number => {
    const x = score[i][j];
    return Number.isFinite(x) ? Math.max(-SCORE_LIMIT, Math.min(SCORE_LIMIT, x)) : 0;
  };
  // The algorithm below needs n <= m; transpose otherwise and invert the answer.
  const transposed = rows > cols;
  const n = transposed ? cols : rows;
  const m = transposed ? rows : cols;
  let top = -Infinity;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) top = Math.max(top, at(i, j));
  // Minimise cost = top - score (non-negative), 1-indexed as in the textbook form.
  const cost = (i: number, j: number): number => (transposed ? top - at(j - 1, i - 1) : top - at(i - 1, j - 1));

  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0); // p[j] = row matched to column j
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost(i0, j) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      // Unreachable with finite, clamped costs; a guard so a bad input cannot spin forever.
      if (!Number.isFinite(delta) || j1 === 0) break;
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const out = new Array<number>(rows).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] === 0) continue;
    if (transposed) out[j - 1] = p[j] - 1;
    else out[p[j] - 1] = j - 1;
  }
  return out;
}

/** What the matcher needs of a category. */
export type MatchableCategory = Pick<Category, 'id' | 'label' | 'centroid'>;

export interface LabelMatchOptions<L extends string = string> {
  /** The label pool (each used at most once). */
  labels: readonly L[];
  /** The general model's score of each label for a category's centroid (higher = better;
   *  a missing label scores 0). */
  score: (centroid: FeatureVector, category: MatchableCategory) => Partial<Record<L, number>>;
  /** The score a label must reach to be given: one bar, or one per label. */
  minScore?: number | Partial<Record<L, number>>;
  /** The name of a category that earns no label, by its position (0-based). */
  fallback?: (index: number) => string;
  /** A category that already has a label keeps it, and that label leaves the pool. */
  keepExisting?: boolean;
}

export const LABEL_MATCH_DEFAULTS = {
  minScore: 0.3,
  fallback: (i: number) => `category ${i + 1}`,
  keepExisting: true,
} as const;

/** How one category got its name. */
export interface LabelMatch<L extends string = string> {
  id: string;
  /** The name to show (and the default the player edits). */
  label: string;
  /** `kept`: the player's own; `matched`: from the general model; `fallback`: positional. */
  source: 'kept' | 'matched' | 'fallback';
  /** The general model's label when `matched`, else null. */
  matched: L | null;
  /** The general model's score for the matched label, else null. */
  score: number | null;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Propose a name for every category: kept, matched one-to-one from the label pool, or a
 * fallback. Every matched or fallback name is unique (case-insensitively, ignoring
 * surrounding space) and differs from every kept name: the pool is de-duplicated, and a
 * fallback that would collide gets a numeric suffix. Kept names are the player's and are
 * returned as they are, even two the player made equal. Order follows `categories`.
 */
export function matchLabels<L extends string>(
  categories: readonly MatchableCategory[],
  options: LabelMatchOptions<L>,
): LabelMatch<L>[] {
  const keep = options.keepExisting ?? LABEL_MATCH_DEFAULTS.keepExisting;
  const fallback = options.fallback ?? LABEL_MATCH_DEFAULTS.fallback;
  const minScore = options.minScore ?? LABEL_MATCH_DEFAULTS.minScore;
  const bar = (l: L): number => (typeof minScore === 'number' ? minScore : (minScore[l] ?? LABEL_MATCH_DEFAULTS.minScore));

  const out: (LabelMatch<L> | null)[] = categories.map((c) =>
    keep && c.label.trim() ? { id: c.id, label: c.label, source: 'kept', matched: null, score: null } : null,
  );
  const taken = new Set(out.filter((x): x is LabelMatch<L> => x !== null).map((x) => norm(x.label)));
  const pool: L[] = [];
  for (const l of options.labels) {
    if (!l.trim() || taken.has(norm(l)) || pool.some((p) => norm(p) === norm(l))) continue;
    pool.push(l);
  }
  const open = categories.map((_, i) => i).filter((i) => out[i] === null);

  // Scores below the bar are inadmissible: zeroed before the assignment. A score at or over
  // the bar but not positive (a negative bar) is zeroed too: it could never be given.
  const raw = open.map((i) => options.score(categories[i].centroid, categories[i]));
  const matrix = raw.map((s) =>
    pool.map((l) => {
      const x = s[l] ?? 0;
      return Number.isFinite(x) && x >= bar(l) ? Math.max(0, x) : 0;
    }),
  );
  const assignment = assignMax(matrix);
  open.forEach((i, r) => {
    const j = assignment[r];
    if (j >= 0 && matrix[r][j] > 0) {
      const l = pool[j];
      out[i] = { id: categories[i].id, label: l, source: 'matched', matched: l, score: raw[r][l] ?? 0 };
      taken.add(norm(l));
    }
  });

  return categories.map((c, i) => {
    const m = out[i];
    if (m) return m;
    const base = fallback(i);
    let name = base;
    for (let n = 2; taken.has(norm(name)); n++) name = `${base} (${n})`;
    taken.add(norm(name));
    return { id: c.id, label: name, source: 'fallback', matched: null, score: null };
  });
}

/** A copy of `model` with the matched names written into its categories' labels. */
export function applyLabels(model: TrainedModel, matches: readonly Pick<LabelMatch, 'id' | 'label'>[]): TrainedModel {
  const byId = new Map(matches.map((m) => [m.id, m.label]));
  return {
    ...model,
    categories: model.categories.map((c) => ({ ...c, label: byId.get(c.id) ?? c.label })),
  };
}
