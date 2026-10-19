/**
 * "Learn my timing" (#427): the body conductor's lead offsets, learned against a click.
 *
 * The body conductor plays the turning point of whichever joint its detector follows as
 * the beat, and a joint is not the beat: A1 measured the trunk's anchors 85 ms behind the
 * hand's stroke on one clip and 112 ms ahead on another (#373). So the player conducts a
 * count-in and a few bars against the trainer's click, every joint the conductor follows
 * gets a detector of its own (`createLeadCalibration`), and each joint's lag behind the
 * clicks becomes its offset, which the conductor subtracts from that joint's anchors
 * (`conductor.ts`, the `leadOffsets` input), but only when the take measured it: locked to
 * the click, to a standard error under 20 ms, the same in both halves of the take. A joint
 * that is not measured keeps whatever offset it had (none at first). The player keeps the
 * result or discards it; kept, it is a per-device pref (`conductorPrefs` in the hot store),
 * never an instrument setting.
 *
 * The take runs with the conductor OFF (the score would otherwise start over the click),
 * so it claims a body feature group for its length (`appFeatureDemand`), which is what
 * composes the pose camera (the derivation's `body-source`).
 *
 * WHEN the clicks sound is `clickPlan`'s (the trainer's SSOT): one list of engine times,
 * played by the trainer's click player and read back here as the times the player was
 * meant to stroke on. The click player maps them through the shared output stage, so the
 * times are when the click SOUNDS; an output delay the browser does not report (Bluetooth)
 * is part of the lag learned, which is right as long as the player plays through the same
 * output they calibrated on. A take during which the player DROPPED a click (its time had
 * passed on the audio clock: a context that resumed late) is refused: the player never
 * heard what it would be scored against.
 *
 * What the fixtures say (`scripts/body/measure_lead_offset.ts`, the research doc §5.2):
 * the trunk is refused on all three of A1's conductor clips (its anchors scatter ±100 ms,
 * and its lag moved by 70 ms between the halves of one take), the wrist needs under 15 ms.
 * Whether a real body's trunk holds a lag from one take to the next is a live check (#146).
 *
 * The sink is pure over its readers (the engine's outputs, the resources, the clock), so a
 * test drives it with a stub engine.
 */
import { create } from 'zustand';
import { createLeadCalibration, type LeadCalibration, type LeadCalibrationResult } from '@thoremin/ictus';
import { clickPlan, type Click } from '@thoremin/sdk/enroll';
import { type BodyFrame } from '@thoremin/sdk/nodes/domain';
import { captureTime } from '@thoremin/sdk/timing/tracker';
import { clickPlayer } from '@thoremin/sdk-ui/enroll/click';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { DERIVED_GROUP, FEATURE_GROUPS } from '@thoremin/sdk/features/catalog';
import { bodyChannelFrame, conductorBodyJoints, type BodySide, type ConductorBodyPoint } from '../nodes/conductor_body';
import type { OutputReader } from './conductorStatus';

/** The body's feature groups: what the take claims so the body camera runs with the Lab closed. */
const BODY_GROUP_IDS: readonly string[] = FEATURE_GROUPS.filter((g) => g.source === 'body' && g.id !== DERIVED_GROUP).map((g) => g.id);

/** The take: a bar's count-in, then four bars of clicks (16 strokes), after a lead-in to
 *  stand back. The tempo is the loaded piece's marked one inside `minBpm..maxBpm`, else
 *  `bpm`: below 60 bpm a third of a beat (the largest offset) would pass the half second
 *  the pref bounds an offset to, and above 160 a stroke is too short to see a lag in. */
export const LEAD_TAKE = { bpm: 80, minBpm: 60, maxBpm: 160, countIn: 4, beats: 16, leadInMs: 2000 } as const;

/** The camera node whose `body` output the take reads (the body source branch's). */
export const LEAD_BODY_NODE_ID = 'camBody';

/** The feature-demand owner the take claims the body camera under. */
export const LEAD_DEMAND_OWNER = 'conductor-lead';

export type LeadPhase = 'idle' | 'listening' | 'done';

export interface LeadTake {
  /** The beat clicks (count-in excluded), seconds on the engine clock. */
  beats: number[];
  /** The count-in's first click and the end of the take, seconds. */
  startT: number;
  endT: number;
  bpm: number;
  /** The joints calibrated (the conductor's own set at the start) and the side they were
   *  read on (fixed for the take). */
  joints: string[];
  side: BodySide;
  /** The click player's dropped count when the take started. */
  droppedAtStart: number;
}

export interface LeadCalibrationState {
  phase: LeadPhase;
  take: LeadTake | null;
  /** Beat clicks already past (for "click 5 of 16"). */
  clicksPast: number;
  /** The finished take's result, until it is kept or discarded (null with `failure`). */
  result: LeadCalibrationResult | null;
  /** Why a finished take has no result: a click the player never heard. */
  failure: 'clicks' | null;
  start(take: LeadTake): void;
  progress(clicksPast: number): void;
  finish(result: LeadCalibrationResult | null, failure?: 'clicks'): void;
  /** Cancel a take, or discard a result. */
  reset(): void;
}

export const useLeadCalibration = create<LeadCalibrationState>((set) => ({
  phase: 'idle',
  take: null,
  clicksPast: 0,
  result: null,
  failure: null,
  start: (take) => {
    appFeatureDemand.claim(LEAD_DEMAND_OWNER, BODY_GROUP_IDS.slice(0, 1));
    set({ phase: 'listening', take, clicksPast: 0, result: null, failure: null });
  },
  progress: (clicksPast) => set({ clicksPast }),
  finish: (result, failure) => {
    appFeatureDemand.release(LEAD_DEMAND_OWNER);
    set({ phase: 'done', result, failure: failure ?? null });
  },
  reset: () => {
    appFeatureDemand.release(LEAD_DEMAND_OWNER);
    set({ phase: 'idle', take: null, clicksPast: 0, result: null, failure: null });
  },
}));

/** The take's tempo for a piece marked at `marked` bpm (null: none loaded). */
export function leadTakeBpm(marked: number | null): number {
  const b = marked !== null && Number.isFinite(marked) && marked > 0 ? marked : LEAD_TAKE.bpm;
  return Math.round(Math.min(LEAD_TAKE.maxBpm, Math.max(LEAD_TAKE.minBpm, b)));
}

/** The take's clicks from the trainer's plan, starting `startMs` (engine ms). */
export function leadTakeClicks(bpm: number, startMs: number): { clicks: Click[]; beats: number[]; startT: number; endT: number } {
  const plan = clickPlan({ sufficiency: { kind: 'clicked', bpm, beats: LEAD_TAKE.beats, countIn: LEAD_TAKE.countIn, leadInMs: LEAD_TAKE.leadInMs, patienceMs: 120000 } }, startMs);
  if (!plan) throw new Error('leadTakeClicks: the clicked plan is null');
  const beats = plan.clicks.filter((c) => c.kind === 'beat').map((c) => c.t / 1000);
  // The take ends half a beat after the last click (its stroke may land late).
  return { clicks: plan.clicks, beats, startT: plan.clicks[0].t / 1000, endT: plan.endMs / 1000 - plan.beatMs / 2000 };
}

/** Start a take: play the clicks and arm the sink. Call inside the click gesture (the
 *  click player's context may start only there). */
export function startLeadTake({ bpm, point, side, nowMs = performance.now() }: { bpm: number; point: ConductorBodyPoint; side: BodySide; nowMs?: number }): void {
  const { clicks, beats, startT, endT } = leadTakeClicks(bpm, nowMs);
  const player = clickPlayer();
  player.unlock?.();
  const droppedAtStart = player.dropped?.() ?? 0;
  player.play(clicks);
  useLeadCalibration.getState().start({ beats, startT, endT, bpm, joints: conductorBodyJoints(point, side).map((j) => j.channel), side, droppedAtStart });
}

/** Stop a take (its clicks silenced) or discard a result. */
export function cancelLeadTake(): void {
  clickPlayer().stop();
  useLeadCalibration.getState().reset();
}

/**
 * The per-frame sink: while a take is listening, every NEW body frame goes to the
 * calibration at the time the conductor would read it (`frameTime`: the capture stamp in
 * real time at speed 1, else the engine's time); at the end of the take the result is
 * stored, or the take is refused when a click was dropped meanwhile.
 */
export function makeLeadCalibrationSink(
  engine: OutputReader,
  resources: () => Record<string, unknown> = () => ({ timeScale: 1 }),
  store: Pick<LeadCalibrationState, 'progress' | 'finish'> = useLeadCalibration.getState(),
  read: () => Pick<LeadCalibrationState, 'phase' | 'take' | 'clicksPast'> = () => useLeadCalibration.getState(),
  dropped: () => number = () => clickPlayer().dropped?.() ?? 0,
  nodeId: string = LEAD_BODY_NODE_ID,
): (nowMs: number) => void {
  let take: LeadTake | null = null;
  let cal: LeadCalibration | null = null;
  let lastFrame: unknown = undefined;
  return (nowMs) => {
    const s = read();
    if (s.phase !== 'listening' || !s.take) {
      take = null;
      cal = null;
      return;
    }
    if (s.take !== take) {
      take = s.take;
      cal = createLeadCalibration({ joints: take.joints });
      cal.setPeriod(60 / take.bpm);
    }
    const now = nowMs / 1000;
    const body = engine.getOutput(nodeId, 'body') as BodyFrame | undefined;
    if (body && body !== lastFrame && cal) {
      lastFrame = body;
      const t = captureTime(body, { time: now, resources: resources() });
      if (t >= take.startT) cal.push(bodyChannelFrame(body, t, take.side));
    }
    const past = take.beats.filter((b) => b <= now).length;
    if (past !== s.clicksPast) store.progress(past);
    if (now >= take.endT && cal) {
      if (dropped() > take.droppedAtStart) store.finish(null, 'clicks');
      else store.finish(cal.result(take.beats));
      take = null;
      cal = null;
    }
  };
}

/** A joint's offset for display: "+50 ms" (late) / "-12 ms" (early). */
export function formatLag(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${ms > 0 ? '+' : ''}${ms} ms`;
}

/** The joint names a player reads: `wrist.left` → "left wrist", `trunk` → "trunk". */
export function jointLabel(channel: string): string {
  const [joint, side] = channel.split('.');
  return side ? `${side} ${joint}` : joint;
}

/** Why a joint was not corrected, in the player's words. */
export const REFUSAL_WORDS = {
  anchors: 'too few strokes seen',
  lock: 'did not keep the click',
  level: 'beat at another level',
  loose: 'too uneven to measure',
  drift: 'changed during the take',
} as const;
