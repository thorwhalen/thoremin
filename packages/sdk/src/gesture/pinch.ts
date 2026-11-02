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
 * - **Tracking-loss grace**: a dropout shorter than `lossGraceMs` neither releases nor re-presses
 *   (for ink, a stroke split by a 2-frame dropout is worse than one that lingers 150 ms); longer,
 *   the pinch is released where the hand was last seen.
 * - **Anchor look-back**: the `down` anchor is the position from before the fingers began to
 *   close: the last moment they read as open (distance at or above `off`), but never further back
 *   than `lookbackMs` before the detection. Interpolated in time between samples.
 * - **Tail trim**: the mirror image on `up`. The stroke ends at the last moment the fingers still
 *   read as closed (at or below `on`), at most `trimMs` before the detection and never before the
 *   pinch began; the `up` output's `trimFrom` says from when the stroke's samples were the
 *   release's motion and its `anchor` is where the pen lifted.
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
 * Pure and Node-safe: no DOM, no clock (the caller passes capture times in milliseconds).
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
    off: z.number().positive().default(0.77),
    /**
     * The adaptive exit's margin over the tightest distance of this pinch. 0.2 is Meta's grab
     * spec (2 cm above the minimum, on a 1.6 / 3 cm band of 1.4 cm) scaled to this band:
     * 0.14 x 2 / 1.4. Below `off - on` it never changes anything.
     */
    exitMargin: z.number().min(0).default(0.2),
    /** Present frames the pinched state must hold before `down` (2: one frame of latency, 33 ms at 30 fps; the research note's 1 to 2 for drawing). */
    onFrames: z.number().int().min(1).default(2),
    /** Present frames the released state must hold before `up`. */
    offFrames: z.number().int().min(1).default(2),
    /** A dropout shorter than this neither releases nor re-presses, ms (the research note's 150). */
    lossGraceMs: z.number().min(0).default(150),
    /** How far before the detection the `down` anchor may reach, ms (the issue's 100; Drawn Pieces used 80). */
    lookbackMs: z.number().min(0).default(100),
    /** How far before the detection the `up` tail may be trimmed, ms (the research note's "2 to 3 frames"; 100 = 3 at 30 fps). */
    trimMs: z.number().min(0).default(100),
    /** Distance read as strength 1 (touching): `hand-features`' `pinchTouch`. */
    strengthTouch: z.number().min(0).default(0.25),
    /** Distance read as strength 0 (apart): `hand-features`' `pinchApart`. */
    strengthApart: z.number().positive().default(1.2),
  })
  .refine((p) => p.off > p.on, { message: 'off must be greater than on (the hysteresis band)', path: ['off'] })
  .refine((p) => p.strengthApart > p.strengthTouch, { message: 'strengthApart must be greater than strengthTouch', path: ['strengthApart'] });

export type PinchParams = z.infer<typeof PinchParamsSchema>;
export type PinchParamsInput = z.input<typeof PinchParamsSchema>;
export const PINCH_DEFAULTS: PinchParams = PinchParamsSchema.parse({});

/** One frame of one hand. */
export interface PinchReading {
  /** The hand is tracked this frame. When false the other fields are ignored. */
  present: boolean;
  /** Thumb-index tip distance over the hand's scale. */
  distance?: number;
  /** The anchor point (the pinch midpoint for ink, the palm centre for grabbing), any units. */
  x?: number;
  y?: number;
  /** Capture time, ms (non-decreasing). */
  t: number;
}

export type PinchEdge = 'down' | 'up' | null;

export interface PinchOutput {
  state: 'up' | 'down';
  /** The frame the state switched, at most one per frame. */
  edge: PinchEdge;
  /** On `down`: where the pen went down. On `up`: where it lifted. Absent otherwise. */
  anchor?: { x: number; y: number };
  /** On `up`: the capture time (ms) from which the stroke's samples were the release (drop them). */
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

const isSeen = (r: PinchReading): r is Required<PinchReading> =>
  r.present && Number.isFinite(r.distance) && Number.isFinite(r.x) && Number.isFinite(r.y);

/** One hand's pinch. `params` are validated (a bad band throws at once). */
export function createPinchState(params: PinchParamsInput = {}): PinchState {
  const p = PinchParamsSchema.parse(params);
  const window = Math.max(p.lookbackMs, p.trimMs);
  let down = false;
  let streak = 0;
  let streakMin = Infinity;
  let rMin = Infinity;
  let downT = -Infinity;
  let lastSeen = -Infinity;
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

  return {
    push(reading) {
      const t = reading.t;
      if (!isSeen(reading)) {
        if (t - lastSeen <= p.lossGraceMs) return { state: down ? 'down' : 'up', edge: null, strength: down ? strength : 0 };
        if (down) return lose();
        clearStreak();
        strength = 0;
        return { state: 'up', edge: null, strength };
      }

      // A present frame after a gap longer than the grace (frames that never arrived): the old
      // pinch is over and the old positions are stale. One edge per frame, so this frame only
      // starts the debounce of the next state.
      let lost: PinchOutput | null = null;
      if (t - lastSeen > p.lossGraceMs) {
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
        const anchorT = Math.max(t - p.lookbackMs, lastTime((s) => s.r >= p.off));
        return { state: 'down', edge: 'down', anchor: positionAt(anchorT), strength };
      }
      down = false;
      rMin = Infinity;
      clearStreak();
      const trimFrom = Math.max(t - p.trimMs, downT, lastTime((s) => s.r < p.on));
      return { state: 'up', edge: 'up', anchor: positionAt(trimFrom), trimFrom, strength };
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
      strength = 0;
      history = [];
    },
  };
}

/** One {@link PinchState} per hand, by any key (`'Left'` / `'Right'`, a track id), created on first use. */
export function createPinchStates(params: PinchParamsInput = {}) {
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
