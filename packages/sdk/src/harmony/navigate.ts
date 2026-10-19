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
 *   it (H2's review); `createBeatWalk` repeats a held move once per beat (H11), on the
 *   instrument's own tempo until musical time reaches the commits (H9).
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

export interface StepperOptions {
  /** How many wedges (moves) the radial layout has. */
  wedges: number;
  /** The dead zone around the centre, in the displacement's units: inside it nothing is chosen. */
  dead: number;
  /** How far out a displacement must reach to choose a wedge, in the same units (past `dead`). */
  reach: number;
  /** Camera frames a wedge must be pointed at in a row before its move commits. */
  enterFrames: number;
}

export interface StepChoice {
  /** The wedge pointed at now (reaching or not), or null in the dead zone or with no point. */
  pointing: number | null;
  /** The wedge whose move committed on this frame, or null. */
  committed: number | null;
  /** Ready for a move: the point has come back to the centre since the last one. */
  armed: boolean;
}

export interface DirectionStepper {
  /** One camera frame: the displacement from the layout's centre (null when the point is not seen). */
  push(v: { dx: number; dy: number } | null): StepChoice;
  reset(): void;
}

/**
 * The commit policy for a radial ("next chord") layout: a displacement reaching into a wedge for
 * `enterFrames` frames commits that wedge's move once, and the stepper is then disarmed until the
 * point comes back into the dead zone. Return to the centre, push toward a move: one move per
 * push, so a hand held out does not keep walking, and the layout recentring under the hand never
 * re-triggers (the design's pairing rule for dynamic layouts).
 */
export function createDirectionStepper(opts: StepperOptions): DirectionStepper {
  let armed = true;
  let candidate: number | null = null;
  let count = 0;
  return {
    push(v) {
      if (!v) {
        candidate = null;
        count = 0;
        return { pointing: null, committed: null, armed };
      }
      const r = Math.hypot(v.dx, v.dy);
      const pointing = directionIndex(v, opts.wedges, opts.dead);
      if (pointing === null) {
        armed = true;
        candidate = null;
        count = 0;
        return { pointing, committed: null, armed };
      }
      if (!armed || r < opts.reach) {
        candidate = null;
        count = 0;
        return { pointing, committed: null, armed };
      }
      count = pointing === candidate ? count + 1 : 1;
      candidate = pointing;
      if (count >= opts.enterFrames) {
        armed = false;
        candidate = null;
        count = 0;
        return { pointing, committed: pointing, armed };
      }
      return { pointing, committed: null, armed };
    },
    reset() {
      armed = true;
      candidate = null;
      count = 0;
    },
  };
}

export interface CategoryStepperOptions {
  /** Frames a new category must be read in a row before it commits. */
  enterFrames: number;
  /** The category that is "no choice" (a neutral face): reading it re-arms the stepper. */
  rest: string | null;
}

export interface CategoryStepper {
  /** One reading (null: nothing read). Returns the category that committed on this reading, or null. */
  push(category: string | null): string | null;
  reset(): void;
}

/**
 * The commit policy for a categorical navigator that MOVES (a face expression mapped to a move on
 * a chord wheel): a category read `enterFrames` times in a row commits once, and nothing more
 * commits until the reading has come back to rest (a neutral face, or nothing read). One move per
 * expression, as the direction stepper makes one move per push.
 */
export function createCategoryStepper(opts: CategoryStepperOptions): CategoryStepper {
  let armed = true;
  let candidate: string | null = null;
  let count = 0;
  return {
    push(category) {
      if (category === null || category === opts.rest) {
        armed = true;
        candidate = null;
        count = 0;
        return null;
      }
      if (!armed) return null;
      count = category === candidate ? count + 1 : 1;
      candidate = category;
      if (count < opts.enterFrames) return null;
      armed = false;
      candidate = null;
      count = 0;
      return category;
    },
    reset() {
      armed = true;
      candidate = null;
      count = 0;
    },
  };
}

export interface BeatWalkStep {
  /** The wedge whose move the stepper committed on this frame, or null. */
  committed: number | null;
  /** The wedge pointed at now (outside the dead zone), or null. */
  pointing: number | null;
  /** The frame's time, seconds. */
  now: number;
  /** The walk's period, seconds (a beat, or several); not positive: no walk. */
  periodS: number;
}

export interface BeatWalk {
  /** One frame: the wedge whose move repeats now, or null. */
  push(s: BeatWalkStep): number | null;
  /** Whether a held push is walking (its move will repeat on the next beat). */
  walking(): boolean;
  reset(): void;
}

/**
 * Walk a cycle on the beat (H11 of #613): after a push commits a move, holding the hand out in
 * the same wedge repeats that move once per period, so a held fourth walks the cycle of fourths
 * (all seven chords of the key), a held third the cycle of thirds, a held second the scale. The
 * beats are counted from the first move, so the walk keeps the time the player set by pushing;
 * a frame late past a beat (the camera's period) makes the move on that frame and the grid
 * holds, while a gap longer than a period re-anchors it rather than catching up in a burst.
 * Leaving the wedge ends the walk; the stepper's own rule (back to the centre) starts the next.
 */
/** A frame this close before a beat is on it (a frame's time is a float sum of periods). */
const BEAT_EPS_S = 1e-3;

export function createBeatWalk(): BeatWalk {
  let walking: number | null = null;
  let next = Infinity;
  return {
    push({ committed, pointing, now, periodS }) {
      if (committed !== null) {
        walking = committed;
        next = now + periodS;
        return null;
      }
      if (walking === null || pointing !== walking || !(periodS > 0)) {
        walking = null;
        return null;
      }
      if (now < next - BEAT_EPS_S) return null;
      next = now - next >= periodS ? now + periodS : next + periodS;
      return walking;
    },
    walking: () => walking !== null,
    reset() {
      walking = null;
      next = Infinity;
    },
  };
}
