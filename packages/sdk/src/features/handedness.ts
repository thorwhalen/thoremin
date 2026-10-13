/**
 * Handedness dwell — the one Left/Right hysteresis both hand readers share (#148).
 *
 * MediaPipe relabels a single physical hand Left -> Right -> Left when it turns (the
 * back of a hand looks like the other hand), for one or two frames at a time (measured in
 * #144, `video_hand_sweep` frames 61-62). A reader that keys by the raw per-frame label
 * splits one hand's stream across the two sides for those frames: the Lab's meters blank,
 * the instrument's voice swaps sides or drops to the absent-hand state.
 *
 * The tracker here is the dwell #144 shipped inside the Lab's `hand-feature-vector`,
 * extracted so the sound path (`hand-features`) runs the SAME code rather than a second
 * copy that drifts. The two paths diverged for a reason worth keeping in view: a dwell
 * trades flicker immunity for re-route latency on a GENUINE hand swap (`dwellFrames`
 * frames, ~100 ms at 30 fps for 3), and on the audio path that latency is audible, so
 * adopting it there is a musical decision, not a code one. The dwell is therefore a
 * per-call option, and the app exposes the sound path's value as a dial whose default
 * is {@link DEFAULT_HANDEDNESS_DWELL_FRAMES} = 0: the raw label, exactly what the
 * instrument has always played. The Lab keeps its own default (3). Raising the sound
 * path's default is the maintainer's call (#168, item 4), made by changing one constant.
 *
 * Semantics (pinned by `test/feature_vector_nodes.test.ts` and `test/handedness_dwell.test.ts`).
 * `dwellFrames` is what its name says: the number of frames a NEW label is held before
 * it takes over, so a dwell of N absorbs any relabel of up to N frames and delays a
 * genuine hand swap by exactly N frames (N/30 s at 30 fps). A non-finite value reads as 0.
 *
 *  - `dwellFrames` 0 is OFF: raw labels pass through and the tracker holds no memory
 *    (so a later non-zero dwell starts cold).
 *  - Exactly ONE hand detected: the returned side is a COMMITTED side; a new label is
 *    held for `dwellFrames` consecutive DETECTED single-hand frames and the assignment
 *    switches on the next one. Dropouts within the dwell window between those frames do
 *    not reset the count — detection confidence dips at exactly the moments labels flicker.
 *  - No hand: a dropout no longer than the dwell window keeps the assignment; a longer
 *    absence clears the tracker, so a genuinely new hand commits to its own label at once.
 *  - Two or more hands: raw labels pass through untouched (a sustained two-hand regime
 *    means MediaPipe disambiguated two real hands), and the single-hand tracker is cleared
 *    only after a FULL dwell window of consecutive multi-hand frames: a one-frame "second
 *    hand" is often a phantom duplicate of the same hand mid-turn, exactly the regime that
 *    flickers, and letting it wipe the tracker would reopen the bug through a rarer door.
 *
 * Pure over sides: the caller resolves each hand's raw side (`resolveSide`, so the selfie
 * mirror is orthogonal) and gets one committed side per hand back, in the same order.
 */
import type { HandSide } from './catalog';

/** The sound path's default and the dial's: 0 = the raw per-frame label (no hysteresis). */
export const DEFAULT_HANDEDNESS_DWELL_FRAMES = 0;
/** The largest dwell the dial and the node params accept (a second at 30 fps). */
export const MAX_HANDEDNESS_DWELL_FRAMES = 30;

export interface HandednessDwellOptions {
  /** Frames a new label is held before the side switches (the switch lands on the next
   *  frame); 0 = off (raw labels, no memory). Non-finite reads as 0. */
  dwellFrames?: number;
}

export interface HandednessDwell {
  /**
   * Advance one frame: the raw sides of every detected hand (empty when none) in, the
   * committed side of each hand out, same order. `options.dwellFrames` overrides the
   * tracker's own dwell for this frame (a live dial); the counters compare against
   * whatever the current dwell is, so lowering it live switches sooner, raising it later.
   */
  step(raw: readonly HandSide[], options?: HandednessDwellOptions): HandSide[];
  /** Forget the committed side and every counter (an unobserved stream, a disposed node). */
  reset(): void;
}

/** Build a handedness dwell tracker (stateful: a dwell is temporal). */
/** A dwell as given, or 0 for anything that is not a finite number (NaN would otherwise
 *  pin the first label forever: no count ever reaches it). */
const finiteDwell = (dwellFrames: number | undefined): number =>
  typeof dwellFrames === 'number' && Number.isFinite(dwellFrames) ? dwellFrames : DEFAULT_HANDEDNESS_DWELL_FRAMES;

export function createHandednessDwell(options: HandednessDwellOptions = {}): HandednessDwell {
  const defaultDwell = finiteDwell(options.dwellFrames);
  let committedSide: HandSide | null = null;
  let switchCount = 0; // consecutive DETECTED single-hand frames disagreeing with committedSide
  let absentCount = 0; // consecutive frames with no detected hand
  let multiCount = 0; // consecutive frames with 2+ detected hands

  const reset = (): void => {
    committedSide = null;
    switchCount = 0;
    absentCount = 0;
    multiCount = 0;
  };

  /** Dwell-filter the single-hand raw side into the committed side. */
  const commit = (raw: HandSide, dwellFrames: number): HandSide => {
    if (committedSide === null || raw === committedSide) {
      committedSide = raw;
      switchCount = 0;
    } else if (++switchCount > dwellFrames) {
      // Held for `dwellFrames` frames; this one is the switch.
      committedSide = raw;
      switchCount = 0;
    }
    return committedSide;
  };

  return {
    step(raw, stepOptions = {}) {
      const dwellFrames = stepOptions.dwellFrames === undefined ? defaultDwell : finiteDwell(stepOptions.dwellFrames);
      if (dwellFrames < 1) {
        // Off: the raw label, and no memory to go stale while the dial sits at 0.
        reset();
        return [...raw];
      }
      if (raw.length === 0) {
        if (++absentCount > dwellFrames) {
          committedSide = null;
          switchCount = 0;
        }
        multiCount = 0;
        return [];
      }
      absentCount = 0;
      if (raw.length === 1) {
        multiCount = 0;
        return [commit(raw[0], dwellFrames)];
      }
      if (++multiCount >= dwellFrames) {
        // A sustained (not phantom) multi-hand regime — see the module header.
        committedSide = null;
        switchCount = 0;
      }
      return [...raw];
    },
    reset,
  };
}
