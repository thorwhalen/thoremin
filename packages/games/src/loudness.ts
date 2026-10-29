/**
 * Loudness as a position, 0 (soft) to 1 (loud), for a game that puts it on an axis (Pop the Notes).
 *
 * The problem is that one level means nothing across microphones and rooms: a laptop's microphone
 * in a quiet room and a phone held at arm's length in a kitchen differ by 30 dB. So by default the
 * scale is the PLAYER'S OWN: the quietest and loudest twentieth of what they sang over the last
 * half minute (`auto`). Whatever the microphone, both ends are reachable, because the ends are
 * where the player has been; it starts on a fixed range until it has heard two seconds of voice.
 * A fixed range (`soft`, `normal`, `loud`, in dB below full scale) is the manual setting, for a
 * player whose voice the automatic one keeps chasing.
 *
 * Unlike ictus's range normaliser (centred on the median, for expression), this maps the low and
 * high quantiles to the ends, which is what "reach the top balloon" needs.
 *
 * Pure: fed (time, rms) of voiced frames only.
 */
import { quantileSorted } from '@thoremin/stats/quantile';

export const LOUDNESS_MODES = ['auto', 'soft', 'normal', 'loud'] as const;
export type LoudnessMode = (typeof LOUDNESS_MODES)[number];

/** The fixed ranges, dB below full scale (the microphone with its processing off). */
export const LOUDNESS_RANGES: Record<Exclude<LoudnessMode, 'auto'>, { lowDb: number; highDb: number }> = {
  soft: { lowDb: -62, highDb: -32 },
  normal: { lowDb: -52, highDb: -22 },
  loud: { lowDb: -42, highDb: -12 },
};

export interface LoudnessOptions {
  mode?: LoudnessMode;
  /** The history the automatic range is read over, seconds. */
  windowS?: number;
  /** The quantiles that become 0 and 1. */
  lo?: number;
  hi?: number;
  /** The automatic range is never narrower than this, dB (widened about its middle). */
  minSpanDb?: number;
  /** Voice heard before the automatic range replaces the starting one, seconds. */
  warmupS?: number;
  /** Values are averaged into bins of this many seconds. */
  binS?: number;
}

export const LOUDNESS_DEFAULTS = { mode: 'auto' as LoudnessMode, windowS: 30, lo: 0.05, hi: 0.95, minSpanDb: 18, warmupS: 2, binS: 0.1 };

export interface LoudnessScale {
  /** Fold in a voiced frame's rms at time `t` and return its position, 0..1. */
  push(t: number, rms: number): number;
  /** A level's position on the current range, 0..1. */
  position(rms: number): number;
  /** The current range, dB. */
  range(): { lowDb: number; highDb: number };
}

export const dbOf = (rms: number): number => 20 * Math.log10(Math.max(rms, 1e-9));

export function createLoudnessScale(options: LoudnessOptions = {}): LoudnessScale {
  const o = { ...LOUDNESS_DEFAULTS, ...options };
  const fixed = o.mode === 'auto' ? null : LOUDNESS_RANGES[o.mode];
  let current = fixed ?? LOUDNESS_RANGES.normal;
  const bins: { t: number; db: number }[] = [];
  let binStart = NaN;
  let binSum = 0;
  let binN = 0;
  let voicedS = 0;

  const restat = () => {
    if (voicedS < o.warmupS || bins.length < 2) return;
    const sorted = bins.map((b) => b.db).sort((a, b) => a - b);
    let lowDb = quantileSorted(sorted, o.lo);
    let highDb = quantileSorted(sorted, o.hi);
    if (highDb - lowDb < o.minSpanDb) {
      const mid = (lowDb + highDb) / 2;
      lowDb = mid - o.minSpanDb / 2;
      highDb = mid + o.minSpanDb / 2;
    }
    current = { lowDb, highDb };
  };

  const position = (rms: number) => {
    const p = (dbOf(rms) - current.lowDb) / (current.highDb - current.lowDb);
    return p < 0 ? 0 : p > 1 ? 1 : p;
  };

  return {
    push(t, rms) {
      if (!fixed && rms > 0) {
        if (!Number.isFinite(binStart)) binStart = t;
        if (t - binStart >= o.binS && binN > 0) {
          bins.push({ t: binStart, db: binSum / binN });
          voicedS += o.binS;
          while (bins.length > 0 && bins[0].t < t - o.windowS) bins.shift();
          restat();
          binStart = t;
          binSum = 0;
          binN = 0;
        }
        binSum += dbOf(rms);
        binN++;
      }
      return position(rms);
    },
    position,
    range: () => current,
  };
}
