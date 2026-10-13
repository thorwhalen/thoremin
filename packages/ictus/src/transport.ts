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
 *   for `stopAfterPeriods` periods, counted from when the stroke is overdue
 *   (`holdAfterPeriods` after the last, so one missed stroke of a bouncer is not a stop): stop. A cut-off looks like a beat; only the stillness
 *   that follows tells them apart, which is why the rule waits for it. After a stop the
 *   start rule applies again.
 *
 * Two more ways in and out. A steady rhythm starts too, without the ready pose
 * (`rhythmStrokes` anchors whose intervals agree): a player bouncing with the arms down has
 * no raised arm to show, and four regular strokes are as deliberate as a ready pose, where
 * walking in and settling are not regular. And running with the arm unseen for `lostStopS`
 * (the player left the frame) stops, so walking back in does not resume the piece.
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
  /** Running, the stroke overdue (past `waitAfterPeriods`) and the body in the hold pose:
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
  /** A steady rhythm also starts, without the ready pose: this many anchors in a row whose
   *  intervals agree (a bounce with the arms down, a conductor who skips the ready pose). */
  rhythmStrokes?: number;
  /** How far those intervals may differ (the longest over the shortest, minus 1). */
  rhythmTolerance?: number;
  /** The plausible stroke period for that rhythm, seconds. */
  rhythmMinPeriodS?: number;
  rhythmMaxPeriodS?: number;
  /** Running, the arm unseen (the player left the frame, or both arms dropped below it)
   *  this long: stop, so walking back in does not resume the piece. */
  lostStopS?: number;
}

export const TRANSPORT_DEFAULTS: Required<TransportOptions> = {
  raisedAbove: 0.45,
  droppedBelow: 0.2,
  stillBelow: 8,
  moveAbove: 9,
  readyS: 0.4,
  prepareTimeoutS: 2,
  waitAfterPeriods: 0.9,
  holdAfterPeriods: 1.5,
  stopAfterPeriods: 1,
  fallbackPeriodS: 0.75,
  rhythmStrokes: 4,
  rhythmTolerance: 0.15,
  rhythmMinPeriodS: 0.25,
  rhythmMaxPeriodS: 2,
  lostStopS: 2,
};

/** The options with the thresholds made consistent: a pose cannot be raised and dropped at
 *  once, and the upbeat must move more than still. */
function normalise(options: TransportOptions): Required<TransportOptions> {
  const o = { ...TRANSPORT_DEFAULTS, ...options };
  return {
    ...o,
    raisedAbove: Math.max(o.raisedAbove, o.droppedBelow + MIN_HEIGHT_GAP),
    moveAbove: Math.max(o.moveAbove, o.stillBelow + MIN_MOTION_GAP),
  };
}
/** The least gap between the raised and the dropped heights (torso units), and between
 *  still and the upbeat (noise units), when a configuration inverts them. */
const MIN_HEIGHT_GAP = 0.05;
const MIN_MOTION_GAP = 1;

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
  let o = normalise(options);
  let phase: TransportPhase = 'idle';
  /** Since when the ready pose (or the cut-off pose) has held without a break. */
  let readySince = NaN;
  let cutoffSince = NaN;
  let preparedAt = NaN;
  let lastAnchorT = NaN;
  let lostSince = NaN;
  /** The anchors seen while waiting to start (own times), for the rhythm start. */
  let waitingAnchors: number[] = [];

  const reset = (): void => {
    phase = 'idle';
    readySince = NaN;
    cutoffSince = NaN;
    preparedAt = NaN;
    lastAnchorT = NaN;
    lostSince = NaN;
    waitingAnchors = [];
  };
  /** The last `rhythmStrokes` waiting anchors make a steady, plausible rhythm. */
  const steady = (): boolean => {
    const n = o.rhythmStrokes;
    if (n < 2 || waitingAnchors.length < n) return false;
    const iv = waitingAnchors.slice(-n).map((x, i, a) => (i ? x - a[i - 1] : NaN)).slice(1);
    const lo = Math.min(...iv);
    const hi = Math.max(...iv);
    return lo >= o.rhythmMinPeriodS && hi <= o.rhythmMaxPeriodS && hi <= lo * (1 + o.rhythmTolerance);
  };

  return {
    phase: () => phase,
    configure(next) {
      o = normalise(next);
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
      // A stated cut-off is not also a ready or a hold pose by geometry.
      const readyPose = pose.ready ?? (pose.cutoff !== true && raised && still);
      const holdPose = pose.hold ?? (pose.cutoff !== true && raised && still);
      const cutoffPose = pose.cutoff ?? (dropped && still);
      const moving = motion !== undefined && motion > o.moveAbove;

      readySince = readyPose ? (Number.isNaN(readySince) ? t : readySince) : NaN;
      cutoffSince = cutoffPose ? (Number.isNaN(cutoffSince) ? t : cutoffSince) : NaN;
      const lost = raise === undefined && pose.cutoff === undefined;
      lostSince = lost ? (Number.isNaN(lostSince) ? t : lostSince) : NaN;
      const waitingToStart = phase === 'idle' || phase === 'armed' || phase === 'prepared';
      if (waitingToStart && anchor !== undefined) waitingAnchors = [...waitingAnchors.slice(1 - o.rhythmStrokes), anchor];
      if (!waitingToStart) waitingAnchors = [];

      let accept = false;
      let started = false;
      let stopped = false;
      if (waitingToStart && anchor !== undefined && phase !== 'prepared' && steady()) {
        // The rhythm start: a steady run of strokes is as deliberate as a ready pose.
        phase = 'running';
        accept = true;
        started = true;
        lastAnchorT = anchor;
        waitingAnchors = [];
      } else switch (phase) {
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
          // Dropping the arm is not an upbeat: it disarms, and its anchor starts nothing.
          if (pose.ready === false || (pose.ready === undefined && dropped)) phase = 'idle';
          else if (anchor !== undefined) {
            phase = 'running';
            accept = true;
            started = true;
            lastAnchorT = anchor;
          } else if (t - preparedAt > o.prepareTimeoutS) phase = readyPose ? 'armed' : 'idle';
          break;
        // The cut-off's stillness counts only once the stroke is overdue (`holdAfterPeriods`
        // after the last): a body still in the arms but giving strokes (a bounce with the arms
        // hanging, whose strokes the detector may miss one of) is beating.
        case 'running':
        case 'holding':
          if (anchor !== undefined) {
            phase = 'running';
            accept = true;
            lastAnchorT = anchor;
          } else if ((cutoffPose && t - Math.max(cutoffSince, lastAnchorT + o.holdAfterPeriods * P) >= o.stopAfterPeriods * P) || (lost && t - lostSince >= o.lostStopS)) {
            reset();
            stopped = true;
          } else if (phase === 'running' && holdPose && t - lastAnchorT > o.holdAfterPeriods * P) phase = 'holding';
          break;
      }
      // Raised and still: a conductor who has stopped beating gives no next stroke. Not the
      // dropped arm: a player bouncing with the arms hanging is still in the arms between
      // strokes, and each late-confirmed stroke would then come a frame late.
      const waiting = phase === 'running' && !accept && holdPose && t - lastAnchorT > o.waitAfterPeriods * P;
      return { phase, accept, hold: phase === 'holding', waiting, started, stopped };
    },
  };
}
