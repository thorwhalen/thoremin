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
  /** What re-arms after a commit: only the rest (a face goes back to neutral between moves, the
   *  default), or also a different category held long enough (signed letters, which pass from one
   *  to the next without a rest in between). */
  rearm?: 'rest' | 'change';
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
 * expression, as the direction stepper makes one move per push. With `rearm: 'change'`, a
 * different category held `enterFrames` commits too, without a rest between (the one just made
 * still waits for a rest or another category first).
 */
export function createCategoryStepper(opts: CategoryStepperOptions): CategoryStepper {
  let armed = true;
  let candidate: string | null = null;
  let count = 0;
  let made: string | null = null;
  return {
    push(category) {
      if (category === null || category === opts.rest) {
        armed = true;
        candidate = null;
        count = 0;
        made = null;
        return null;
      }
      if (!armed && !(opts.rearm === 'change' && category !== made)) {
        candidate = null;
        count = 0;
        return null;
      }
      count = category === candidate ? count + 1 : 1;
      candidate = category;
      if (count < opts.enterFrames) return null;
      armed = false;
      candidate = null;
      count = 0;
      made = category;
      return category;
    },
    reset() {
      armed = true;
      candidate = null;
      count = 0;
      made = null;
    },
  };
}

export interface BeatWalkStep {
  /** The wedge whose move the stepper committed on this tick, or null. */
  committed: number | null;
  /** The wedge pointed at (null: the dead zone, or no hand). */
  pointing: number | null;
  /** Whether the hand is seen (a hand lost for a moment does not end a walk). */
  seen: boolean;
  /** The tick's time, seconds. */
  now: number;
  /** The figuration clock's beat at the end of this tick (`Realizer.beat` plus this tick's). */
  beat: number;
  /** Beats per step; not positive: no walk. */
  beats: number;
}

export interface BeatWalk {
  /** One tick: the wedge whose move repeats now, or null. */
  step(s: BeatWalkStep): number | null;
  /** Whether a held push is walking (its move will repeat on a coming beat). */
  walking(): boolean;
  reset(): void;
}

/** A beat this close ahead is reached (a beat count is a float sum of ticks). */
const BEAT_EPS = 1e-6;
/** How long a hand may be lost and still hold its walk (a dropped tracking frame or three). */
export const WALK_GRACE_S = 0.15;

/**
 * Walk a cycle on the beat (H11 of #613): after a push commits a move, holding the hand out in
 * the same wedge repeats that move on the figuration's beats, every `beats`, so a held fourth
 * walks the cycle of fourths (all seven chords of the key), a held third the cycle of thirds, a
 * held second the scale. The moves land on the beat the player hears: the caller passes the
 * realizer's own beat count and checks every tick (not every camera frame), so a change sounds
 * within a tick of the beat. The first repeat is the first step boundary at least half a step
 * after the push; a missed beat (a stall) is skipped, never made up in a burst, and the grid
 * stays. A hand lost for under `WALK_GRACE_S` keeps walking; pointing elsewhere ends it at once.
 */
export function createBeatWalk(): BeatWalk {
  let walking: number | null = null;
  let next = Infinity;
  let lastSeen = -Infinity;
  const end = (): null => {
    walking = null;
    return null;
  };
  return {
    step({ committed, pointing, seen, now, beat, beats }) {
      if (!(beats > 0)) return end();
      if (committed !== null) {
        walking = committed;
        next = Math.ceil((beat + beats / 2) / beats) * beats;
        lastSeen = now;
        return null;
      }
      if (walking === null) return null;
      if (seen) {
        if (pointing !== walking) return end();
        lastSeen = now;
      } else if (now - lastSeen > WALK_GRACE_S) return end();
      // The beat went back (a song restarted, a seek): the next step boundary from where it is.
      // (Right after a push the target may be one step past that boundary; more is a jump.)
      const boundary = (Math.floor((beat + BEAT_EPS) / beats) + 1) * beats;
      if (next > boundary + beats + BEAT_EPS) next = boundary;
      if (beat + BEAT_EPS < next) return null;
      next = (Math.floor((beat + BEAT_EPS) / beats) + 1) * beats;
      return walking;
    },
    walking: () => walking !== null,
    reset() {
      walking = null;
      next = Infinity;
      lastSeen = -Infinity;
    },
  };
}
