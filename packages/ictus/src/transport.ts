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
 * - **The upbeat by shape (D15, #461, #485).** `upbeat: 'shape'` replaces "motion above
 *   `moveAbove`" with what an upbeat IS: a rise of the beating arm at least `riseMin` torso
 *   lengths above where it was held ready, then a quick fall INTO the downbeat, which ends
 *   below the ready height (within `fallWithinS` of the peak): a bump that returns to the
 *   ready height is an adjustment, not a preparatory beat. The ready pose is the arm raised
 *   and STEADY in torso lengths (within `steadyBand` for `readyS`), not still in noise units.
 *   A conductor who starts with a plain downward stroke from the ready height (no rise first,
 *   as on A1's clip 44) gives the other upbeat: a quick drop to at least `fastFall` below the
 *   ready height within `fallWithinS`, beyond any sway or settle. Noise units are a signal-to-noise ratio, so on a very clean tracker a slow
 *   adjustment of the ready arm crosses `moveAbove`, and on a noisy one the real upbeat does
 *   not; a rise and fall in torso lengths means the same on every camera. A drift up with no
 *   fall, a sway smaller than `riseMin`, a slow settle back down: none is an upbeat. Off
 *   (`'speed'`, the old rule) by default.
 * - **Hold (fermata, sustain).** No anchor for `holdAfterPeriods` stroke periods while the
 *   arm stays raised and the body still: hold. From `waitAfterPeriods` (the stroke is
 *   overdue) the step says `waiting`, and the caller keeps the beat short of the next
 *   stroke's beat, so the hold sustains the beat the conductor last gave. The next anchor releases it, the
 *   preparatory beat that releases a fermata in every shipped system.
 * - **Stop (cut-off).** The arm dropped (`raise` below `droppedBelow`) and the body still
 *   for `stopAfterPeriods` periods: stop. An anchor in that pose is not a stroke (the
 *   detector's noise on a still body), so it neither plays nor delays the stop. A cut-off looks like a beat; only the stillness
 *   that follows tells them apart, which is why the rule waits for it. After a stop the
 *   start rule applies again.
 *
 * One more way out: sounding with the arm unseen for `lostStopS` since the last stroke (the
 * player left the frame) stops, so walking back in does not resume the piece.
 *
 * The rules are about the beating ARM: a caller whose player beats with something else (a
 * bounce of the trunk with the arms hanging) should not use them, since a hanging, still
 * arm is exactly the cut-off pose.
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
  /** How the upbeat is read: `speed` (motion above `moveAbove`, noise units) or `shape` (a rise
   *  and a quick fall of the arm, in torso lengths: see the header). */
  upbeat?: 'speed' | 'shape';
  /** `shape`: the least rise above the ready height that can be an upbeat, torso lengths. */
  riseMin?: number;
  /** `shape`: the fall that completes an upbeat reaches this far BELOW the ready height, torso
   *  lengths (the downbeat is under where the arm was held). */
  dipBelow?: number;
  /** `shape`: ... within this long of the peak, seconds. */
  fallWithinS?: number;
  /** `shape`: a quick drop to this far BELOW the ready height, within `fallWithinS`, is also an
   *  upbeat (a downward preparatory stroke). Beyond any sway's swing (0.08) or settle. */
  fastFall?: number;
  /** `shape`: the ready pose is steady when the arm's height varies by no more than this over
   *  `readyS`, torso lengths. */
  steadyBand?: number;
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
  /** Running, the arm unseen (the player left the frame, or both arms dropped below it)
   *  this long: stop, so walking back in does not resume the piece. */
  lostStopS?: number;
}

export const TRANSPORT_DEFAULTS: Required<TransportOptions> = {
  raisedAbove: 0.45,
  droppedBelow: 0.2,
  stillBelow: 8,
  moveAbove: 9,
  upbeat: 'speed',
  riseMin: 0.12,
  dipBelow: 0.05,
  fallWithinS: 0.5,
  fastFall: 0.2,
  steadyBand: 0.08,
  readyS: 0.4,
  prepareTimeoutS: 2,
  waitAfterPeriods: 0.9,
  holdAfterPeriods: 1.5,
  stopAfterPeriods: 1,
  fallbackPeriodS: 0.75,
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
  /** The height the arm was held ready at (smoothed over the ready pose), for the upbeat's rise. */
  let readyRaise = NaN;
  /** The highest the arm has been since it rose above the ready height, and when. */
  let peakRaise = NaN;
  let peakAt = NaN;

  /** The recent heights (shape mode's steadiness, over `readyS`). */
  let recent: { t: number; raise: number }[] = [];
  const steady = (t: number, raise: number | undefined): boolean => {
    if (raise === undefined) {
      recent = [];
      return false;
    }
    recent.push({ t, raise });
    while (recent.length > 1 && recent[0].t < t - o.readyS) recent.shift();
    if (recent[0].t > t - o.readyS * 0.5) return true; // not enough history to deny it: the ready timer counts the rest
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of recent) {
      lo = Math.min(lo, r.raise);
      hi = Math.max(hi, r.raise);
    }
    return hi - lo <= o.steadyBand;
  };

  const clearUpbeat = (): void => {
    peakRaise = NaN;
    peakAt = NaN;
  };

  /** Shape mode: does this frame complete an upbeat (a rise of `riseMin` and a quick fall)? */
  /** The heights of the last `fallWithinS`, for the quick drop. */
  let lately: { t: number; raise: number }[] = [];
  const upbeatByShape = (t: number, raise: number | undefined): boolean => {
    if (raise === undefined || Number.isNaN(readyRaise)) return false;
    lately.push({ t, raise });
    while (lately.length > 1 && lately[0].t < t - o.fallWithinS) lately.shift();
    // A downward stroke from the ready height: a quick, large drop.
    const high = Math.max(...lately.map((l) => l.raise));
    // (It ends below the ready height by that much: a bump that comes back to it is no stroke.)
    if (high >= readyRaise - 0.5 * o.riseMin && high - raise >= o.fastFall && raise <= readyRaise - o.fastFall) {
      lately = [];
      return true;
    }
    if (raise - readyRaise >= o.riseMin && !(raise <= peakRaise)) {
      peakRaise = raise;
      peakAt = t;
      return false;
    }
    if (Number.isNaN(peakRaise)) return false;
    // Not yet through the ready height: still falling, or a bump that is coming back to it.
    if (raise > readyRaise - o.dipBelow) return false;
    // Fallen through it: an upbeat if it was quick, else a slow settle (the peak starts over).
    const quick = t - peakAt <= o.fallWithinS;
    clearUpbeat();
    return quick;
  };

  const reset = (): void => {
    phase = 'idle';
    readySince = NaN;
    cutoffSince = NaN;
    preparedAt = NaN;
    lastAnchorT = NaN;
    lostSince = NaN;
    readyRaise = NaN;
    recent = [];
    lately = [];
    clearUpbeat();
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
      // Shape mode asks for a steady arm in torso lengths for the START (a tracker clean enough
      // to read a hand's tremor as motion in noise units must still be able to arm); hold and
      // cut-off keep the noise-unit stillness.
      const steadyArm = o.upbeat === 'shape' ? steady(t, raise) : true;
      const still = motion !== undefined && motion < o.stillBelow;
      const raised = raise !== undefined && raise > o.raisedAbove;
      const dropped = raise !== undefined && raise < o.droppedBelow;
      // A stated cut-off is not also a ready or a hold pose by geometry.
      const readyPose = pose.ready ?? (pose.cutoff !== true && raised && (o.upbeat === 'shape' ? steadyArm : still));
      const holdPose = pose.hold ?? (pose.cutoff !== true && raised && still);
      const cutoffPose = pose.cutoff ?? (dropped && still);
      const moving = motion !== undefined && motion > o.moveAbove;

      readySince = readyPose ? (Number.isNaN(readySince) ? t : readySince) : NaN;
      // The height held ready (the upbeat's rise is measured from it): taken when the transport
      // arms (the pose has held `readyS`), then smoothed while the ready pose lasts and frozen
      // while the arm moves.
      // Only small deviations move it: a rise toward an upbeat must not drag its own baseline along.
      if (phase === 'armed' && readyPose && raise !== undefined && !Number.isNaN(readyRaise) && Math.abs(raise - readyRaise) < 0.5 * o.riseMin) readyRaise += 0.2 * (raise - readyRaise);
      cutoffSince = cutoffPose ? (Number.isNaN(cutoffSince) ? t : cutoffSince) : NaN;
      // Unseen, counted only while the piece sounds (from the later of the loss and the
      // last stroke: strokes from another joint mean the player is still there).
      const sounding = phase === 'running' || phase === 'holding';
      const lost = sounding && raise === undefined && pose.cutoff === undefined;
      lostSince = lost ? (Number.isNaN(lostSince) ? t : lostSince) : NaN;

      let accept = false;
      let started = false;
      let stopped = false;
      switch (phase) {
        case 'idle':
          if (readyPose && t - readySince >= o.readyS) {
            phase = 'armed';
            readyRaise = raise ?? NaN;
            lately = [];
            clearUpbeat();
          }
          break;
        case 'armed':
          // The upbeat is checked first. Between the ready pose and the upbeat the motion
          // rises through the band between still and moving, and the preparatory may dip
          // the arm, so only a dropped arm (or a stated `ready: false`) disarms.
          if (o.upbeat === 'shape' ? upbeatByShape(t, raise) : moving) {
            phase = 'prepared';
            preparedAt = t;
            clearUpbeat();
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
          } else if (t - preparedAt > o.prepareTimeoutS) {
            phase = readyPose ? 'armed' : 'idle';
            clearUpbeat();
          }
          break;
        case 'running':
        case 'holding':
          // An anchor while the arm hangs still is not a stroke (the detector's noise on a
          // still body): it neither plays nor releases anything.
          if (anchor !== undefined && !cutoffPose) {
            phase = 'running';
            accept = true;
            lastAnchorT = anchor;
          } else if ((cutoffPose && t - cutoffSince >= o.stopAfterPeriods * P) || (lost && t - Math.max(lostSince, lastAnchorT) >= o.lostStopS)) {
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
