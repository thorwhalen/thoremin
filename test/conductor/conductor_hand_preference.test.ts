/**
 * The conductor's preferred hand (#784): the hand it reads, stated to the host so the hand model
 * tracks that one when two are in view and one is looked for. Checked against the conductor's own
 * choice (`pickHand`, `shapingHand`) on a frame with both hands, over every setting that decides it,
 * so the preference and the reader cannot drift apart (the mirror convention included).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Hand, HandsFrame } from '@thoremin/sdk/nodes/domain';
import { preferredHand } from '@thoremin/sdk/nodes/player_hands';
import { CONDUCTOR_EXPRESSION_SOURCES, CONDUCTOR_HANDS, CONDUCTOR_SOURCES, conductorHandPreference, conductorReadHand, conductorReadsTwoHands, DEFAULT_CONDUCTOR_DIAL, type ConductorDialParams } from '@/slices/conductor/nodes/conductor.schema';
import { CONDUCTOR_BODY_POINTS } from '@/slices/conductor/nodes/conductor_body.schema';
import { pickHand, shapingHand } from '@/slices/conductor/nodes/conductor_hands';
import { liveHandPreference } from '@/app/engine/liveApply';
import { useControls } from '@/app/store';
import { CONDUCTOR } from '../helpers/extensions';

const hand = (handedness: Hand['handedness']): Hand => ({ handedness, keypoints: [{ x: 0, y: 0, z: 0 }] });
const BOTH: HandsFrame = { width: 640, height: 480, hands: [hand('Left'), hand('Right')] };

/** Every combination of the settings that decide which hand the conductor reads. */
function* settings(): Generator<ConductorDialParams> {
  for (const source of CONDUCTOR_SOURCES)
    for (const hand of CONDUCTOR_HANDS)
      for (const expression of CONDUCTOR_EXPRESSION_SOURCES)
        for (const expressionHand of CONDUCTOR_HANDS)
          for (const bodyPoint of CONDUCTOR_BODY_POINTS)
            for (const mirrorHandedness of [true, false]) yield { ...DEFAULT_CONDUCTOR_DIAL, enabled: true, source, hand, expression, expressionHand, bodyPoint, mirrorHandedness };
}

/** The hand the conductor itself reads from a frame: the beating hand, or the shaping hand while
 *  the body or the dancer leads and the hands shape. */
const readByConductor = (c: ConductorDialParams, frame: HandsFrame): Hand | undefined => (c.source === 'hands' ? pickHand(frame, c) : shapingHand(frame, c));

describe.runIf(CONDUCTOR)('the conductor prefers the hand it reads (#784)', () => {
  afterEach(() => useControls.setState(useControls.getInitialState(), true));

  it('names the very hand pickHand / shapingHand take from a frame with both hands', () => {
    let checked = 0;
    for (const c of settings()) {
      const pref = conductorHandPreference(c);
      if (!pref) continue;
      expect(preferredHand(BOTH.hands, pref), JSON.stringify(c)).toBe(readByConductor(c, BOTH));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('prefers no hand when it reads none or two at once, or does not conduct', () => {
    expect(conductorReadHand({ ...DEFAULT_CONDUCTOR_DIAL, enabled: false })).toBeUndefined();
    expect(conductorReadHand({ ...DEFAULT_CONDUCTOR_DIAL, enabled: true, source: 'body', expression: 'same' })).toBeUndefined();
    const split = { ...DEFAULT_CONDUCTOR_DIAL, enabled: true, hand: 'right', expressionHand: 'left' } as const;
    expect(conductorReadsTwoHands(split)).toBe(true);
    expect(conductorReadHand(split)).toBeUndefined();
  });

  it("reaches the host: the default conductor wants the player's right hand, labelled Right by the live camera (#995)", () => {
    const s = useControls.getState();
    const conducting = { ...s, conductor: { ...s.conductor, enabled: true } } as typeof s;
    expect(liveHandPreference(conducting)).toEqual({ kind: 'label', handedness: 'Right' });
    expect(liveHandPreference(s)).toBeUndefined();
  });
});
