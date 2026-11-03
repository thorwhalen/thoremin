/**
 * A gesture take (#754, phase 4 of `docs/design/dynamic-gestures.md`): the player names a moving
 * gesture ("wave"), rests, then repeats it a few times with a pause between, and the motion
 * segmenter cuts each repetition out as a trace. A pure state machine over (vector, time) pairs,
 * like the still take (`./take.ts`): no timers, no camera, no React; the store polls the source and
 * pushes here, a test pushes a scripted hand through the same calls.
 *
 * It is the SDK's routine machinery, not a second one: a `gesture` cue (the repetition prompt,
 * "Do the wave 5 times; pause between.", enough at that many traces), a rest before it
 * (`withRestBeforeGestures`, #857: the noise units the segmenter judges motion in must be learned
 * on rest, not on the first wave), run by the cue runner over a session in the modality's space.
 * The traces are the session's (`tracesFor`); what a gesture is a path through is the modality's
 * `gestureCollects` (a hand's raw positions), never its held categories' features.
 *
 * Times are engine-clock milliseconds (the live tap's `t`).
 */
import { CueSchema, type Cue } from '@thoremin/sdk/enroll/cue';
import { withRestBeforeGestures } from '@thoremin/sdk/enroll/gestures/rest';
import { sessionSpace, type CarveModality } from '@thoremin/sdk/enroll/modality';
import { scaleWeights } from '@thoremin/sdk/enroll/noise';
import { createRunner, type Runner, type RunnerOptions } from '@thoremin/sdk/enroll/runner';
import { createSession, type Session } from '@thoremin/sdk/enroll/session';
import type { FeatureVector, FeatureWeights, Trace } from '@thoremin/sdk/enroll/types';

export const GESTURE_TAKE_DEFAULTS = {
  /** Repetitions the prompt asks for: the gesture literature's usual floor is three to five
   *  (design section 7.2); the cue is enough at this many, and the quality chip judges them. */
  repetitions: 5,
} as const;

/** Where a take is: the rest, the repetitions, or over. */
export type GestureTakeStep = 'idle' | 'rest' | 'gesture' | 'done';

/** Whether a modality can record gestures at all. */
export const recordsGestures = (modality: Pick<CarveModality, 'gestureCollects'>): boolean => typeof modality.gestureCollects === 'function';

/** The repetition prompt: a `gesture` cue naming `name`, enough at `repetitions` traces. */
export function gestureCue(modality: CarveModality, { id, name, repetitions = GESTURE_TAKE_DEFAULTS.repetitions }: { id: string; name: string; repetitions?: number }): Cue {
  if (!modality.gestureCollects) throw new Error(`the ${modality.words.part} records no gestures`);
  const gesture = name.trim();
  return CueSchema.parse({
    id,
    name: gesture,
    instruction: `Do the ${gesture} ${repetitions} times; pause between.`,
    rationale: 'Each repetition becomes one example of it, so make the same movement each time, and let your hand come to rest in between.',
    collects: modality.gestureCollects(),
    produces: 'gesture',
    gesture,
    sufficiency: { kind: 'repetitions', minTraces: repetitions },
    tags: [modality.id, 'gesture'],
  });
}

export interface GestureTakeOptions {
  modality: CarveModality;
  /** The gesture's name, as the player typed it. */
  name: string;
  /** The gesture cue's id: unique per take (its traces are `<id>#n`). */
  cueId: string;
  repetitions?: number;
  /** The session to feed (a fresh one over the modality's space by default). */
  session?: Session;
  /** The runner's pacing (its own defaults otherwise). */
  pacing?: Pick<RunnerOptions, 'beatMs' | 'evaluateEveryMs'>;
}

export interface GestureTake {
  /** Begin the routine at `tMs` (the rest first). */
  start(tMs: number): void;
  /** Feed one vector (the modality's projected one). */
  push(vector: FeatureVector, tMs: number): void;
  /** Let time pass with no vector (no hand in view). */
  tick(tMs: number): void;
  /** End the take, keeping what was cut. */
  stop(tMs: number): void;
  step(): GestureTakeStep;
  /** What the runner says now (the instruction, a nudge, "Good."), or null. */
  say(): string | null;
  /** The rest's progress (0..1) while resting, else null. */
  restProgress(): number | null;
  /** Repetitions cut so far, and how many the prompt asks for. */
  count(): number;
  target(): number;
  /** The repetitions cut, as traces of the gesture's name (the whole projected vector per frame). */
  traces(): Trace[];
  /** The features the gesture is matched on: the cue's, those with a measured noise unit. */
  features(): string[];
  /** Their weights: the session's noise units (`scaleWeights`). */
  weights(): FeatureWeights;
  session(): Session;
}

export function createGestureTake(options: GestureTakeOptions): GestureTake {
  const { modality } = options;
  const repetitions = options.repetitions ?? GESTURE_TAKE_DEFAULTS.repetitions;
  const cue = gestureCue(modality, { id: options.cueId, name: options.name, repetitions });
  const session = options.session ?? createSession(sessionSpace(modality));
  const cues = withRestBeforeGestures([cue]);
  const runner: Runner = createRunner({ cues, session, ...options.pacing });
  const cueFeatures = session.featuresFor(cue);
  const weightsNow = (): FeatureWeights => {
    const all = scaleWeights(session.noise().snapshot());
    return Object.fromEntries(cueFeatures.filter((f) => Object.hasOwn(all, f) && Number.isFinite(all[f])).map((f) => [f, all[f]]));
  };
  return {
    start: (tMs) => runner.start(tMs),
    push: (vector, tMs) => runner.push(vector, tMs),
    tick: (tMs) => runner.tick(tMs),
    stop: (tMs) => {
      const s = runner.state().status;
      if (s === 'running' || s === 'between') runner.stop(tMs);
    },
    step() {
      const s = runner.state();
      if (s.status === 'idle') return 'idle';
      if (s.status === 'done' || s.status === 'stopped') return 'done';
      return cues[s.index]?.produces === 'gesture' ? 'gesture' : 'rest';
    },
    say: () => runner.state().say,
    restProgress() {
      const s = runner.state();
      return s.status === 'running' && s.cue?.produces === 'baseline' ? s.coverage : null;
    },
    count: () => session.tracesFor(cue.id).length,
    target: () => repetitions,
    traces: () => session.tracesFor(cue.id),
    features() {
      const w = weightsNow();
      return cueFeatures.filter((f) => Object.hasOwn(w, f));
    },
    weights: weightsNow,
    session: () => session,
  };
}
