/**
 * Is the room too dark to carve in? (#348)
 *
 * A dim, noisy room moves a categorizer's features a lot (28 noise units at about -1.5 EV, 59 at
 * -2.5 EV; `docs/research/face-categorizer-lighting-and-distance.md`) and no dial can subtract it,
 * so the answer is a warning, not a setting. The reading is the mean luma (0..255) of the part's
 * crop; the measurement's studio-lit clip reads about 84 at one EV darker and 51 / 29 at the two
 * dim variants, so the line sits between. The judge needs a few readings in a row on one side of
 * its band before it changes its mind (a passing hand or a cloud is not a dark room) and the
 * bands do not overlap (no flicker around the line). Pure and modality-free.
 */

/** The band and the patience, as data. */
export const LIGHT_DEFAULTS = {
  /** Luma below which the room reads as dark. */
  dimBelow: 65,
  /** Luma above which it reads as lit again (above `dimBelow`: the hysteresis). */
  litAbove: 75,
  /** Readings in a row, past the line, before the judgement changes. */
  readings: 3,
} as const;

/** Mean luma (Rec. 601) of RGBA pixels, 0..255; null when there are none. */
export function meanLuma(rgba: ArrayLike<number>): number | null {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return null;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += 0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2];
  return sum / n;
}

export interface LightJudge {
  /** One more reading (null: no frame to read, which changes nothing); the judgement after it. */
  push(luma: number | null): boolean;
  /** Whether the room is judged too dark now. */
  readonly dark: boolean;
  reset(): void;
}

export function createLightJudge(options: Partial<typeof LIGHT_DEFAULTS> = {}): LightJudge {
  const o = { ...LIGHT_DEFAULTS, ...options };
  let dark = false;
  let streak = 0;
  return {
    push(luma) {
      if (luma === null || !Number.isFinite(luma)) return dark;
      const crossing = dark ? luma > o.litAbove : luma < o.dimBelow;
      streak = crossing ? streak + 1 : 0;
      if (streak >= o.readings) {
        dark = !dark;
        streak = 0;
      }
      return dark;
    },
    get dark() {
      return dark;
    },
    reset() {
      dark = false;
      streak = 0;
    },
  };
}

/** What the status line says. */
export const DARK_ROOM_MESSAGE = 'Too dark: add light, or record again in this light';
