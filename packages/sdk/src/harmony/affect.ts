/**
 * Valence and arousal as harmonic controls (H7 of #613, `docs/design/harmonic-layers.md` §5.4):
 * two continuous readings of the face, put where the evidence puts them. Valence (smile minus
 * frown) changes the MODE: the parallel major or minor of the key, the main valence rule of
 * Livingstone's rule system, and a link listeners hear within about 200 ms. Arousal (an open
 * mouth, raised brows) changes the COLOUR, not the chord: AffectMachine found arousal chose no
 * chord and drove density, so here it adds the key's tensions (the seventh, then the ninth).
 *
 * Read from the player's own rest by default (`createRestBaseline`, #673): what each control
 * reads at rest, and how much it wanders, is learned and taken away first, so resting brows that
 * sit high, or a furrow the lighting makes, read as nothing.
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

/** The face controls a baseline learns (every `FaceFeatures` number). */
const CONTROLS = ['smile', 'mouthOpen', 'browRaise', 'browFurrow', 'eyeBlink'] as const;

export interface RestBaselineOptions {
  /** How fast a control's rest creeps up toward a level held above it, per second (a fraction of
   *  the gap): slow, so a smile held for seconds is not learned as the face at rest. */
  rise?: number;
  /** A control's own jitter, as an exponential mean of its frame-to-frame change, times this, is
   *  how far above rest it must be before it counts (the noise units of the trainer). */
  jitterK?: number;
  /** The jitter's smoothing per reading (0..1). */
  jitterSmoothing?: number;
}

export interface RestBaseline {
  /** One reading of the face (dt: seconds since the last): the same controls, each measured
   *  above the player's own rest and jitter (0 at rest), and absent while the face is. */
  push(face: FaceFeatures | undefined, dt: number): FaceFeatures | undefined;
  reset(): void;
}

/**
 * The player's own face at rest (#673): what each control reads when nothing is meant, and how much
 * it wanders. Resting brows already read 0.2 to 0.5 on the face fixture, a furrow can come from the
 * lighting, and absolute thresholds would read either as an expression. Each control's rest falls at
 * once to anything lower and rises slowly toward a level held above it; what counts is the part
 * above rest plus `jitterK` of its own jitter, so a resting face reads nothing on every control,
 * whatever this player's face and room. Pure.
 */
export function createRestBaseline({ rise = 0.02, jitterK = 2, jitterSmoothing = 0.1 }: RestBaselineOptions = {}): RestBaseline {
  const rest: Partial<Record<(typeof CONTROLS)[number], number>> = {};
  const jitter: Partial<Record<(typeof CONTROLS)[number], number>> = {};
  const last: Partial<Record<(typeof CONTROLS)[number], number>> = {};
  return {
    push(face, dt) {
      if (!face?.present) return face;
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const out: FaceFeatures = { ...face };
      for (const k of CONTROLS) {
        const v = face[k];
        if (!Number.isFinite(v)) continue;
        const r = rest[k];
        rest[k] = r === undefined || v < r ? v : r + (v - r) * Math.min(1, rise * step);
        // Measured against the jitter learned so far, then the jitter learns this frame's change.
        out[k] = Math.max(0, v - (rest[k] ?? v) - jitterK * (jitter[k] ?? 0));
        const prev = last[k];
        if (prev !== undefined) jitter[k] = (jitter[k] ?? 0) + jitterSmoothing * (Math.abs(v - prev) - (jitter[k] ?? 0));
        last[k] = v;
      }
      return out;
    },
    reset() {
      for (const k of CONTROLS) {
        delete rest[k];
        delete jitter[k];
        delete last[k];
      }
    },
  };
}
