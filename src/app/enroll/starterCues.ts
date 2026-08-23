/**
 * The starter cues (#163) — the face routine thoremin ships with, as data.
 *
 * These are the cues a player sees before they (or an agent) have authored any.
 * They are code, not seed rows: a starter cue is read-only and always comes from
 * here, so improving its wording never fights a stale copy in someone's localStorage,
 * and the voice clips (content-addressed over this text) regenerate exactly when the
 * text changes. Custom cues live in the zodal collection (`cueStore.ts`); the two are
 * merged by id, stored winning, so a player can override a starter by saving a cue
 * under the same name.
 *
 * This file is face-specific ON PURPOSE and it is the ONLY place that is: every type
 * it uses is modality-neutral (`src/enroll` never mentions a face), and a hand routine
 * is another file of the same shape with other group ids.
 *
 * ## The wording rules (enforced in `test/enroll_cues.test.ts`)
 *
 * - **Never a target face to imitate.** A cue asks for a MOVEMENT the player can
 *   interpret ("look to your left") or leaves the choice entirely to them ("any face
 *   you can make reliably"). It never names an expression. Prescribed expressions are
 *   the failure the whole trainer exists to escape.
 * - **Short, second person, one sentence** — it will be spoken.
 * - **The rationale says what it buys**, so the ritual never feels arbitrary.
 *
 * ## Why these nine, in this order
 *
 * `rest` first: it sets the no-man's-land baseline by demonstration AND seeds the
 * noise estimate every later distance is measured in. Then the four head movements
 * (the axes the instrument can already play from, each a likely category of its
 * own), the two tilts (roll is the one axis the recorded fixture never settled — if
 * these keep ending in `cannot`, that is a finding about the pose model, not about the
 * player), the camera-distance nuisance (the one confound the maintainer named, and
 * the one the fixture proved swings the brow channel 0.43→0.89 on its own), and last
 * the free vocabulary — the part that is actually the player's.
 */
import { FEATURE_GROUPS } from '@/features/catalog';
import { CueSchema, type Cue, type CueSpecInput } from '@/enroll';

/**
 * The face groups a training take records. Everything the catalog measures on a face
 * EXCEPT the two gaze families: eye-direction is mostly involuntary and noisy, and a
 * category the player cannot hold is not a category.
 */
export const FACE_TRAINING_GROUPS: readonly string[] = FEATURE_GROUPS.filter(
  (g) => g.source === 'face' && g.id !== 'derived' && !g.id.endsWith('.gaze') && g.id !== 'face.gaze',
).map((g) => g.id);

/**
 * Raw frame position and size are where you SIT, not what you DO: left out of every
 * face cue, so a player who shifts in their chair between cues does not teach the
 * model that "a bit to the left" is an expression. (Camera distance is handled
 * separately, by demonstration — see the nuisance cue.)
 */
export const FACE_OMIT: readonly string[] = ['face.head.x', 'face.head.y', 'face.head.scale', 'face.head.distanceProxy'];

const face = (groups: readonly string[] = FACE_TRAINING_GROUPS) => ({
  groups: [...groups],
  omit: [...FACE_OMIT],
});

/** The head-pose cue shape: one held position, far enough from rest. */
const headMove = (
  id: string,
  name: string,
  instruction: string,
  rationale: string,
  variations: string[],
): Cue =>
  CueSchema.parse({
    id,
    name,
    instruction,
    rationale,
    collects: face(['face.head']),
    produces: 'vocabulary',
    sufficiency: { kind: 'excursion' },
    variations,
    tags: ['face', 'pose'],
  } satisfies CueSpecInput & { id: string; name: string });

const FURTHER = ['A bit further, if you can.', 'As far as is comfortable, and hold it there.'];

export const STARTER_CUES: readonly Cue[] = [
  CueSchema.parse({
    id: 'rest',
    name: 'Rest',
    instruction: 'Look at the camera and relax your face for a few seconds.',
    rationale:
      'Sets what "nothing" looks like, so the instrument can tell when you are not asking for anything.',
    collects: face(),
    produces: 'baseline',
    sufficiency: { kind: 'frames', minFrames: 90 },
    tags: ['face', 'setup'],
  } satisfies CueSpecInput & { id: string; name: string }),

  headMove('look-left', 'Look left', 'Turn your head to look to your left, and hold it.',
    'Learns how far YOU turn, so the axis is scaled to you instead of to a fixed thirty degrees.', FURTHER),
  headMove('look-right', 'Look right', 'Now turn to look to your right, and hold it.',
    'The other end of the same axis.', FURTHER),
  headMove('look-up', 'Look up', 'Tip your head back to look up, and hold it.',
    'The top of the up-down axis.', FURTHER),
  headMove('look-down', 'Look down', 'Now tip your head forward to look down, and hold it.',
    'The bottom of the up-down axis.', FURTHER),
  headMove('tilt-left', 'Tilt left', 'Tilt your head so your left ear moves toward your shoulder, and hold it.',
    'Head tilt is its own axis, and the one the recorded test clip never settled — this is where we find out.', FURTHER),
  headMove('tilt-right', 'Tilt right', 'Now tilt the other way, and hold it.',
    'The other end of the tilt axis.', FURTHER),

  CueSchema.parse({
    id: 'closer-and-further',
    name: 'Closer and further',
    instruction: 'Hold any one face, and move closer to the camera, then further away.',
    rationale:
      'Anything that changes while you do this is camera distance, not expression — the instrument learns to ignore it.',
    collects: { ...face(), axes: ['scale'] },
    produces: 'nuisance',
    sufficiency: { kind: 'frames', minFrames: 120, patienceMs: 30000 },
    tags: ['face', 'setup', 'nuisance'],
  } satisfies CueSpecInput & { id: string; name: string }),

  CueSchema.parse({
    id: 'your-faces',
    name: 'Your faces',
    instruction:
      'Now make faces you can make reliably, whichever ones you like. Hold each one for a moment, then move on to the next.',
    rationale:
      'These become your categories. You choose how many afterwards, so do not count as you go.',
    collects: face(),
    produces: 'vocabulary',
    sufficiency: { kind: 'variety', minPoints: 6 },
    variations: ['Try one you have not done yet.', 'Something quite different this time.', 'One more, and hold it a moment longer.'],
    tags: ['face', 'expression'],
  } satisfies CueSpecInput & { id: string; name: string }),
];

/** The routine a fresh install runs: every starter cue, in the order above. */
export const DEFAULT_ROUTINE_CUE_IDS: readonly string[] = STARTER_CUES.map((c) => c.id);

/** Look one up by id. */
export const starterCueById = (id: string): Cue | undefined => STARTER_CUES.find((c) => c.id === id);
