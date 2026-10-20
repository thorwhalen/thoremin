/**
 * The air drum's hit and status contracts, and where each stands: a hit's lead against the
 * output stage, the sub-frame standing under noisy stamps, and the timing magnet's standing.
 * Moved out of `air_drum.ts`, which re-exports what it exported.
 */
import { z } from 'zod';
import { LAG_STROKES } from '@thoremin/ictus';
import { isClockDerived } from '@thoremin/sdk/nodes/domain';
import { DRUM_SOUNDS, PAD_IDS, type DrumSound, type PadId } from '@thoremin/sdk/nodes/music/drum_pads';

export type PlayerHand = 'right' | 'left';

/** Whether a hit's sound lands at its intended time: `yes` (the lead covers the audio
 *  output stage), `late` (it does not: the sound lands `lateBy` after the intended time),
 *  or `unknown-output` (the lead is not negative, but the output stage of this browser
 *  is not known: Safari before the first tap, fingerprinting protection; whether the
 *  lead covers it cannot be said, so neither `yes` nor `late` is). */
export const HIT_ON_TIME = ['yes', 'late', 'unknown-output'] as const;

export type HitOnTime = (typeof HIT_ON_TIME)[number];

/** One hit to sound. */
export interface DrumHit {
  /** When it should SOUND, engine seconds (in the future for a predicted hit; the
   *  confirming sample's time for a ghost note). Never before the decision. */
  t: number;
  /** The impact itself, engine seconds: the predicted impact for a predicted hit (before
   *  any pull), the confirmed one for a ghost note (whose `t` is the sounding time). What
   *  a beat follower may be fed; never `t`, which carries the pull and the clamp. */
  impactT: number;
  /** 0..1: how hard the stroke was (`velocityOf`) times the volume
   *  dial. The sink reads it for loudness AND tone (a harder hit is brighter). */
  velocity: number;
  hand: PlayerHand;
  sound: DrumSound;
  /** The pad struck, or null (no pad on, or a hit off every pad). */
  pad?: PadId | null;
  /** Where in the pad: 0 = the centre, 1 = the rim (0 without a pad). */
  radial?: number;
  /** The landing point in the displayed frame's fractions (`drum_pads.ts`'s space). */
  x?: number;
  y?: number;
  /** The stroke's mean downward speed over its fall, frame heights per second. */
  speed?: number;
  /** The stroke's size relative to the player's recent strokes, 0..1 (the predictor's). */
  strength?: number;
  /** The sound can land at its intended time: the lead covers the output stage (true),
   *  or it cannot (false: a ghost note, or a prediction whose lead the audio output
   *  eats). Equivalent to `onTime !== 'late'`. */
  predicted: boolean;
  /** The three-valued form of `predicted`: see {@link HitOnTime}. */
  onTime: HitOnTime;
  /** The INTENDED sounding time (the impact, pulled) minus the engine time at which it
   *  was decided, seconds, unclamped: negative when the intended time was already past at
   *  the decision (a ghost note, a pull toward a beat gone by). */
  lead: number;
  /** How far the sound lands after its intended time, seconds: 0 when on time; the
   *  shortfall of `lead` against the output stage otherwise. With an unknown stage
   *  (`unknown-output`, or `late` under the prior) only the certain part: how far the
   *  intended time was already past at the decision. */
  lateBy: number;
  /** The move actually made from the impact to the sounding time, seconds: the magnet's
   *  pull (or the pattern's snap), after the clamp to the decision time (0 without a
   *  running conductor or with magnetism 0). */
  pull: number;
}

export const DrumHitSchema = z.object({
  t: z.number(),
  impactT: z.number(),
  velocity: z.number(),
  hand: z.enum(['right', 'left']),
  sound: z.enum(DRUM_SOUNDS),
  predicted: z.boolean(),
  onTime: z.enum(HIT_ON_TIME),
  lead: z.number(),
  lateBy: z.number(),
  pull: z.number(),
  pad: z.enum(PAD_IDS).nullable().optional(),
  radial: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  speed: z.number().optional(),
  strength: z.number().optional(),
});

export const DrumHitsSchema = z.array(DrumHitSchema);

/** What the panel shows: the last hit and the running counts. */
export interface AirDrumStatus {
  enabled: boolean;
  /** Hits sounded since enabling. */
  hits: number;
  /** Of them, predicted ahead of the impact. */
  predicted: number;
  lastHand: PlayerHand | null;
  /** The pad the last hit struck, or null. */
  lastPad: PadId | null;
  /** The camera frame's width over its height (0 before a frame): the pad editor draws
   *  its stage in the same shape. */
  frameAspect: number;
  /** The last hit's lead in seconds (negative = a late ghost note). */
  lastLead: number;
  lastPull: number;
  /** The last hit's standing against the output stage, and how late its sound lands. */
  lastOnTime: HitOnTime;
  lastLateBy: number;
  /** Where the timing magnet stands (#239): see {@link MagnetStanding}. */
  magnet: MagnetStanding;
  /** The grid's measured offset from the strokes, seconds: the mean `impact - grid` over
   *  the last {@link LAG_STROKES} predicted strokes (positive = the grid runs EARLY, the
   *  strokes land after it; negative = it lags them; NaN before any), and the factor the
   *  lag gate scales a pull by, 0..1. */
  magnetLag: number;
  magnetGate: number;
  /** Whether each hand's floor has been learned (a first stroke has been seen). */
  ready: { right: boolean; left: boolean };
  /** Sub-frame prediction (#318): `on`, or `off-stamps` when the frame stamps are too
   *  noisy to carry it (strokes then sound when the camera shows them). */
  subframe: SubframeStanding;
  /** The stamp noise the standing was decided on, seconds (NaN when unknown). */
  stampNoise: number;
}

export type SubframeStanding = 'on' | 'off-stamps';

/** Clock-derived stamps noisier than this (seconds) switch sub-frame prediction off: the
 *  bench's 4 ms, where the learned-plane prediction is no better than the frame-snapped
 *  detector (`subframe-impact-prediction.md` §3.4). */
export const SUBFRAME_MAX_STAMP_NOISE_S = 0.004;

/** ...and under this, back on (hysteresis, so a noise near the bound does not flap). */
export const SUBFRAME_RESUME_STAMP_NOISE_S = 0.003;

/** A new standing is taken only after this many consecutive frames ask for it. */
export const SUBFRAME_DWELL_FRAMES = 15;

/** The sub-frame standing after this frame: `off-stamps` once the dominant stamps are
 *  clock-derived and noisier than the bound, `on` again once they are not, unchanged
 *  while the noise is unknown or between the two bounds. */
export function subframeStanding(prev: SubframeStanding, dominantSource: string | null, stampNoise: number): SubframeStanding {
  const derived = isClockDerived(dominantSource);
  if (!derived) return dominantSource === null ? prev : 'on';
  if (!Number.isFinite(stampNoise)) return prev;
  if (stampNoise > SUBFRAME_MAX_STAMP_NOISE_S) return 'off-stamps';
  if (stampNoise < SUBFRAME_RESUME_STAMP_NOISE_S) return 'on';
  return prev;
}

export const IDLE_STATUS: AirDrumStatus = { enabled: false, hits: 0, predicted: 0, lastHand: null, lastPad: null, frameAspect: 0, lastLead: 0, lastPull: 0, lastOnTime: 'yes', lastLateBy: 0, magnet: 'off', magnetLag: NaN, magnetGate: 0, ready: { right: false, left: false }, subframe: 'on', stampNoise: NaN };

/**
 * Where the timing magnet stands over the last {@link LAG_STROKES} strokes it was engaged
 * for (magnetism above 0, a running conductor, no pattern in play):
 * - `off`: not engaged;
 * - `on`: engaged, and not blocked: some stroke in the run was pulled, the run is not
 *   full yet, or nothing in it asked for a pull (the conductor warming up or unsure, the
 *   grid's lag not yet measured over enough strokes, strokes outside the beat's window);
 * - `too-slow`: no stroke in the run was pulled, and most were lost to the pipeline: ghost notes (a
 *   stroke too fast for the pipeline is never predicted, so never pulled) and pulls
 *   truncated to nothing because the beat was already behind the earliest sound;
 * - `grid-lag`: no stroke in the run was pulled, and most were zeroed by the lag gate: the grid sits further
 *   from the strokes than their own scatter explains (a lagging follower), so pulling
 *   toward it would make the timing worse.
 */
export type MagnetStanding = 'off' | 'on' | 'too-slow' | 'grid-lag';

/** What became of the magnet's pull for one engaged stroke. */
export type MagnetOutcome = 'pulled' | 'quiet' | 'warming' | 'gated' | 'pipeline';

/** The magnet's standing over a run of engaged strokes' outcomes: blocked only when a
 *  full run pulled nothing AND most of it was blocked (a warm-up ghost among strokes the
 *  magnet had no reason to pull is not evidence of anything). */
export function magnetStanding(run: readonly MagnetOutcome[]): MagnetStanding {
  if (!run.length) return 'off';
  if (run.length < LAG_STROKES || run.some((o) => o === 'pulled')) return 'on';
  const pipeline = run.filter((o) => o === 'pipeline').length;
  const gated = run.filter((o) => o === 'gated').length;
  if (2 * (pipeline + gated) <= run.length) return 'on';
  return pipeline >= gated ? 'too-slow' : 'grid-lag';
}

/**
 * A hit's standing against the pipeline (step 0b, #239): its lead from the decision
 * (unclamped), whether its sound can land at the intended time, and by how much it
 * cannot. The earliest a sound decided at `decisionT` can leave the device is
 * `decisionT + outputStage.value`, so the lead must cover the stage. When the stage is
 * only the stated prior (its source says so) that comparison is not a measurement: a
 * lead at or above zero is `unknown-output`, never a definite `late` with a `lateBy`
 * read off a guess, and a negative lead is late by at least its own size.
 */
export function standing(intendedT: number, decisionT: number, outputStage: { value: number; source: string }): Pick<DrumHit, 'lead' | 'lateBy' | 'predicted' | 'onTime'> {
  const lead = intendedT - decisionT;
  if (outputStage.source === 'prior') {
    const onTime: HitOnTime = lead >= 0 ? 'unknown-output' : 'late';
    return { lead, lateBy: Math.max(0, -lead), predicted: onTime !== 'late', onTime };
  }
  const lateBy = Math.max(0, outputStage.value - lead);
  const onTime: HitOnTime = lateBy > 0 ? 'late' : 'yes';
  return { lead, lateBy, predicted: onTime !== 'late', onTime };
}
