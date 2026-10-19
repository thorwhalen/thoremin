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
 * gets one hand (with both in view the landmarker may hold the other one for a while), and the
 * skeleton shows what the instrument tracks, so an instrument that reads one hand or none draws
 * one; an open hand tool, a hand-group claim, gestures or a two-hand dial still ask for every hand.
 *
 * Pure: no store, no engine, no React.
 */
import type { DemandedGroups } from '@thoremin/sdk/features/demand';
import type { GraphBranch } from '@thoremin/sdk/instruments/branch';
import { TRUNK, TRUNK_ID } from '@thoremin/sdk/instruments/trunk';
import { demandWantsHands, labWantsHands, type FeatureLabConfig } from '../features/labConfig';

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
  /** The Feature Lab's config: an open Lab showing a hand group measures every hand. */
  featureLab?: FeatureLabConfig;
  /** The live feature demand: a hand-group claim (the Trainer, a bound hand categorizer). */
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
 * How many hands the model should look for, given the COMPOSED branches (requirements
 * included) and what the shell reads. The largest need wins; a one-hand need and the
 * skeleton go through `policy`.
 */
export function deriveHandCount(branches: readonly GraphBranch[], ctx: HandCountContext = {}, policy: HandCountPolicy = HAND_COUNT_POLICY): HandCount {
  const tools = labWantsHands(ctx.featureLab) || demandWantsHands(ctx.demanded ?? new Set()) || ctx.gesturesEnabled === true;
  if (tools || ctx.twoHandsRead === true || (ctx.skeletonShown === true && policy.skeletonSeesAllHands)) return ALL_HANDS;
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
