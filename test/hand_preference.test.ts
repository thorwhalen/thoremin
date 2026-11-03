/**
 * The preferred hand (#784, item 3 of #480): with one hand looked for and two in view, the host
 * looks for two while the tracked hand is not the one a one-hand reader wants, and for one again
 * once only the wanted hand is in view. The pure pieces on scripted frames (`stepHandPreference`,
 * `foldHandPreferences`, `preferredHand`), its thresholds in seconds read from the frames' stamps
 * (#964: the same frame counts at 30 fps as before, twice as many at 60), then a replay of the recorded conducting hands through a
 * simulated one-hand landmarker (`scripts/hands/lib_prefer_hand.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { Hand, HandsFrame } from '@thoremin/sdk/nodes/domain';
import { PREFER_HIGHER_HAND, preferPlayerHand, preferredHand, type HandPreference } from '@thoremin/sdk/nodes/player_hands';
import {
  foldHandPreferences,
  HAND_PREFERENCE_OPTIONS,
  initialHandPreferenceState,
  stepHandPreference,
  type HandCount,
  type HandPreferenceState,
  type ObservedHands,
} from '@/instruments/hands';
import { runPreference, SWITCH_ABOUT_EVERY_SECOND } from '../scripts/hands/lib_prefer_hand';
import { loadStream } from './helpers/fixtures';

/** A hand with only its wrist placed (what the policy reads: the label and the wrist's height). */
const hand = (handedness: Hand['handedness'], wristY = 300): Hand => ({ handedness, keypoints: [{ x: 100, y: wristY, z: 0 }] });
const R = hand('Right');
const L = hand('Left');
const RIGHT: HandPreference = { kind: 'label', handedness: 'Right' };
const { escalateAfterS, settleAfterS, probeEveryS, absentForS, framePeriodS, maxFrameS } = HAND_PREFERENCE_OPTIONS;
/** A duration in frames of an unstamped stream, each counted for the assumed (30 fps) period. */
const framesOf = (seconds: number): number => Math.round(seconds / framePeriodS);
const escalateAfterFrames = framesOf(escalateAfterS);
const settleAfterFrames = framesOf(settleAfterS);
const probeEveryFrames = framesOf(probeEveryS);

/** Step the policy over scripted frames (each a NEW frame: a bare hand list is an unstamped one),
 *  returning the count after each. */
function run(
  frames: readonly (readonly Hand[] | ObservedHands)[],
  preference: HandPreference | undefined,
  derived: HandCount = 1,
  from: HandPreferenceState = initialHandPreferenceState(),
): { counts: HandCount[]; state: HandPreferenceState } {
  let state = from;
  const counts = frames.map((f) => {
    state = stepHandPreference(state, derived, preference, Array.isArray(f) ? { hands: f as readonly Hand[] } : (f as ObservedHands));
    return state.count;
  });
  return { counts, state };
}
const times = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);
/** Frames stamped at `fps`, from `t0`. */
const stamped = (hands: readonly (readonly Hand[])[], fps: number, t0 = 0): ObservedHands[] => hands.map((h, i) => ({ hands: h, t: t0 + i / fps }));

describe('preferredHand', () => {
  it('picks by raw label, or the hand whose wrist is highest in the image', () => {
    expect(preferredHand([L, R], RIGHT)).toBe(R);
    expect(preferredHand([L], RIGHT)).toBeUndefined();
    const low = hand('Right', 500);
    const high = hand('Left', 100);
    expect(preferredHand([low, high], PREFER_HIGHER_HAND)).toBe(high);
  });

  it("states the player's hand in the frame's terms: the mirrored camera swaps the label", () => {
    expect(preferPlayerHand('right', true)).toEqual({ kind: 'label', handedness: 'Left' });
    expect(preferPlayerHand('right', false)).toEqual({ kind: 'label', handedness: 'Right' });
  });
});

describe('foldHandPreferences', () => {
  it('keeps the one hand the readers agree on, and calls two different hands a conflict', () => {
    expect(foldHandPreferences([])).toEqual({ conflict: false });
    expect(foldHandPreferences([undefined, RIGHT, { kind: 'label', handedness: 'Right' }])).toEqual({ preference: RIGHT, conflict: false });
    expect(foldHandPreferences([RIGHT, PREFER_HIGHER_HAND]).conflict).toBe(true);
    expect(foldHandPreferences([RIGHT, { kind: 'label', handedness: 'Left' }]).conflict).toBe(true);
  });
});

describe('stepHandPreference', () => {
  it('with no preference is the derived count exactly, whatever is in view', () => {
    expect(run(times(20, [L]), undefined, 1).counts).toEqual(times(20, 1));
    expect(run(times(20, [L]), undefined, 2).counts).toEqual(times(20, 2));
  });

  it('lets a two-hand need win: a derived two is never lowered', () => {
    expect(run(times(30, [R]), RIGHT, 2).counts).toEqual(times(30, 2));
  });

  it('looks for two once the wrong hand has been tracked for a few frames', () => {
    const { counts } = run(times(escalateAfterFrames, [L]), RIGHT);
    expect(counts.at(-2)).toBe(1);
    expect(counts.at(-1)).toBe(2);
  });

  it('holds one hand through a label flicker shorter than the escalation', () => {
    const flicker = [...times(escalateAfterFrames - 1, [L]), [R], ...times(escalateAfterFrames - 1, [L]), [R]];
    expect(run(flicker, RIGHT).counts).toEqual(times(flicker.length, 1));
  });

  it('stays at two while both hands are in view, and drops back once only the wanted hand is', () => {
    const escalated = run(times(escalateAfterFrames, [L]), RIGHT).state;
    expect(run(times(50, [L, R]), RIGHT, 1, escalated).counts).toEqual(times(50, 2));
    const settled = run(times(settleAfterFrames, [R]), RIGHT, 1, escalated).counts;
    expect(settled.at(-2)).toBe(2);
    expect(settled.at(-1)).toBe(1);
  });

  it('keeps looking for the wanted hand while only the other one is in view', () => {
    const escalated = run(times(escalateAfterFrames, [L]), RIGHT).state;
    expect(run(times(50, [L]), RIGHT, 1, escalated).counts).toEqual(times(50, 2));
  });

  it('starts the settling over on a frame with both hands, and lets a frame with none pass', () => {
    const escalated = run(times(escalateAfterFrames, [L]), RIGHT).state;
    const half = Math.ceil(settleAfterFrames / 2);
    const broken = run([...times(half, [R]), [L, R], ...times(settleAfterFrames - 1, [R])], RIGHT, 1, escalated).counts;
    expect(broken.at(-1)).toBe(2);
    const gapped = run([...times(half, [R]), [], ...times(settleAfterFrames - half, [R])], RIGHT, 1, escalated).counts;
    expect(gapped.at(-1)).toBe(1);
  });

  it('counts the same frame read twice once (the same object, or a copy with the same stamp)', () => {
    const frame: ObservedHands = { hands: [L], t: 1 };
    let state = initialHandPreferenceState();
    for (let i = 0; i < 2 * escalateAfterFrames; i++) state = stepHandPreference(state, 1, RIGHT, frame);
    for (let i = 0; i < 2 * escalateAfterFrames; i++) state = stepHandPreference(state, 1, RIGHT, { hands: [L], t: 1 });
    expect(state.count).toBe(1);
    expect(state.run).toBe(framePeriodS);
  });

  it('starts over on another preference, keeping the count it asks for', () => {
    const almost = run(times(escalateAfterFrames - 1, [L]), RIGHT).state;
    const other = run([[R]], { kind: 'label', handedness: 'Left' }, 1, almost);
    expect(other.counts).toEqual([1]);
    expect(other.state.run).toBe(framePeriodS);
  });

  const lone = hand('Right', 400);
  /** The higher hand's reader settled back on one lone hand, after the look at the hand found. */
  const settledOnLone = (): HandPreferenceState => run(times(settleAfterFrames, [lone]), PREFER_HIGHER_HAND, 1, run([[], [lone]], PREFER_HIGHER_HAND).state).state;

  it('for the higher hand, looks at two when a hand is found after none, and now and then after', () => {
    const found = run([[], [lone]], PREFER_HIGHER_HAND).counts;
    expect(found).toEqual([1, 2]);
    // Settled back on one hand: the next look comes after `probeEveryS` of it.
    const settled = settledOnLone();
    expect(settled.count).toBe(1);
    const later = run(times(probeEveryFrames, [lone]), PREFER_HIGHER_HAND, 1, settled).counts;
    expect(later.at(-2)).toBe(1);
    expect(later.at(-1)).toBe(2);
  });

  it('keeps the frame counts it had before #964 on an unstamped (30 fps) stream', () => {
    expect([escalateAfterFrames, settleAfterFrames, probeEveryFrames]).toEqual([3, 10, 90]);
  });

  it('times its thresholds by the stamps: at 60 fps it escalates after the same time, twice the frames', () => {
    const fps = 60;
    const n = Math.round(escalateAfterS * fps);
    // A frame of the wanted hand first, so every wrong frame counts for its own 1/60 s.
    const { counts } = run(stamped([[R], ...times(n, [L])], fps), RIGHT);
    expect(counts.at(-2)).toBe(1);
    expect(counts.at(-1)).toBe(2);
    expect(n).toBe(2 * escalateAfterFrames);
  });

  it('looks every probeEveryS on a loaded 15 fps camera too, not every 90 frames', () => {
    const fps = 15;
    const t0 = 10; // after the settling, stamped on from there
    const later = run(stamped(times(Math.round(probeEveryS * fps), [lone]), fps, t0), PREFER_HIGHER_HAND, 1, { ...settledOnLone(), frame: { hands: [lone], t: t0 - 1 / fps } }).counts;
    expect(later.at(-2)).toBe(1);
    expect(later.at(-1)).toBe(2);
  });

  it('takes a lone hand back after a one-frame dropout as the same hand, and one back after absentForS as found', () => {
    expect(run([[], [lone]], PREFER_HIGHER_HAND, 1, settledOnLone()).counts).toEqual([1, 1]);
    const k = framesOf(absentForS);
    expect(run([...times(k - 1, []), [lone]], PREFER_HIGHER_HAND, 1, settledOnLone()).counts.at(-1)).toBe(1);
    expect(run([...times(k, []), [lone]], PREFER_HIGHER_HAND, 1, settledOnLone()).counts.at(-1)).toBe(2);
  });

  it('counts a frame after a stalled pipeline for at most maxFrameS: one frame of absence is never a hand found', () => {
    expect(absentForS).toBeGreaterThan(maxFrameS);
    const t0 = 100;
    const stall = [{ hands: [lone], t: t0 }, { hands: [], t: t0 + 5 }, { hands: [lone], t: t0 + 5 + 1 / 30 }];
    expect(run(stall, PREFER_HIGHER_HAND, 1, settledOnLone()).counts).toEqual([1, 1, 1]);
  });
});

describe('the recorded conducting hands (a simulated one-hand landmarker)', () => {
  const frames = loadStream('conducting_44', 'src.hands') as HandsFrame[];
  const FPS = 30;
  /** The rule's floor on this clip: the share of two-hands-in-view frames a reader gets its hand. */
  const WANTED_FLOOR = 0.95;

  for (const [name, preference] of [
    ['a raw label', RIGHT],
    ['the higher hand', PREFER_HIGHER_HAND],
  ] as const) {
    it(`hands a reader that wants ${name} its hand on nearly every two-hand frame`, () => {
      for (const switchPerFrame of [0, SWITCH_ABOUT_EVERY_SECOND]) {
        const without = runPreference(frames, preference, { fps: FPS, rule: false, landmarker: { switchPerFrame } });
        const withRule = runPreference(frames, preference, { fps: FPS, rule: true, landmarker: { switchPerFrame } });
        expect(withRule.wantedShare).toBeGreaterThanOrEqual(WANTED_FLOOR);
        expect(without.wantedShare).toBeLessThan(WANTED_FLOOR);
        expect(without.atTwoShare).toBe(0);
      }
    });
  }
});
