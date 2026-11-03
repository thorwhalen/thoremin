/**
 * Measuring the preferred-hand rule (#784) on recorded hands, with no browser: a simulated hand
 * landmarker replays a fixture recorded looking for every hand, and the host's policy
 * (`stepHandPreference`) decides each frame's count from the previous frame's output, as
 * `webcam-hands` asks the `handCount` resource before it offers a frame.
 *
 * The simulation is the behaviour #480 measured, not MediaPipe: told to look for one hand with two
 * in view it holds the hand it tracks (the nearest to where it was, within `gate` frame heights)
 * and, with probability `switchPerFrame` a frame, loses it and takes whichever it finds (on the
 * conducting clip it switched about every second); told to look for two it returns every hand.
 * So the numbers say what the rule does to which hand a reader gets, not what MediaPipe costs.
 *
 * Pure: frames in, numbers out (the CLI, `prefer_hand.ts`, loads the fixtures).
 */
import { LM, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { preferredHand, type HandPreference } from '@thoremin/sdk/nodes/player_hands';
import { HAND_PREFERENCE_OPTIONS, initialHandPreferenceState, stepHandPreference, type HandCount, type HandPreferenceOptions } from '../../src/instruments/hands';

export interface OneHandLandmarkerOptions {
  /** The farthest a tracked wrist moves in a frame and is still the same hand, in frame heights. */
  gate: number;
  /** The chance a frame that the tracked hand is lost and re-found among those in view. */
  switchPerFrame: number;
  /** Seed of the simulation's random choices, so a run is reproducible. */
  seed: number;
}

/** Hold the tracked hand within a tenth of the frame; no spontaneous switch. */
export const ONE_HAND_LANDMARKER_DEFAULTS: Readonly<OneHandLandmarkerOptions> = Object.freeze({ gate: 0.1, switchPerFrame: 0, seed: 1 });

/** About one switch a second at 30 fps: what #480 saw on the conducting clip. */
export const SWITCH_ABOUT_EVERY_SECOND = 1 / 30;

/** A small seeded generator (mulberry32): uniform in [0, 1). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrist = (h: Hand): { x: number; y: number } => h.keypoints[LM.wrist] ?? { x: NaN, y: NaN };

/** A landmarker stand-in: the hands it returns from a frame, told to look for `count`. */
export function createOneHandLandmarker(options: Partial<OneHandLandmarkerOptions> = {}): (frame: HandsFrame, count: HandCount) => Hand[] {
  const o = { ...ONE_HAND_LANDMARKER_DEFAULTS, ...options };
  const rand = seeded(o.seed);
  let tracked: { x: number; y: number } | null = null;
  return (frame, count) => {
    if (count >= frame.hands.length) {
      tracked = null; // it tracks them all; looking for one again, it takes whichever it finds
      return [...frame.hands];
    }
    let pick: Hand | undefined;
    if (tracked && rand() >= o.switchPerFrame) {
      let best = o.gate * frame.height;
      for (const h of frame.hands) {
        const d = Math.hypot(wrist(h).x - tracked.x, wrist(h).y - tracked.y);
        if (d <= best) [best, pick] = [d, h];
      }
    }
    pick ??= frame.hands[Math.floor(rand() * frame.hands.length)];
    tracked = pick ? wrist(pick) : null;
    return pick ? [pick] : [];
  };
}

/** What a run says, over the frames where two or more hands are in view, the wanted one among them
 *  (the case at issue). */
export interface PreferenceRun {
  frames: number;
  twoInView: number;
  /** Of the two-in-view frames, the share where the reader gets the hand it wants. */
  wantedShare: number;
  /** The share of all frames the model looks for two hands. */
  atTwoShare: number;
  /** The share of all frames at two hands with ONE in view: the palm search the rule pays for (with
   *  none in view the model searches whatever the count; with two it tracks both, no search). */
  searchShare: number;
  /** Count changes per minute (each a live `setNumHands`). */
  changesPerMinute: number;
}

export interface RunOptions {
  /** The frame rate of the recording (for the per-minute rate). */
  fps: number;
  /** The rule on (the host's policy) or off (one hand, as on main before #784). */
  rule: boolean;
  landmarker?: Partial<OneHandLandmarkerOptions>;
  policy?: Readonly<HandPreferenceOptions>;
}

/** Replay `frames` (recorded looking for every hand) for a one-hand reader with `preference`. */
export function runPreference(frames: readonly HandsFrame[], preference: HandPreference, { fps, rule, landmarker, policy = HAND_PREFERENCE_OPTIONS }: RunOptions): PreferenceRun {
  const detect = createOneHandLandmarker(landmarker);
  let state = initialHandPreferenceState();
  let count: HandCount = 1;
  let twoInView = 0, wanted = 0, atTwo = 0, search = 0, changes = 0;
  let previous: { hands: Hand[]; t: number } | undefined;
  frames.forEach((frame, i) => {
    // The count for this frame is decided from the previous frame's output, as the source asks.
    if (rule) {
      state = stepHandPreference(state, 1, preference, previous, policy);
      if (state.count !== count) changes++;
      count = state.count;
    }
    const out = detect(frame, count);
    previous = { hands: out, t: i };
    if (count === 2) {
      atTwo++;
      if (frame.hands.length === 1) search++;
    }
    // Two hands in view, one of them the wanted one (two hands the model gave the same label hold
    // no hand a label reader wants: no rule can help it there).
    const want = frame.hands.length >= 2 ? preferredHand(frame.hands, preference) : undefined;
    if (want) {
      twoInView++;
      if (preferredHand(out, preference) === want) wanted++;
    }
  });
  const n = frames.length;
  return { frames: n, twoInView, wantedShare: twoInView ? wanted / twoInView : 1, atTwoShare: atTwo / n, searchShare: search / n, changesPerMinute: (changes / n) * fps * 60 };
}
