/**
 * Navigation: how input features become a chosen target, and when the choice commits (H4 of
 * #613, `docs/design/harmonic-layers.md` §2.5). The pieces any navigator is made of:
 *
 * - SELECTORS, from a signal to a target index: the cell a point is over (`cellAt` in
 *   `./layout`), the wedge a displacement points into (`directionIndex`), the slot a swept scalar
 *   is in (`quantizeIndex`);
 * - COMMIT POLICIES, deciding when a selection takes effect: `createCellTracker` is the dwell
 *   policy (a few camera frames in a row, hysteresis at an edge, a release when the hand is lost).
 *   The strum's predicted commit is `ext-air`'s strum detector until the figuration seam can carry
 *   it (H2's review); a beat-quantized commit arrives with musical time (H9).
 *
 * Pure: the layout geometry only.
 */
import { cellAt, cellDistance, type Cell } from './layout';

export interface CellTrackerOptions {
  /** Camera frames a new cell must be selected in a row before it takes over. */
  enterFrames: number;
  /** How much nearer a new cell's centre must be than the selected one's, in cell widths, before
   *  it may take over: a hand resting on an edge does not flicker between two. */
  hysteresis: number;
  /** Seconds the selected cell is kept after the point leaves the layout or is lost. */
  releaseS: number;
}

export interface CellChoice {
  /** The cell in force, or null. */
  active: number | null;
  /** The cell the point is moving to, not yet in force, or null. */
  candidate: number | null;
}

export interface CellTracker {
  /** One camera frame: the point (null when not seen) at engine time `t`. */
  push(cells: readonly Cell[], p: { x: number; y: number } | null, t: number, aspect: number): CellChoice;
  reset(): void;
}

/** The dwell commit policy over a static layout's cells (the chord map's). */
export function createCellTracker(opts: CellTrackerOptions): CellTracker {
  let active: number | null = null;
  let candidate: number | null = null;
  let count = 0;
  let goneSince: number | null = null;
  return {
    push(cells, p, t, aspect) {
      const hit = p ? cellAt(cells, p, aspect) : null;
      if (!hit || !p) {
        candidate = null;
        count = 0;
        if (active !== null) {
          goneSince ??= t;
          if (t - goneSince >= opts.releaseS) {
            active = null;
            goneSince = null;
          }
        }
        return { active, candidate };
      }
      goneSince = null;
      if (hit.index === active) {
        candidate = null;
        count = 0;
        return { active, candidate };
      }
      if (active !== null && active < cells.length) {
        const held = cellDistance(cells[active], p, aspect);
        if (held - hit.distance < opts.hysteresis) {
          candidate = null;
          count = 0;
          return { active, candidate };
        }
      }
      count = hit.index === candidate ? count + 1 : 1;
      candidate = hit.index;
      if (count >= opts.enterFrames) {
        active = hit.index;
        candidate = null;
        count = 0;
      }
      return { active, candidate };
    },
    reset() {
      active = null;
      candidate = null;
      count = 0;
      goneSince = null;
    },
  };
}

/**
 * The wedge of `n` a displacement points into (wedge 0 straight up, clockwise, as `wedgeAngle`
 * lays them out), or null inside the dead zone (`dead`, in the displacement's own units). The
 * selector for a radial layout: a direction always means the same move.
 */
export function directionIndex(v: { dx: number; dy: number }, n: number, dead: number): number | null {
  if (n <= 0 || Math.hypot(v.dx, v.dy) <= dead) return null;
  // Clockwise from up: x to the right, y down (display coordinates).
  const a = Math.atan2(v.dx, -v.dy);
  const turn = (((a / (2 * Math.PI)) % 1) + 1) % 1;
  return Math.round(turn * n) % n;
}

/** The slot of `n` a scalar in [lo, hi] falls in (clamped): a head turn swept over seven degrees. */
export function quantizeIndex(value: number, n: number, lo = 0, hi = 1): number {
  if (n <= 0 || !Number.isFinite(value) || hi <= lo) return 0;
  const f = (value - lo) / (hi - lo);
  return Math.min(n - 1, Math.max(0, Math.floor(f * n)));
}
