/**
 * "Learn my timing" (#427): the body conductor's lead offsets, learned against a click.
 *
 * The body conductor plays the turning point of whichever joint its detector follows as
 * the beat, and a joint is not the beat: A1 measured the trunk's anchors 85 ms behind the
 * hand's stroke on one clip and 112 ms ahead on another (#373). So the player conducts a
 * count-in and a few bars against the trainer's click, every joint the conductor follows
 * gets a detector of its own (`createLeadCalibration`), and each joint's lag behind the
 * clicks it kept becomes its offset, which the conductor subtracts from that joint's
 * anchors (`conductor.ts`, the `leadOffsets` input). A joint that did not keep the click
 * gets no offset. The player keeps the result or discards it; kept, it is a per-device
 * pref (`conductorPrefs` in the hot store), never an instrument setting.
 *
 * WHEN the clicks sound is `clickPlan`'s (the trainer's SSOT): one list of engine times,
 * played by the trainer's click player and read back here as the times the player was
 * meant to stroke on. The click player maps them through the shared output stage, so the
 * times are when the click SOUNDS; an output delay the browser does not report (Bluetooth)
 * is part of the lag learned, which is right as long as the player plays through the same
 * output they calibrated on.
 *
 * What the fixtures say (`scripts/body/measure_lead_offset.ts`, numbers in the #427 PR): the
 * correction reaches the click on the take it was learned from, but the trunk's lag on the
 * one conductor clip where the trunk keeps the beat moved by about 70 ms between the two
 * halves of a 24 s take. So the result is shown per joint with how well it kept the click,
 * and a player who finds the beat off repeats it; the live check is a row on #146.
 *
 * The sink is pure over its readers (the engine's outputs, the clock, the conductor dial),
 * so a test drives it with a stub engine.
 */
import { create } from 'zustand';
import { createLeadCalibration, type LeadCalibration, type LeadCalibrationResult } from '@thoremin/ictus';
import { clickPlan, type Click } from '@thoremin/sdk/enroll';
import type { BodyFrame } from '@thoremin/sdk/nodes/domain';
import { clickPlayer } from '@thoremin/sdk-ui/enroll/click';
import { bodyChannelFrame, conductorBodyJoints, type BodySide, type ConductorBodyPoint } from '@/nodes/features/conductor_body';
import type { OutputReader } from './conductorStatus';

/** The take: a bar's count-in, then four bars of clicks (16 strokes), after a lead-in to
 *  stand back. The tempo is the loaded piece's marked one, else {@link LEAD_TAKE.bpm}. */
export const LEAD_TAKE = { bpm: 80, countIn: 4, beats: 16, leadInMs: 2000 } as const;

/** The camera node whose `body` output the take reads (the body source branch's). */
export const LEAD_BODY_NODE_ID = 'camBody';

export type LeadPhase = 'idle' | 'listening' | 'done';

export interface LeadTake {
  /** The beat clicks (count-in excluded), seconds on the engine clock. */
  beats: number[];
  /** The count-in's first click and the end of the take, seconds. */
  startT: number;
  endT: number;
  bpm: number;
  /** The joints calibrated (the conductor's own set at the start). */
  joints: string[];
}

export interface LeadCalibrationState {
  phase: LeadPhase;
  take: LeadTake | null;
  /** Beat clicks already past (for "click 5 of 16"). */
  clicksPast: number;
  /** The finished take's result, until it is kept or discarded. */
  result: LeadCalibrationResult | null;
  start(take: LeadTake): void;
  progress(clicksPast: number): void;
  finish(result: LeadCalibrationResult): void;
  /** Cancel a take, or discard a result. */
  reset(): void;
}

export const useLeadCalibration = create<LeadCalibrationState>((set) => ({
  phase: 'idle',
  take: null,
  clicksPast: 0,
  result: null,
  start: (take) => set({ phase: 'listening', take, clicksPast: 0, result: null }),
  progress: (clicksPast) => set({ clicksPast }),
  finish: (result) => set({ phase: 'done', result }),
  reset: () => set({ phase: 'idle', take: null, clicksPast: 0, result: null }),
}));

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
  player.play(clicks);
  useLeadCalibration.getState().start({ beats, startT, endT, bpm, joints: conductorBodyJoints(point, side).map((j) => j.channel) });
}

/** Stop a take (its clicks silenced) or discard a result. */
export function cancelLeadTake(): void {
  clickPlayer().stop();
  useLeadCalibration.getState().reset();
}

/**
 * The per-frame sink: while a take is listening, every NEW body frame goes to the
 * calibration at its capture stamp (the frame's `t` when it is this document's
 * `performance.now` clock, else the sink's time); at the end of the take the result is
 * stored. `side` is read from the conductor dial at each frame (the take's joints are
 * fixed at its start).
 */
export function makeLeadCalibrationSink(
  engine: OutputReader,
  side: () => BodySide,
  store: Pick<LeadCalibrationState, 'progress' | 'finish'> = useLeadCalibration.getState(),
  read: () => Pick<LeadCalibrationState, 'phase' | 'take' | 'clicksPast'> = () => useLeadCalibration.getState(),
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
      const stamped = typeof body.t === 'number' && Number.isFinite(body.t) && typeof performance !== 'undefined' && body.tOrigin === performance.timeOrigin;
      const t = stamped ? body.t! : now;
      if (t >= take.startT) cal.push(bodyChannelFrame(body, t, side()));
    }
    const past = take.beats.filter((b) => b <= now).length;
    if (past !== s.clicksPast) store.progress(past);
    if (now >= take.endT && cal) {
      store.finish(cal.result(take.beats));
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
