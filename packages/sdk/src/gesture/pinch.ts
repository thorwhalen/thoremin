/**
 * The pinch as a state machine, not a threshold (#815): whether one hand is pinching, the frame
 * it started and stopped, where the pen went down and where it lifted, and how hard it pinches.
 *
 * Why a machine: a continuous `pinch` feature exists (`hand-features`) and the gesture
 * classifier turns it into a pose with hysteresis, but a stroke drawn from either starts and
 * ends with a hook. The confirming gesture moves the very point being aimed with (the
 * "Heisenberg effect" measured for hand input in VR), a dropped frame splits a stroke in two,
 * and a value sitting on the threshold chatters. So, per hand, one frame at a time:
 *
 * - **Hysteresis**: pinched below `on`, released above `off` (lower distance = more pinched).
 * - **Adaptive exit** (Meta's grab spec: release 2 cm above the tightest distance seen): the
 *   release threshold is `max(off, rMin + exitMargin)`, `rMin` the closest distance during this
 *   pinch, so a loose pinch that barely closed still needs the fingers to open by a margin.
 * - **Debounce on the edge only**: a new state must hold `onFrames` / `offFrames` present frames
 *   before it switches. Nothing continuous (strength, anchors) is delayed by it.
 * - **Tracking-loss grace**: a dropout shorter than `lossGraceS` neither releases nor re-presses
 *   (for ink, a stroke split by a 2-frame dropout is worse than one that lingers 150 ms); longer,
 *   the pinch is released where the hand was last seen.
 * - **One observation per camera frame**: a reading stamped at or before the last one is not an
 *   observation (the state is repeated, nothing advances). The engine ticks at 60 Hz over a 30 fps
 *   camera, so a node sees each frame twice; counted twice, a one-frame spike would satisfy a
 *   2-frame debounce.
 * - **Anchor look-back**: the `down` anchor is the position from before the fingers began to
 *   close: the last moment they read as open (distance at or above `off`), but never further back
 *   than `lookBackS` before the detection. Interpolated in time between samples.
 * - **Tail trim**: the mirror image on `up`. The stroke ends at the last moment the fingers still
 *   read as closed (at or below `on`), at most `trimS` before the detection and never before the
 *   pinch began. The `up` output's contract, for a normal release and a tracking loss alike:
 *   drop the stroke's samples AFTER `trimFrom`, then end the stroke at `anchor`.
 * - **Strength**: 0..1 from the distance, the same map as `hand-features`' `pinch` (touching
 *   1, apart 0), a free pressure channel. Held through a grace dropout.
 *
 * Credit: the debounce, hysteresis, grace and look-back started as thoremin-ar's
 * `createPinchTracker` (its `src/lib/pinch.ts`, used by Drawn Pieces). Changed here: the
 * thresholds are core's (below), the look-back stops at the closing onset and interpolates
 * instead of taking the first sample inside the window, and the adaptive exit, the tail trim,
 * the strength, a loss detected on a late present frame and the Zod params are new. Design
 * and sources: thoremin-ar `docs/research/02-draw-and-move-with-a-webcam.md` sections 2.2-2.3.
 *
 * Pure and Node-safe: no DOM, no clock (the caller passes capture times in SECONDS, the engine's
 * unit, `frameTime`'s, `gesture/strum`'s and `createOneEuro2D`'s).
 */
import { z } from 'zod';
import { clamp01 } from '@thoremin/stats';

/**
 * The thresholds and timings, as a schema so they can become dials. Distances are thumb-index
 * tip distance over the hand's scale (wrist to middle knuckle, `hand-features`' `handScale`).
 */
export const PinchParamsSchema = z
  .object({
    /**
     * Pinched below this distance. 0.63 is the gesture classifier's `pinchOn` (pinch 0.6) read
     * back through `hand-features`' 0.25..1.2 map: 1.2 - 0.6 x 0.95. thoremin-ar's Drawn Pieces
     * uses a tighter 0.32 for drawing; which is right is the footage's question (#819).
     */
    on: z.number().positive().default(0.63),
    /** Released above this distance: the classifier's `pinchOff` (pinch 0.45), 1.2 - 0.45 x 0.95 = 0.7725. */
    off: z.number().positive().default(0.7725),
    /**
     * The adaptive exit's margin over the tightest distance of this pinch, in the same distance
     * units (thumb-index over hand scale). 0.2 is Meta's grab spec (2 cm above the minimum, on a
     * 1.6 / 3 cm band of 1.4 cm) scaled to the DEFAULT band (0.14): 0.14 x 2 / 1.4; retune it
     * with the band. Below `off - on` it never changes anything. Capped so `on + exitMargin`
     * stays under `strengthApart`: the release threshold never exceeds `max(off, on + exitMargin)`,
     * so a tracked hand opened to "apart" always releases.
     */
    exitMargin: z.number().min(0).default(0.2),
    /** Present frames the pinched state must hold before `down` (2: one frame of latency, 33 ms at 30 fps; the research note's 1 to 2 for drawing). */
    onFrames: z.number().int().min(1).default(2),
    /** Present frames the released state must hold before `up`. */
    offFrames: z.number().int().min(1).default(2),
    /** A dropout shorter than this neither releases nor re-presses, s (the research note's 150 ms). */
    lossGraceS: z.number().min(0).default(0.15),
    /** How far before the detection the `down` anchor may reach, s (the issue's 100 ms; Drawn Pieces used 80). */
    lookBackS: z.number().min(0).default(0.1),
    /** How far before the detection the `up` tail may be trimmed, s (the research note's "2 to 3 frames"; 0.1 = 3 at 30 fps). */
    trimS: z.number().min(0).default(0.1),
    /** Distance read as strength 1 (touching): `hand-features`' `pinchTouch`. */
    strengthTouch: z.number().min(0).default(0.25),
    /** Distance read as strength 0 (apart): `hand-features`' `pinchApart`. */
    strengthApart: z.number().positive().default(1.2),
  })
  .refine((p) => p.off > p.on, { message: 'off must be greater than on (the hysteresis band)', path: ['off'] })
  // Release needs max(off, rMin + exitMargin) below strengthApart: off is bounded here, the margin below.
  .refine((p) => p.off < p.strengthApart, { message: 'off must stay below strengthApart, or a hand opened to "apart" could never release', path: ['off'] })
  .refine((p) => p.strengthApart > p.strengthTouch, { message: 'strengthApart must be greater than strengthTouch', path: ['strengthApart'] })
  .refine((p) => p.on + p.exitMargin < p.strengthApart, {
    message: 'on + exitMargin must stay below strengthApart, or a tracked hand opened to "apart" could never release',
    path: ['exitMargin'],
  });

export type PinchParams = z.infer<typeof PinchParamsSchema>;
export type PinchParamsInput = z.input<typeof PinchParamsSchema>;
export const PINCH_DEFAULTS: PinchParams = PinchParamsSchema.parse({});

/**
 * One frame of one hand. Push ONE reading per camera frame: a reading stamped at or before the
 * last one is ignored (no observation), which absorbs the engine's 60 Hz ticks over a 30 fps camera
 * in real time. In replay `frameTime` returns tick times, so a node must also dedupe by frame
 * identity (the conductor's `conductor_frame_dedupe` pattern) before pushing. An absence reading
 * (`present: false`) moves the last stamp too, so it must carry the same clock as the present ones
 * (the frame's capture time, not the tick's), or the next real frame can be swallowed.
 */
export interface PinchReading {
  /** The hand is tracked this frame. When false the other fields are ignored. */
  present: boolean;
  /** Thumb-index tip distance over the hand's scale. */
  distance?: number;
  /** The anchor point (the pinch midpoint for ink, the palm centre for grabbing), any units. */
  x?: number;
  y?: number;
  /** Capture time, seconds (increasing; a repeat or a step back is not an observation). */
  t: number;
}

export type PinchEdge = 'down' | 'up' | null;

export interface PinchOutput {
  state: 'up' | 'down';
  /** The frame the state switched, at most one per frame. */
  edge: PinchEdge;
  /** On `down`: where the pen went down. On `up`: where it lifted. Absent otherwise. */
  anchor?: { x: number; y: number };
  /**
   * On `up` (a normal release or a tracking loss): the capture time, s, of the last sample that
   * still belongs to the stroke. Drop the samples AFTER `trimFrom`, then end the stroke at `anchor`.
   */
  trimFrom?: number;
  /** 0 apart .. 1 touching. */
  strength: number;
}

export interface PinchState {
  push(reading: PinchReading): PinchOutput;
  readonly state: 'up' | 'down';
  reset(): void;
}

interface Sample {
  t: number;
  r: number;
  x: number;
  y: number;
}

/**
 * Slack on the grace comparison, s: stamps on a 60 fps grid are not exact in floating point
 * ((k + 9) / 60 - k / 60 is 0.15000000000000002 for some k), and a nominal 150 ms gap must not
 * release by rounding. A microsecond is far below any camera's frame spacing.
 */
const TIME_EPSILON_S = 1e-6;

const isSeen = (r: PinchReading): r is Required<PinchReading> =>
  r.present && Number.isFinite(r.distance) && Number.isFinite(r.x) && Number.isFinite(r.y);

/** One hand's pinch. `params` are validated (a bad band throws at once). */
export function createPinchState(params: PinchParamsInput = {}): PinchState {
  const p = PinchParamsSchema.parse(params);
  const window = Math.max(p.lookBackS, p.trimS);
  const grace = p.lossGraceS + TIME_EPSILON_S;
  let down = false;
  let streak = 0;
  let streakMin = Infinity;
  let rMin = Infinity;
  let downT = -Infinity;
  let lastSeen = -Infinity;
  let lastT = -Infinity;
  let lastStrength = 0;
  let strength = 0;
  let history: Sample[] = [];

  const strengthOf = (r: number) => clamp01((p.strengthApart - r) / (p.strengthApart - p.strengthTouch));

  /** The position at time `t`, linear between the samples around it (the oldest before it). */
  function positionAt(t: number): { x: number; y: number } {
    const first = history[0]!;
    if (t <= first.t) return { x: first.x, y: first.y };
    for (let i = 1; i < history.length; i++) {
      const b = history[i]!;
      if (b.t < t) continue;
      const a = history[i - 1]!;
      const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) };
    }
    const last = history[history.length - 1]!;
    return { x: last.x, y: last.y };
  }

  /** The time of the last sample before the current one that passes `test`, or -Infinity. */
  function lastTime(test: (s: Sample) => boolean): number {
    for (let i = history.length - 2; i >= 0; i--) if (test(history[i]!)) return history[i]!.t;
    return -Infinity;
  }

  function clearStreak() {
    streak = 0;
    streakMin = Infinity;
  }

  /** Released by tracking loss: the stroke ends where the hand was last seen. */
  function lose(): PinchOutput {
    const last = history[history.length - 1];
    down = false;
    clearStreak();
    rMin = Infinity;
    strength = 0;
    const out: PinchOutput = { state: 'up', edge: 'up', strength, trimFrom: lastSeen };
    if (last) out.anchor = { x: last.x, y: last.y };
    history = [];
    return out;
  }

  /** One observation (a reading stamped after the last one). */
  function step(reading: PinchReading): PinchOutput {
    const t = reading.t;
    if (!isSeen(reading)) {
      if (t - lastSeen <= grace) return { state: down ? 'down' : 'up', edge: null, strength: down ? strength : 0 };
      if (down) return lose();
      clearStreak();
      strength = 0;
      return { state: 'up', edge: null, strength };
    }

    // A present frame after a gap longer than the grace (frames that never arrived): the old
    // pinch is over and the old positions are stale. One edge per frame, so this frame only
    // starts the debounce of the next state.
    let lost: PinchOutput | null = null;
    if (t - lastSeen > grace) {
      if (down) lost = lose();
      else {
        clearStreak();
        history = [];
      }
    }

    const r = reading.distance;
    lastSeen = t;
    history.push({ t, r, x: reading.x, y: reading.y });
    while (history.length > 2 && history[1]!.t < t - window) history.shift();
    strength = strengthOf(r);
    if (lost) {
      if (r < p.on) {
        streak = 1;
        streakMin = r;
      }
      return { ...lost, strength: 0 };
    }

    const releaseAt = Math.max(p.off, rMin + p.exitMargin);
    const wants = down ? r <= releaseAt : r < p.on;
    if (down) rMin = Math.min(rMin, r);
    if (wants === down) {
      clearStreak();
      return { state: down ? 'down' : 'up', edge: null, strength };
    }
    streak += 1;
    streakMin = Math.min(streakMin, r);
    if (streak < (down ? p.offFrames : p.onFrames)) return { state: down ? 'down' : 'up', edge: null, strength };

    if (!down) {
      down = true;
      rMin = streakMin;
      downT = t;
      clearStreak();
      const anchorT = Math.max(t - p.lookBackS, lastTime((s) => s.r >= p.off));
      return { state: 'down', edge: 'down', anchor: positionAt(anchorT), strength };
    }
    down = false;
    rMin = Infinity;
    clearStreak();
    const trimFrom = Math.max(t - p.trimS, downT, lastTime((s) => s.r < p.on));
    return { state: 'up', edge: 'up', anchor: positionAt(trimFrom), trimFrom, strength };
  }

  return {
    push(reading) {
      // A frame pushed twice (two ticks over one camera frame) or a stamp that steps back: the
      // last output's state and strength again, no edge, nothing advanced.
      // A non-finite stamp is no observation either, and never becomes the last stamp (a far-future
      // one would silence the machine until a reset).
      if (!Number.isFinite(reading.t) || !(reading.t > lastT)) return { state: down ? 'down' : 'up', edge: null, strength: lastStrength };
      lastT = reading.t;
      const out = step(reading);
      lastStrength = out.strength;
      return out;
    },
    get state() {
      return down ? 'down' : 'up';
    },
    reset() {
      down = false;
      clearStreak();
      rMin = Infinity;
      downT = -Infinity;
      lastSeen = -Infinity;
      lastT = -Infinity;
      lastStrength = 0;
      strength = 0;
      history = [];
    },
  };
}

/** Several hands' pinches, by key. */
export interface PinchStates {
  push(hand: string, reading: PinchReading): PinchOutput;
  state(hand: string): 'up' | 'down';
  /** Forget one hand, or all of them. */
  reset(hand?: string): void;
}

/** One {@link PinchState} per hand, by any key (`'Left'` / `'Right'`, a track id), created on first use. */
export function createPinchStates(params: PinchParamsInput = {}): PinchStates {
  const parsed = PinchParamsSchema.parse(params);
  const hands = new Map<string, PinchState>();
  const of = (hand: string): PinchState => {
    let s = hands.get(hand);
    if (!s) hands.set(hand, (s = createPinchState(parsed)));
    return s;
  };
  return {
    push: (hand: string, reading: PinchReading): PinchOutput => of(hand).push(reading),
    state: (hand: string): 'up' | 'down' => hands.get(hand)?.state ?? 'up',
    reset(hand?: string) {
      if (hand === undefined) hands.clear();
      else hands.delete(hand);
    },
  };
}
