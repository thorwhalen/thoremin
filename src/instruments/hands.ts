/**
 * How many hands the hand model looks for (#325): derived from what the composed instrument
 * and the open tools actually read, never assumed.
 *
 * Why it matters. MediaPipe's hand landmarker runs its palm detector on every frame while it
 * tracks fewer hands than it was told to look for. Told to look for two with one in view, it
 * pays for a search on every frame; told to look for one, it tracks that hand and skips the
 * search. Measured on the CPU delegate (headless Chromium 153, a 1280x720 clip of a conductor
 * with both hands in view about half the time): 95 ms a frame looking for two, 52 looking for
 * one. `HandLandmarker.setOptions({ numHands })` changes the count on a live landmarker in
 * 10 to 14 ms with no model reload (278 ms to create one), so `webcam-hands` takes the count
 * on a live input and a change of instrument never reloads the model.
 *
 * Why it is not simply "one for a one-hand instrument". Told to look for one hand with two in
 * view, the landmarker tracks whichever it found first, and on that clip it switched between
 * the two hands every second or so. Every one-hand reader in thoremin picks its hand
 * RELATIVE to the others (the conductor: the player's right hand, else any; a named hand;
 * ASL: the higher hand), so for them one hand is a change a player would feel, and the skeleton
 * overlay (on by default) would draw one hand of two. Both are maintainer decisions (#168 D13),
 * held in {@link HAND_COUNT_POLICY} and applied on the recommendations (#480): a one-hand reader
 * gets one hand (with both in view, steered to the one it reads when it says which: below), and the
 * skeleton shows what the instrument tracks, so an instrument that reads one hand or none draws
 * one; an open hand tool, a hand-group claim, gestures or a two-hand dial still ask for every hand.
 *
 * Which hand, when one is looked for and two are in view (#784, item 3 of #480). Told to look for
 * one, the landmarker holds whichever it found first, so a reader that wants a particular hand (the
 * conductor's right hand, ASL's higher hand) states a {@link HandPreference} and
 * {@link stepHandPreference} escalates to two hands while the tracked hand is not the wanted one,
 * and drops back to one once only the wanted hand is in view: tracking two hands with two in view
 * costs no search (the search is paid only while fewer are tracked than looked for), so the
 * escalation costs the search only while the wanted hand is out of view. The thresholds are seconds
 * read from the frames' capture stamps ({@link HAND_PREFERENCE_OPTIONS}, #964), so a 60 fps camera and a
 * loaded 15 fps one settle and probe on the same clock; escalating also needs `minEscalateFrames` wrong
 * frames, so a label flicker of a frame or two moves nothing at any frame rate; and a lone hand that
 * blinks out of tracking for a frame is not taken for a new one.
 * No preference is the derived count exactly.
 *
 * Pure: no store, no engine, no React.
 */
import type { DemandedGroups } from '@thoremin/sdk/features/demand';
import type { GraphBranch } from '@thoremin/sdk/instruments/branch';
import { TRUNK, TRUNK_ID } from '@thoremin/sdk/instruments/trunk';
import { demandWantsHands } from '@thoremin/sdk/features/sources';
import { preferredHand, sameHandPreference, type HandPreference } from '@thoremin/sdk/nodes/player_hands';
import { DEFAULT_FRAME_PERIOD_S, isFreshFrame, stampInterval, type FrameTiming, type Hand } from '@thoremin/sdk/nodes/domain';

/** How many hands the model can be told to look for. It always looks for at least one. */
export type HandCount = 1 | 2;

/** Every hand: what the model looked for before #325, and what an unknown need gets. */
export const ALL_HANDS: HandCount = 2;

/**
 * The trunk's nodes that carry the hand stream. A branch with an edge out of one of them
 * reads the hands. `handVec` and `gesture` are the trunk's own readers (the Lab's vector and
 * the gesture classifier), named by id in `src/instruments/branches.ts`.
 */
export const HAND_STREAM_NODES: ReadonlySet<string> = new Set([TRUNK.cam, TRUNK.hands, TRUNK.feat, 'handVec', 'gesture']);

/**
 * The maintainer's calls (#168 D13), as data so each is one line to change.
 *
 * - `oneHandReaders`: what a branch that reads ONE hand (`hands: 1`) gets. `1` saves the
 *   search on every frame, at the price of the landmarker choosing the hand when two are in
 *   view; `2` keeps today's behaviour.
 * - `skeletonSeesAllHands`: whether the hand skeleton overlay, while shown, keeps the model
 *   looking for every hand (so it draws every hand in view).
 */
export interface HandCountPolicy {
  oneHandReaders: HandCount;
  skeletonSeesAllHands: boolean;
}

/** #168 D13, applied on the recommendations (#480): a one-hand reader looks for one hand, and the
 *  skeleton draws what the instrument tracks. Set `oneHandReaders: ALL_HANDS` and
 *  `skeletonSeesAllHands: true` to go back to the behaviour before #325. */
export const HAND_COUNT_POLICY: HandCountPolicy = { oneHandReaders: 1, skeletonSeesAllHands: false };

/** How many hands a branch reads: its declaration, else inferred from its edges. */
export function branchHands(branch: GraphBranch): 0 | 1 | 2 {
  if (branch.hands !== undefined) return branch.hands;
  if (branch.id === TRUNK_ID) return 0; // the trunk's readers are the shell's: see HandCountContext
  return branch.edges.some((e) => HAND_STREAM_NODES.has(e.from.node)) ? 2 : 0;
}

/** What the shell reads of the hands, beside the instrument's branches. */
export interface HandCountContext {
  /** The live feature demand: a hand-group claim (the Trainer, a bound hand categorizer, the open
   *  Lab showing a hand group: it claims its shown groups, #600 S16a). */
  demanded?: DemandedGroups;
  /** Hand gestures dispatch commands (the per-device gesture pref). */
  gesturesEnabled?: boolean;
  /** The hand skeleton overlay is shown (`overlay.landmarks.show`). */
  skeletonShown?: boolean;
  /** A dial makes a one-hand branch read two hands at once: the conductor's split with the
   *  hands alone (#457: one hand beats, the other, named, shapes). */
  twoHandsRead?: boolean;
}

/**
 * Whether the shell reads the hands, whatever the instrument composes: a live claim on a hand
 * group (the Lab, the Trainer, a bound categorizer), the hand gestures, and the skeleton overlay
 * drawing them. The one list of the shell's hand readers: the hand count asks it with the skeleton
 * counted only as the policy says (`skeletonSeesAllHands`), the camera (#869,
 * `./camera.ts`) with the skeleton counted, since a skeleton shown needs a camera to draw from.
 */
export function shellReadsHands(ctx: HandCountContext = {}, { skeleton = true }: { skeleton?: boolean } = {}): boolean {
  return demandWantsHands(ctx.demanded ?? new Set()) || ctx.gesturesEnabled === true || (skeleton && ctx.skeletonShown === true);
}

/**
 * How many hands the model should look for, given the COMPOSED branches (requirements
 * included) and what the shell reads. The largest need wins; a one-hand need and the
 * skeleton go through `policy`.
 */
export function deriveHandCount(branches: readonly GraphBranch[], ctx: HandCountContext = {}, policy: HandCountPolicy = HAND_COUNT_POLICY): HandCount {
  if (shellReadsHands(ctx, { skeleton: policy.skeletonSeesAllHands }) || ctx.twoHandsRead === true) return ALL_HANDS;
  let need: HandCount = 1;
  for (const b of branches) {
    const h = branchHands(b);
    if (h === 2) return ALL_HANDS;
    if (h === 1 && policy.oneHandReaders > need) need = policy.oneHandReaders;
  }
  return need;
}

/** The URL override (`?hands=1` / `?hands=2`), a verification affordance like `?slot.source=`:
 *  it lets a player try both counts on a real camera before #168 D13 is answered. Anything
 *  else (absent, `auto`, a typo) is no override. */
export function parseHandsOverride(search: string): HandCount | null {
  const v = new URLSearchParams(search).get('hands');
  return v === '1' ? 1 : v === '2' ? 2 : null;
}

/**
 * The preferences of the one-hand readers, folded (#784): the one they agree on, or `conflict` when
 * two want different hands (the host then looks for two: two hands are read).
 */
export function foldHandPreferences(preferences: readonly (HandPreference | undefined)[]): { preference?: HandPreference; conflict: boolean } {
  let preference: HandPreference | undefined;
  for (const p of preferences) {
    if (!p) continue;
    if (preference && !sameHandPreference(preference, p)) return { conflict: true };
    preference ??= p;
  }
  return preference ? { preference, conflict: false } : { conflict: false };
}

/**
 * How quickly the count follows the hands in view (#784), in seconds (#964). A frame counts for the
 * interval since the frame before it, read from their capture stamps ({@link stampInterval}), else
 * for `framePeriodS`, and for at most `maxFrameS`.
 */
export interface HandPreferenceOptions {
  /** Seconds the tracked hand must be the wrong one before looking for two: a raw label flickers
   *  for a frame now and then on a single hand. */
  escalateAfterS: number;
  /** And consecutive wrong frames, whatever their seconds: on a slow camera `escalateAfterS` is one
   *  or two frames, which a flicker lasts. */
  minEscalateFrames: number;
  /** Seconds with only the wanted hand in view (frames with no hand neither count nor break the
   *  run) before looking for one again. */
  settleAfterS: number;
  /** For a preference one tracked hand cannot judge (`higher`: is another hand above it?), the
   *  seconds of one hand after which the model looks for two once, to see; it also looks at once
   *  when a hand is found after none (the moment the landmarker chooses). */
  probeEveryS: number;
  /** Seconds with no hand in view after which the next hand is a hand FOUND (the landmarker chose
   *  it); a shorter dropout is the same hand blinking out of tracking. Above `maxFrameS`, so one
   *  frame of absence never counts, at any frame rate. */
  absentForS: number;
  /** The period of a frame whose stamps give no interval (unstamped, another time base, the first). */
  framePeriodS: number;
  /** The most one frame counts for: the frame after a stalled pipeline says nothing about the
   *  stall, so it counts as one slow frame, not as seconds of absence or of the wrong hand. On a
   *  camera faster than 1 / maxFrameS every threshold is the camera's own time. */
  maxFrameS: number;
}

/** A duration reached on the `frames`-th frame of a 30 fps camera however its stamps jitter: half a
 *  frame short of `frames` periods (a real camera's intervals scatter around 33.3 ms). */
const atFrame = (frames: number): number => (frames - 0.5) * DEFAULT_FRAME_PERIOD_S;

/** About a tenth of a second to escalate, a third to settle, a look every three seconds: on a 30 fps
 *  camera the 3, 10 and 90 frames of before #964; never escalating on fewer than those 3 frames, so
 *  at 15 fps escalating takes a fifth of a second. A hand is found after a fifth of a second with
 *  none; a frame counts for at most a tenth (a 10 fps camera's period). */
export const HAND_PREFERENCE_OPTIONS: Readonly<HandPreferenceOptions> = Object.freeze({
  escalateAfterS: atFrame(3),
  minEscalateFrames: 3,
  settleAfterS: atFrame(10),
  probeEveryS: atFrame(90),
  absentForS: 0.2,
  framePeriodS: DEFAULT_FRAME_PERIOD_S,
  maxFrameS: 0.1,
});

/** A microsecond, below any capture stamp's resolution: a sum of frame periods that lands on a
 *  threshold in exact arithmetic reaches it in floating point too (6 x 1/30 sums to 0.1999...). */
const TIME_EPSILON_S = 1e-6;

/** Whether `elapsed` seconds have reached `threshold`. */
const reached = (elapsed: number, threshold: number): boolean => elapsed >= threshold - TIME_EPSILON_S;

/** The frame the policy reads: the hand source's last output, with its capture stamp and origin
 *  when the source gives them (a copy with the same stamp is no new frame; the stamps time the
 *  thresholds). */
export interface ObservedHands extends Pick<FrameTiming, 't' | 'tOrigin'> {
  hands: readonly Hand[];
}

/** The policy's small state between frames. */
export interface HandPreferenceState {
  /** The count it asks for now. */
  readonly count: HandCount;
  /** Seconds toward the next change: of the wrong hand at one hand, of only the wanted hand at two. */
  readonly run: number;
  /** The frames in that run. */
  readonly runFrames: number;
  /** Seconds of judged frames at one hand since the last look (for a preference one hand cannot judge). */
  readonly sinceProbe: number;
  /** Seconds with no hand in view since one was last seen; infinite before any hand (or after the
   *  source gave no frame), so the first hand is one found. */
  readonly absent: number;
  /** The preference the runs were counted for: another one starts them over. */
  readonly preference?: HandPreference;
  /** The last frame observed, so the same frame read twice counts once. */
  readonly frame?: ObservedHands;
}

/** The state before any frame: the derived count, nothing counted, no hand seen. */
export function initialHandPreferenceState(count: HandCount = 1): HandPreferenceState {
  return { count, run: 0, runFrames: 0, sinceProbe: 0, absent: Infinity };
}

/** What one frame says at one hand: the tracked hand is the wanted one, another, or one hand
 *  cannot tell (`higher` with a single hand); `none` with no hand. */
function judgeTracked(hands: readonly Hand[], preference: HandPreference): 'wanted' | 'wrong' | 'unknown' | 'none' {
  if (hands.length === 0) return 'none';
  if (preference.kind === 'higher') return hands.length > 1 ? 'wanted' : 'unknown';
  return preferredHand(hands, preference) ? 'wanted' : 'wrong';
}

/** Whether a frame at two hands shows only the wanted hand (`null`: no hand, which says nothing). */
function onlyWantedInView(hands: readonly Hand[], preference: HandPreference): boolean | null {
  if (hands.length === 0) return null;
  return hands.length === 1 && preferredHand(hands, preference) === hands[0];
}

/** The seconds a new frame counts for: its interval from the last frame by their stamps, else the
 *  assumed period, capped at `maxFrameS`. */
function frameSeconds(last: ObservedHands | undefined, frame: ObservedHands, options: Readonly<HandPreferenceOptions>): number {
  return Math.min(stampInterval(last, frame) ?? options.framePeriodS, options.maxFrameS);
}

/** No run in progress. */
const NO_RUN: Pick<HandPreferenceState, 'run' | 'runFrames'> = Object.freeze({ run: 0, runFrames: 0 });

/** The run with one more frame of `dt` seconds. */
const extendRun = (state: HandPreferenceState, dt: number): Pick<HandPreferenceState, 'run' | 'runFrames'> => ({ run: state.run + dt, runFrames: state.runFrames + 1 });

/** A new frame observed: the state's frame and absence moved on (the runs are the caller's). */
function observe(state: HandPreferenceState, frame: ObservedHands, dt: number): HandPreferenceState {
  return { ...state, frame, absent: frame.hands.length === 0 ? state.absent + dt : 0 };
}

/**
 * The next count, given the DERIVED count, the one-hand readers' preference and the hand source's
 * last frame (#784). Only a derived count of one with a preference is ever raised; anything else
 * passes through and clears the runs. At one hand: `escalateAfterS` and `minEscalateFrames` of the wrong hand (or, for a
 * preference one hand cannot judge, `probeEveryS` of judged frames, or a hand found after
 * `absentForS` with none) ask for two. At two: `settleAfterS` with only the wanted hand in view ask
 * for one again. Each new frame counts for its own interval ({@link frameSeconds}).
 */
export function stepHandPreference(
  state: HandPreferenceState,
  derived: HandCount,
  preference: HandPreference | undefined,
  frame: ObservedHands | undefined,
  options: Readonly<HandPreferenceOptions> = HAND_PREFERENCE_OPTIONS,
): HandPreferenceState {
  const fresh = frame !== undefined && isFreshFrame(state.frame, frame);
  const dt = fresh ? frameSeconds(state.frame, frame, options) : 0;
  if (derived !== 1 || !preference) {
    // Pass through: the derived count, the runs cleared. The absence still follows the frames, and
    // a read with no frame sets it to infinite, so the next hand counts as one found.
    const absent = !frame ? Infinity : fresh ? observe(state, frame, dt).absent : state.absent;
    return { ...initialHandPreferenceState(derived), frame, absent };
  }
  // A new preference starts the runs over, keeping the count it asks for (no reconfigure for it).
  if (!state.preference || !sameHandPreference(state.preference, preference)) state = { ...initialHandPreferenceState(state.count), preference, frame: state.frame, absent: state.absent };
  if (!fresh) return state;
  const seen = observe(state, frame, dt);
  if (state.count === 1) {
    const verdict = judgeTracked(frame.hands, preference);
    if (verdict === 'none') return { ...seen, ...NO_RUN };
    if (verdict === 'unknown') {
      // A hand found after none is the landmarker's choice being made: look at once, then now and then.
      const found = reached(state.absent, options.absentForS);
      const sinceProbe = state.sinceProbe + dt;
      return found || reached(sinceProbe, options.probeEveryS) ? { ...seen, ...NO_RUN, count: ALL_HANDS, sinceProbe: 0 } : { ...seen, ...NO_RUN, sinceProbe };
    }
    const next = verdict === 'wrong' ? extendRun(state, dt) : NO_RUN;
    const escalate = reached(next.run, options.escalateAfterS) && next.runFrames >= options.minEscalateFrames;
    return escalate ? { ...seen, ...NO_RUN, count: ALL_HANDS, sinceProbe: 0 } : { ...seen, ...next };
  }
  const only = onlyWantedInView(frame.hands, preference);
  if (only === null) return seen;
  const next = only ? extendRun(state, dt) : NO_RUN;
  return reached(next.run, options.settleAfterS) ? { ...seen, ...NO_RUN, count: 1, sinceProbe: 0 } : { ...seen, ...next };
}
