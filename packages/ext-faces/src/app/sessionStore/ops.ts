/**
 * Two closure-free helpers of the face session store: a categorizer re-read with a hand, and
 * the rest frames' statistics the live bars measure from. Moved out of `../sessionStore.ts`.
 */
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { HandChoice } from '@thoremin/sdk/enroll/modality';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/** `c` reading `hand` (`either` is written as absent, as a fresh file writes it). */
export function withHand(c: PersonalCategorizer, hand: HandChoice): PersonalCategorizer {
  const { hand: _h, ...rest } = c;
  void _h;
  return hand === 'either' ? rest : { ...rest, hand };
}

/** The rest frames' mean and standard deviation over `ids` (raw units): what the bars measure
 *  from, and the neutral band they draw. */
export function restStats(vectors: readonly FeatureVector[], ids: readonly string[]): { mean: FeatureVector; spread: Record<string, number> } | null {
  if (vectors.length === 0) return null;
  const mean: FeatureVector = {};
  const spread: Record<string, number> = {};
  for (const id of ids) {
    const xs = vectors.map((v) => v[id]).filter((x): x is number => Number.isFinite(x));
    if (xs.length === 0) continue;
    const m = xs.reduce((a, x) => a + x, 0) / xs.length;
    mean[id] = m;
    spread[id] = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
  }
  return { mean, spread };
}
