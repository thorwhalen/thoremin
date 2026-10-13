/**
 * Transport rules: start, hold and cut-off from the conductor's pose (#377, body-movement
 * A5).
 *
 * A follower that starts on the first anchor and holds only when the expected beat is
 * overdue (the priors' own `hold`, at `holdAfterPeriods` = 2.25) is right for a hand in
 * front of a webcam, which is either beating or out of frame. A body is always in frame:
 * walking up to the camera, lifting the arms and settling all produce impacts, and a
 * conductor who stops has stopped moving, not left. So the body's transport reads the
 * pose itself, with three rules over two numbers the caller measures per frame:
 *
 * - `raise`, how high the beating arm is (0 at the hips, 1 at the shoulders, torso units);
 * - `motion`, how much the arms move, in NOISE UNITS (displacement over the tracker's own
 *   jitter, so a still body reads about 1 whatever the camera, and every threshold here
 *   means the same thing for every player and camera).
 *
 * The rules (the closest MediaPipe-pose precedent's start-on-an-upbeat machine, and the
 * conducting literature's fermata and cut-off, design §3.6):
 *
 * - **Start.** Ready = the arm raised and the body still for `readyS`; then the upbeat
 *   (motion above `moveAbove`); then the first anchor delivered after it is the downbeat,
 *   and only from it are anchors handed to the prior. Anchors before (walking in, lifting
 *   the arms) never reach it, so they cannot start the piece.
 * - **Hold (fermata, sustain).** No anchor for `holdAfterPeriods` stroke periods while the
 *   arm stays raised and the body still: hold. From `waitAfterPeriods` (the stroke is
 *   overdue) the step says `waiting`, and the caller keeps the beat short of the next
 *   stroke's beat, so the hold sustains the beat the conductor last gave. The next anchor releases it, the
 *   preparatory beat that releases a fermata in every shipped system.
 * - **Stop (cut-off).** The arm dropped (`raise` below `droppedBelow`) and the body still
 *   for `stopAfterPeriods` periods: stop. A cut-off looks like a beat; only the stillness
 *   that follows tells them apart, which is why the rule waits for it. After a stop the
 *   start rule applies again.
 *
 * The override seam (B4, a personal pose category, #387 choice B5): `pose` on a step may
 * state any of the three pose predicates (`ready`, `hold`, `cutoff`) directly, and a stated
 * one replaces its rule's geometry (`raise` and `motion`); the timing (`readyS`, the
 * periods) is kept. Rules by default; a category is a per-player override.
 *
 * Pure and causal: the caller feeds frames in time order with the stroke period it has
 * (`Infinity` before one is known, then `fallbackPeriodS` is used).
 */

/** Where the transport is: waiting for a ready pose, ready, past the upbeat waiting for the
 *  downbeat, running, holding. A stop returns it to `idle` (and reports `stopped`). */
export type TransportPhase = 'idle' | 'armed' | 'prepared' | 'running' | 'holding';
export const TRANSPORT_PHASES = ['idle', 'armed', 'prepared', 'running', 'holding'] as const satisfies readonly TransportPhase[];

/** A pose stated by something other than the rules (B4's pose category): each stated
 *  predicate replaces its rule's geometry. */
export interface TransportPose {
  ready?: boolean;
  hold?: boolean;
  cutoff?: boolean;
}

export interface TransportInput {
  t: number;
  /** The beating arm's height, 0 at the hips and 1 at the shoulders; undefined when unseen. */
  raise?: number;
  /** The arms' motion in noise units; undefined when unseen. */
  motion?: number;
  /** The own (refined) time of an anchor delivered on this frame, if one was; its
   *  acceptance is in the result. The periods are counted from it, not from the frame
   *  that confirmed it: a stroke that ends in a stop is confirmed late. */
  anchor?: number;
  /** The current stroke period, seconds (`Infinity` when unknown). */
  period?: number;
  /** The override (see the header). */
  pose?: TransportPose;
}

export interface TransportStep {
  phase: TransportPhase;
  /** Hand this frame's anchor to the prior. */
  accept: boolean;
  /** Freeze the beat (the body's fermata). */
  hold: boolean;
  /** Running, the stroke overdue (past `waitAfterPeriods`) and the body still (in the hold
   *  or the cut-off pose):
   *  the caller should not let the beat cross the next stroke's beat on its own. Without
   *  it, the beat runs on for the whole `holdAfterPeriods` and the hold sustains a note
   *  the conductor never gave. */
  waiting: boolean;
  /** This frame started the transport (the downbeat), or stopped it (a cut-off). */
  started: boolean;
  stopped: boolean;
}

export interface TransportOptions {
  /** The arm counts as raised above this height (0 hips, 1 shoulders). */
  raisedAbove?: number;
  /** The arm counts as dropped below this height. */
  droppedBelow?: number;
  /** The body counts as still below this motion, noise units. */
  stillBelow?: number;
  /** The upbeat: motion above this, noise units. */
  moveAbove?: number;
  /** The ready pose must persist this long, seconds. */
  readyS?: number;
  /** Past the upbeat, no downbeat within this long returns to waiting, seconds. */
  prepareTimeoutS?: number;
  /** No anchor for this many stroke periods, raised and still: the beat waits for the
   *  next stroke (`waiting`). A little under one: the beat reaches the next stroke's
   *  beat about one period after the last, and the wait must begin before it does. */
  waitAfterPeriods?: number;
  /** No anchor for this many stroke periods, raised and still: hold. */
  holdAfterPeriods?: number;
  /** Dropped and still for this many stroke periods: stop. */
  stopAfterPeriods?: number;
  /** The period used before a stroke period is known, seconds. */
  fallbackPeriodS?: number;
}

export const TRANSPORT_DEFAULTS: Required<TransportOptions> = {
  raisedAbove: 0.45,
  droppedBelow: 0.2,
  stillBelow: 6,
  moveAbove: 9,
  readyS: 0.4,
  prepareTimeoutS: 2,
  waitAfterPeriods: 0.9,
  holdAfterPeriods: 1.5,
  stopAfterPeriods: 1,
  fallbackPeriodS: 0.75,
};

export interface Transport {
  step(input: TransportInput): TransportStep;
  phase(): TransportPhase;
  /** Enter `running` as if an anchor had just been accepted at `t`: the caller was already
   *  running on another source (a live change from the hands to the body keeps the music
   *  going). */
  run(t: number): void;
  /** Set the thresholds live (a dial change); the phase is kept. */
  configure(options: TransportOptions): void;
  reset(): void;
}

export function createTransport(options: TransportOptions = {}): Transport {
  let o: Required<TransportOptions> = { ...TRANSPORT_DEFAULTS, ...options };
  let phase: TransportPhase = 'idle';
  /** Since when the ready pose (or the cut-off pose) has held without a break. */
  let readySince = NaN;
  let cutoffSince = NaN;
  let preparedAt = NaN;
  let lastAnchorT = NaN;

  const reset = (): void => {
    phase = 'idle';
    readySince = NaN;
    cutoffSince = NaN;
    preparedAt = NaN;
    lastAnchorT = NaN;
  };

  return {
    phase: () => phase,
    configure(next) {
      o = { ...TRANSPORT_DEFAULTS, ...next };
    },
    reset,
    run(t) {
      phase = 'running';
      lastAnchorT = t;
    },
    step({ t, raise, motion, anchor, period = Infinity, pose = {} }) {
      const P = Number.isFinite(period) && period > 0 ? period : o.fallbackPeriodS;
      const still = motion !== undefined && motion < o.stillBelow;
      const raised = raise !== undefined && raise > o.raisedAbove;
      const dropped = raise !== undefined && raise < o.droppedBelow;
      const readyPose = pose.ready ?? (raised && still);
      const holdPose = pose.hold ?? (raised && still);
      const cutoffPose = pose.cutoff ?? (dropped && still);
      const moving = motion !== undefined && motion > o.moveAbove;

      readySince = readyPose ? (Number.isNaN(readySince) ? t : readySince) : NaN;
      cutoffSince = cutoffPose ? (Number.isNaN(cutoffSince) ? t : cutoffSince) : NaN;

      let accept = false;
      let started = false;
      let stopped = false;
      switch (phase) {
        case 'idle':
          if (readyPose && t - readySince >= o.readyS) phase = 'armed';
          break;
        case 'armed':
          // The upbeat is checked first. Between the ready pose and the upbeat the motion
          // rises through the band between still and moving, and the preparatory may dip
          // the arm, so only a dropped arm (or a stated `ready: false`) disarms.
          if (moving) {
            phase = 'prepared';
            preparedAt = t;
          } else if (pose.ready === false || (pose.ready === undefined && dropped)) phase = 'idle';
          break;
        case 'prepared':
          if (anchor !== undefined) {
            phase = 'running';
            accept = true;
            started = true;
            lastAnchorT = anchor;
          } else if (t - preparedAt > o.prepareTimeoutS) phase = readyPose ? 'armed' : 'idle';
          break;
        case 'running':
        case 'holding':
          if (anchor !== undefined) {
            phase = 'running';
            accept = true;
            lastAnchorT = anchor;
          } else if (cutoffPose && t - cutoffSince >= o.stopAfterPeriods * P) {
            reset();
            stopped = true;
          } else if (phase === 'running' && holdPose && t - lastAnchorT > o.holdAfterPeriods * P) phase = 'holding';
          break;
      }
      // Still, raised or dropped: a body that has stopped beating gives no next stroke.
      const waiting = phase === 'running' && !accept && (holdPose || cutoffPose) && t - lastAnchorT > o.waitAfterPeriods * P;
      return { phase, accept, hold: phase === 'holding', waiting, started, stopped };
    },
  };
}
