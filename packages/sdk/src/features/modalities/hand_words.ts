/**
 * The hand's shape features in a player's words (#385 E8), for the carve's quality hints:
 * "\"shape 2\" is close to \"fist\". They differ mostly in index bend. To tell them apart,
 * straighten your index finger for \"shape 2\"". The face's table is `./face_words.ts`; this is
 * the same contract (`FeatureWords`) over the side-relative hand-shape ids of `./hand.ts`.
 *
 * Directions are the catalog's: a joint ANGLE is the interior angle (pi straight), so it FALLS
 * as the finger bends (`invert`), while a curl is the bend itself; a pinch distance and the
 * thumb's opposition fall as the thumb closes in; a fingertip's reach falls as its finger bends.
 * `test/faces/hand_words_direction.test.ts` checks them on the recorded open/close hand.
 */
import type { FeatureWords } from '../../enroll/modality';

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
type Finger = (typeof FINGERS)[number];

const NOUN: Record<Finger, string> = {
  thumb: 'thumb',
  index: 'index finger',
  middle: 'middle finger',
  ring: 'ring finger',
  pinky: 'little finger',
};

const JOINT: Record<string, string> = { mcpAngle: 'base joint', pipAngle: 'middle joint', dipAngle: 'tip joint' };

const bend = (f: Finger, name: string, invert: boolean): FeatureWords => ({
  name,
  movement: `${f}-bend`,
  more: `bend your ${NOUN[f]} more`,
  less: `straighten your ${NOUN[f]}`,
  ...(invert ? { invert: true } : {}),
});

const PAIR: Record<string, [Finger, Finger]> = {
  indexMiddle: ['index', 'middle'],
  middleRing: ['middle', 'ring'],
  ringPinky: ['ring', 'pinky'],
  thumbIndex: ['thumb', 'index'],
};

const spread = (pair: string): FeatureWords | undefined => {
  const p = PAIR[pair];
  if (!p) return undefined;
  const [a, b] = p.map((f) => NOUN[f].replace(' finger', ''));
  return {
    name: `${a}-${b} spread`,
    movement: `spread-${pair}`,
    more: `spread your ${a} and ${b} fingers apart`,
    less: `bring your ${a} and ${b} fingers together`,
  };
};

/** Whole-hand features, by id. */
const WHOLE: Record<string, FeatureWords> = {
  openness: { name: 'hand open', movement: 'hand-open', more: 'open your hand wider', less: 'close your hand more' },
  curlSum: { name: 'fingers curled', movement: 'fingers-curl', more: 'curl your fingers more', less: 'straighten your fingers' },
  aperture: { name: 'fingers spread', movement: 'fingers-spread', more: 'spread your fingers wider', less: 'keep your fingers closer together' },
  'thumb.opposition': {
    name: 'thumb across the palm',
    movement: 'thumb-across',
    more: 'bring your thumb across your palm',
    less: 'move your thumb out from your palm',
    invert: true,
  },
};

/** A hand-shape feature in plain words, or undefined for one this table does not know. */
export function handWords(featureId: string): FeatureWords | undefined {
  const whole = WHOLE[featureId];
  if (whole) return whole;
  const [head, tail] = featureId.split('.');
  if (!tail) return undefined;
  if ((FINGERS as readonly string[]).includes(head)) {
    const f = head as Finger;
    if (tail === 'curl') return bend(f, `${NOUN[f]} curl`, false);
    if (JOINT[tail]) return bend(f, `${NOUN[f]} ${JOINT[tail]} bend`, true);
    return undefined;
  }
  if (head === 'spread' || head === 'gap') return spread(tail);
  if (head === 'reach' && (FINGERS as readonly string[]).includes(tail)) {
    const f = tail as Finger;
    // A fingertip's reach from the palm falls as the finger bends.
    return bend(f, `${NOUN[f]} reach`, true);
  }
  if (head === 'pinch') {
    const to = tail.replace(/^thumb/, '').toLowerCase() as Finger;
    if (!(FINGERS as readonly string[]).includes(to) || to === 'thumb') return undefined;
    return {
      name: `thumb to ${NOUN[to]} pinch`,
      movement: `pinch-${to}`,
      more: `touch your thumb to your ${NOUN[to]}`,
      less: `move your thumb away from your ${NOUN[to]}`,
      invert: true,
    };
  }
  return undefined;
}
