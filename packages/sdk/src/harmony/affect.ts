/**
 * Valence and arousal as harmonic controls (H7 of #613, `docs/design/harmonic-layers.md` §5.4):
 * two continuous readings of the face, put where the evidence puts them. Valence (smile minus
 * frown) changes the MODE: the parallel major or minor of the key, the main valence rule of
 * Livingstone's rule system, and a link listeners hear within about 200 ms. Arousal (an open
 * mouth, raised brows) changes the COLOUR, not the chord: AffectMachine found arousal chose no
 * chord and drove density, so here it adds the key's tensions (the seventh, then the ninth).
 *
 * Both are levels, not raw numbers: a reading crosses an edge by a margin (hysteresis) and must
 * stay past it for a dwell before the level changes, so a passing smile does not modulate. The
 * weights are data (`AFFECT_WEIGHTS`), so a calibration swaps them without touching the code.
 * Pure: no DOM, no MediaPipe.
 */
import type { FaceFeatures } from '../nodes/domain';
import type { ScaleSpec, ScaleTypeId } from '../music/theory';

type FaceControl = Exclude<keyof FaceFeatures, 'present'>;

export interface AffectWeights {
  /** Valence: a signed sum of the face's controls, clamped to [-1, 1]. */
  valence: Partial<Record<FaceControl, number>>;
  /** Arousal: a weighted mean of the face's controls, 0..1. */
  arousal: Partial<Record<FaceControl, number>>;
}

/** Smile up, a furrowed brow down; the mouth open and the brows raised for arousal, the mouth
 *  weighted more because resting brows already read 0.2-0.5 on the face fixture. */
export const AFFECT_WEIGHTS: AffectWeights = {
  valence: { smile: 1, browFurrow: -1 },
  arousal: { mouthOpen: 0.6, browRaise: 0.4 },
};

/** The face's valence, -1..1 (null without a face). */
export function valenceOf(f: FaceFeatures | undefined, w: AffectWeights['valence'] = AFFECT_WEIGHTS.valence): number | null {
  if (!f?.present) return null;
  const v = (Object.entries(w) as [FaceControl, number][]).reduce((s, [k, x]) => s + x * f[k], 0);
  return Math.max(-1, Math.min(1, v));
}

/** The face's arousal, 0..1 (null without a face). */
export function arousalOf(f: FaceFeatures | undefined, w: AffectWeights['arousal'] = AFFECT_WEIGHTS.arousal): number | null {
  if (!f?.present) return null;
  const entries = Object.entries(w) as [FaceControl, number][];
  const total = entries.reduce((s, [, x]) => s + x, 0);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, entries.reduce((s, [k, x]) => s + x * f[k], 0) / total));
}

export interface LevelOptions {
  /** The edges between levels, ascending: n edges make n + 1 levels. */
  edges: readonly number[];
  /** How far past an edge a reading must go to cross it (from the level in force). */
  hysteresis: number;
  /** Seconds the readings must stay off the level in force before it changes (to the latest). */
  dwellS: number;
  /** The level with no reading (no face): reached after the same dwell. */
  rest: number;
}

export interface LevelTracker {
  /** One reading (null: none) at `now` seconds: the level in force. */
  push(value: number | null, now: number): number;
  /** A new dwell, keeping the level in force (a slider dragged must not modulate). */
  setDwell(dwellS: number): void;
  reset(): void;
}

/** A scalar to a level with hysteresis and a dwell. */
export function createLevelTracker({ edges, hysteresis, dwellS, rest }: LevelOptions): LevelTracker {
  let dwell = dwellS;
  let level = rest;
  /** When the readings first left the level in force (null: they are on it). */
  let away: number | null = null;
  /** The level a reading reaches from the one in force: an edge crossed only by the margin. */
  const reach = (v: number): number => {
    let l = level;
    while (l < edges.length && v > edges[l] + hysteresis) l++;
    while (l > 0 && v < edges[l - 1] - hysteresis) l--;
    return l;
  };
  return {
    push(value, now) {
      const want = value === null || !Number.isFinite(value) ? rest : reach(value);
      if (want === level) {
        away = null;
        return level;
      }
      // The dwell runs while the readings stay off the level in force, wherever they go (a
      // reading between two higher levels must not restart it); the level then is the latest.
      away ??= now;
      if (now - away >= dwell) {
        level = want;
        away = null;
      }
      return level;
    },
    setDwell(s) {
      dwell = s;
    },
    reset() {
      level = rest;
      away = null;
    },
  };
}

/** The darker and the brighter parallel of a seven-note key (absent: none, the key stays). A
 *  caller with another scale reads it through its seven-note key first (`letterChordSpec`). */
const DARKER: Partial<Record<ScaleTypeId, ScaleTypeId>> = { major: 'minor' };
const BRIGHTER: Partial<Record<ScaleTypeId, ScaleTypeId>> = { minor: 'major', minorHarmonic: 'major' };

/** The valence levels: below the low edge the darker parallel, above the high one the brighter,
 *  between them the key as it is. */
export const VALENCE_LEVELS = { darker: 0, key: 1, brighter: 2 } as const;

/** The key a valence level plays: the parallel mode on the same tonic, or the key itself. */
export function parallelSpec<S extends Pick<ScaleSpec, 'type'>>(spec: S, level: number): S {
  const to = level === VALENCE_LEVELS.darker ? DARKER[spec.type] : level === VALENCE_LEVELS.brighter ? BRIGHTER[spec.type] : undefined;
  return to ? { ...spec, type: to } : spec;
}
