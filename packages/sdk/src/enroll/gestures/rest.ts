/**
 * A rest before the first gesture (#857): a routine that asks for a gesture must first let the
 * session learn what rest looks like on the gesture's features.
 *
 * ## Why
 *
 * The motion segmenter judges motion in noise units, and a gesture cue feeds the session's noise
 * estimate only BETWEEN its repetitions (a wave is deliberate motion, not jitter). So when the
 * hand that gestures is first seen during the gesture cue and waves straight away, the
 * estimator's warm-up learns the wave as the hand's jitter: measured on the scripted wave take
 * with no rest cue before it, 200 ms of rest before the first wave gave a sigma 8 times the
 * rested one and none of the five traces; 500 ms gave four; 1.5 s gave five. A `baseline` cue
 * on the same groups, earlier in the routine, makes the right outcome likely: the player is
 * asked to rest, in view, before being asked to gesture.
 *
 * ## What it does not guarantee
 *
 * Groups are a proxy. A rest cue counts every frame that carries ANY of its features, and every
 * such frame feeds the estimate with the whole vector, so the rest can end `enough` while the
 * part that will gesture was out of view (the left hand rested, the right comes in with the
 * wave: no traces, as before), and a part that first appears during the rest and moves there
 * warms on that motion. The guard that holds whatever the routine is belongs to the gesture
 * cue (withhold until its features are warm, and ask for stillness): #913. Only `baseline`
 * cues count as rest, on purpose: a vocabulary cue warms too, but with deliberate motion in it.
 *
 * The inserted rest is a baseline like any other, so it also feeds the session's rest vectors
 * (the reject radius, the reference of a later `excursion` cue); that is what a rest is for.
 *
 * The carve tool's gesture take (#754, `ext-faces/lib/gestureTake.ts`) builds its routine with it.
 *
 * ## What it does
 *
 * {@link restlessGestures} says which gesture cues lack such a rest (for a check that refuses a
 * routine). {@link withRestBeforeGestures} prepends one: a single `baseline` cue, inserted just
 * before the first gesture cue that needs it, covering every group any such cue attends to.
 * Prepending is the player's better option (the issue's choice): the extension builds the
 * routine, the player never types it, and a refusal would only move the same fix elsewhere.
 * One rest, not one per gesture: a player rests once, and the estimate stays warm across cues.
 * A routine that already rests first is returned as it was.
 */
import { CueSchema, type Cue } from '../cue';

/** The rest cue inserted when the caller names none. The id is reserved within a routine. */
export const GESTURE_REST_CUE = {
  id: 'gesture-rest',
  name: 'Rest',
  instruction: 'Hold still and relaxed, where you will make the gesture.',
  rationale: 'So a deliberate movement can be told from the tracker jitter.',
} as const;

/** A `baseline` cue over `groups`, with the default sufficiency (`frames`, schema defaults). */
export function gestureRestCue(groups: readonly string[]): Cue {
  return CueSchema.parse({
    ...GESTURE_REST_CUE,
    collects: { groups: [...groups] },
    produces: 'baseline',
    sufficiency: { kind: 'frames' },
    tags: ['setup'],
  });
}

/** A gesture cue that runs before any rest on some of its groups, and those groups. */
export interface RestlessGesture {
  cue: Cue;
  groups: string[];
}

/** The gesture cues of `cues`, in order, whose groups are not all covered by an EARLIER
 *  `baseline` cue (the union of every baseline before it). */
export function restlessGestures(cues: readonly Cue[]): RestlessGesture[] {
  const rested = new Set<string>();
  const out: RestlessGesture[] = [];
  for (const cue of cues) {
    if (cue.produces === 'baseline') cue.collects.groups.forEach((g) => rested.add(g));
    if (cue.produces !== 'gesture') continue;
    const groups = cue.collects.groups.filter((g) => !rested.has(g));
    if (groups.length > 0) out.push({ cue, groups });
  }
  return out;
}

/**
 * `cues` with a rest before the first gesture cue that needs one (see the module header).
 * `rest` builds the inserted cue from the groups it must cover (default {@link gestureRestCue}, a
 * modality can word its own); its id must not already be in the routine, and it must be a
 * `baseline` cue covering those groups, or the result would still be restless (refused).
 */
export function withRestBeforeGestures(
  cues: readonly Cue[],
  { rest = gestureRestCue }: { rest?: (groups: readonly string[]) => Cue } = {},
): Cue[] {
  const restless = restlessGestures(cues);
  if (restless.length === 0) return [...cues];
  const groups = [...new Set(restless.flatMap((r) => r.groups))];
  const restCue = rest(groups);
  if (cues.some((c) => c.id === restCue.id)) {
    throw new Error(`the routine already has a cue with the rest cue's id '${restCue.id}'`);
  }
  const at = cues.indexOf(restless[0].cue);
  const out = [...cues.slice(0, at), restCue, ...cues.slice(at)];
  if (restlessGestures(out).length > 0) {
    throw new Error(`the rest cue '${restCue.id}' must be a baseline cue over ${groups.join(', ')}`);
  }
  return out;
}
