/**
 * Tension, always with the model that measured it (H10 of #613, `docs/design/harmonic-layers.md`
 * §3): "how tense is this chord here" has several answers that rank the chords differently, so no
 * number in thoremin is shown without the model's name beside it. Three models:
 *
 * - `function`: the functional ordering a theory class teaches (and the video's ladder): tonic
 *   chords rest, subdominants lean, dominants pull (I < vi, iii < IV, ii < V < vii°). Diatonic only.
 * - `tps`: Lerdahl's tonal pitch space distance from the key's tonic chord, δ = i + j + k (regions
 *   on the circle of fifths, chord roots on the circle of fifths, and the pitch classes of the
 *   chord's basic space that are new against the tonic's). In the key it is Lerdahl's own numbers
 *   (I to IV and V 5, to vi and iii 7, to ii and vii° 8); a chord outside the key is placed in the
 *   nearest major region that holds it (his principle of the shortest path).
 * - `profile`: the Krumhansl-Kessler key profile (probe-tone ratings, 1982): one minus the
 *   chord's mean rating over the tonic's, so a chord of well-fitting tones is calm.
 *
 * The three disagree on purpose: the profile hears V's leading tone and ranks ii calmer than V,
 * the functional ladder puts ii with IV, and Lerdahl puts ii further than V. Pure.
 */
import { diatonicChords, functionOf, parentKey, pitchClasses, type Chord, type Key } from './chord';
import { SCALE_TYPES } from '../music/theory';

export const TENSION_MODEL_IDS = ['function', 'tps', 'profile'] as const;
export type TensionModelId = (typeof TENSION_MODEL_IDS)[number];

export interface TensionModel {
  id: TensionModelId;
  /** The name a display shows beside every number it measures. */
  name: string;
  /** The tension of a chord heard in a key (larger: more tense), or null where the model has no
   *  opinion (the functional ladder outside the key). */
  tension(chord: Chord, key: Key): number | null;
}

const pc = (n: number): number => ((Math.round(n) % 12) + 12) % 12;

/** The functional ladder by degree (the video's, in major: I < vi, iii < IV, ii < V < vii°; in
 *  minor: i < VI, III < iv, ii°, VII < v). */
const FUNCTION_LADDER: readonly number[] = [0, 2, 1, 2, 3, 1, 4];
const FUNCTION_LADDER_MINOR: readonly number[] = [0, 2, 1, 2, 3, 1, 2];
const isMinorKey = (key: Key): boolean => SCALE_TYPES[parentKey(key).scale].intervals[2] === 3;

const functionModel: TensionModel = {
  id: 'function',
  name: 'Functional ladder (tonic, subdominant, dominant)',
  tension(chord, key) {
    const fn = functionOf(chord, key);
    if (!fn || fn.alter !== undefined || fn.of !== undefined) return null;
    const own = diatonicChords(key)[fn.degree];
    if (own.root !== chord.root || own.quality !== chord.quality) return null;
    return (isMinorKey(key) ? FUNCTION_LADDER_MINOR : FUNCTION_LADDER)[fn.degree];
  },
};

// ---- Lerdahl's tonal pitch space -------------------------------------------------------

/** Steps between two pitch classes on the circle of fifths. */
const fifths = (a: number, b: number): number => {
  const steps = pc((b - a) * 7);
  return Math.min(steps, 12 - steps);
};

/** A major region's pitch classes. */
const regionPcs = (tonic: number): Set<number> => new Set(SCALE_TYPES.major.intervals.map((i) => pc(tonic + i)));

/** The basic space of a chord in a region, level by level: root, root and fifth, the triad, the
 *  region's diatonic set (the chromatic level never differs). */
function basicSpace(chord: Chord, region: number): Set<number>[] {
  const tones = pitchClasses(chord);
  const fifth = tones.find((t) => pc(t - chord.root) === 7 || pc(t - chord.root) === 6) ?? tones[2] ?? chord.root;
  return [new Set([chord.root]), new Set([chord.root, fifth]), new Set(tones.slice(0, 3)), regionPcs(region)];
}

/** Steps between two roots on a region's diatonic circle of fifths (B to F counts as one). */
function diatonicFifths(a: number, b: number, region: number): number {
  const order = [0, 7, 2, 9, 4, 11, 5].map((i) => pc(region + i)); // C G D A E B F in C
  const ia = order.indexOf(pc(a));
  const ib = order.indexOf(pc(b));
  if (ia < 0 || ib < 0) return fifths(a, b);
  const d = Math.abs(ia - ib);
  return Math.min(d, 7 - d);
}

/** Lerdahl's δ from `from` in its region to `to`, over the nearest major region holding `to`. */
export function tpsDistance(from: Chord, fromRegion: number, to: Chord): number {
  const tones = pitchClasses(to);
  let best = Infinity;
  for (let r = 0; r < 12; r++) {
    const set = regionPcs(r);
    if (!tones.slice(0, 3).every((t) => set.has(t))) continue;
    const i = fifths(fromRegion, r);
    const j = i === 0 ? diatonicFifths(from.root, to.root, r) : fifths(from.root, to.root);
    const a = basicSpace(from, fromRegion);
    const b = basicSpace(to, r);
    const k = b.reduce((n, level, li) => n + [...level].filter((x) => !a[li].has(x)).length, 0);
    best = Math.min(best, i + j + k);
  }
  return best;
}

const tpsModel: TensionModel = {
  id: 'tps',
  name: "Lerdahl's tonal pitch space (distance from the tonic chord)",
  tension(chord, key) {
    // A minor key's region is its relative major's collection (Lerdahl's diatonic level).
    const parent = parentKey(key);
    const region = isMinorKey(key) ? pc(parent.tonic + 3) : parent.tonic;
    const tonic = diatonicChords(key)[0];
    const d = tpsDistance(tonic, region, chord);
    return Number.isFinite(d) ? d : null;
  },
};

// ---- Krumhansl-Kessler key profiles ---------------------------------------------------

/** Probe-tone ratings of the twelve pitch classes above a major and a minor tonic (1982). */
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88] as const;
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] as const;

const profileModel: TensionModel = {
  id: 'profile',
  name: 'Krumhansl-Kessler key profile (how well its notes fit the key)',
  tension(chord, key) {
    const profile = isMinorKey(key) ? KK_MINOR : KK_MAJOR;
    const tones = pitchClasses(chord);
    const mean = tones.reduce((s, t) => s + profile[pc(t - key.tonic)], 0) / tones.length;
    return Math.round((1 - mean / profile[0]) * 100) / 100;
  },
};

export const TENSION_MODELS: Readonly<Record<TensionModelId, TensionModel>> = { function: functionModel, tps: tpsModel, profile: profileModel };

/** A chord's tension as a display shows it: the number, or '' where the model has none. */
export function tensionText(model: TensionModel, chord: Chord, key: Key): string {
  const t = model.tension(chord, key);
  return t === null ? '' : String(t);
}

