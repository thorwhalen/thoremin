/**
 * Colorations beyond the key's seventh (`docs/design/harmonic-layers.md` §4, H7 of #613): what a
 * chord gains as the realization's `tension` control rises.
 *
 * - `byTension`: the key's tensions in a fixed order, as many as `tension` (0..1) allows: the
 *   seventh first, then the ninth, then the eleventh on a minor or diminished chord or the
 *   thirteenth on a major one (an eleventh over a major third is the arranger's avoid note).
 *   Each is the scale's own tone, so a chord gains only what its key holds: a ninth a minor
 *   second above the root (iii's, vii's in minor) is an avoid note and is skipped, which leaves
 *   that chord's later tensions skipped too, since the order is the order of stacking thirds.
 *
 * A voicing keeps what it can (the voice-led voicing holds a bass and three upper voices and
 * sheds the fifth first), so the third step is heard only by a voicing that spreads more voices.
 * Pure.
 */
import type { Coloration, Tone } from './strategies';
import type { ToneRole } from './qualities';

const pc = (n: number): number => ((Math.round(n) % 12) + 12) % 12;

/** The tensions in stacking order: for each, the intervals above the root that may fill it, the
 *  first in the key winning, with the role each is. */
const STEPS: readonly (readonly (readonly [number, ToneRole])[])[] = [
  [
    [10, 'b7'],
    [11, '7'],
  ],
  [[14, '9']],
  // Filled by the 11th on a chord with a minor third, else by the 13th (below).
  [
    [17, '11'],
    [21, '13'],
  ],
];

/** How many of the steps a tension of 0..1 adds. */
export const tensionSteps = (tension: number): number => Math.max(0, Math.min(STEPS.length, Math.round(tension * STEPS.length)));

export const byTension: Coloration = {
  id: 'byTension',
  color(tones, controls, context) {
    const scale = context?.scale;
    const steps = tensionSteps(controls.tension);
    if (tones.length === 0 || steps === 0 || !scale || scale.length < 7) return [...tones];
    const root = tones[0].midi;
    const has = (role: ToneRole) => tones.some((t) => t.role === role);
    const minorThird = has('b3');
    const out: Tone[] = [...tones];
    for (let s = 0; s < steps; s++) {
      const options = s === 2 ? STEPS[2].filter(([iv]) => (minorThird ? iv === 17 : iv === 21)) : STEPS[s];
      const pick = options.find(([iv]) => scale.includes(pc(root + iv)));
      if (!pick) break;
      if (!out.some((t) => pc(t.midi) === pc(root + pick[0]))) out.push({ midi: root + pick[0], role: pick[1] });
    }
    return out;
  },
};
