/**
 * One face session's take, as a pure state machine over (vector, time) pairs (#330 P2): a few
 * seconds of the player's resting face, then the faces they choose, then a built session ready
 * to carve. No timers, no camera, no React: the panel polls the live vector and pushes it here,
 * and a test pushes a recorded fixture through the same calls.
 *
 * The rest comes FIRST, for two reasons the trainer already relies on: it seeds the noise
 * estimate every later distance is measured in (the session's noise warm-up), and it is what
 * "neutral" means, by demonstration, when the categorizer treats neutral as "none of these"
 * (`createCarver`'s `reject` mode). The same take serves both modes: the player relaxes between
 * expressions anyway, and the switch only changes how the pool is carved.
 *
 * Times are engine-clock milliseconds (the live tap's `t`), the clock the kept video's start
 * is stamped on, so a still-point's `t - t0` seeks the video to it.
 *
 * #385 E2 adds two phases around the capture. **Explore** comes before the rest: the camera is
 * read (every frame feeds the session's noise estimate) and a watching sampler says when a pose
 * is held, but nothing is collected. **Paused** interrupts the capture: the vocabulary cue ends,
 * and resuming begins a NEW cue segment (`faces-yours`, then `faces-yours#2`, ...). The session
 * pools every vocabulary cue, so the carve is unchanged; and each segment has its own sampler,
 * so no still-point is taken inside a pause and none spans one (a hold in progress when Pause is
 * pressed is dropped with its sampler). A take with no pause has exactly the cues it had before.
 */
import { CueSchema, type Cue, type CueSpecInput } from '@thoremin/sdk/enroll/cue';
import { samplingFor } from '@thoremin/sdk/enroll/cue';
import { createStillPointSampler, type StillPointSampler } from '@thoremin/sdk/enroll/sampler';
import { createSession, type Session } from '@thoremin/sdk/enroll/session';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { CarveModality } from '@thoremin/sdk/enroll/modality';
import { faceModality } from '@thoremin/sdk/features/modalities/face';

/** The rest: the baseline and the noise warm-up. */
export function restCue(modality: CarveModality): Cue {
  const { slug, part } = modality.words;
  return CueSchema.parse({
    id: `${slug}-rest`,
    name: 'Rest',
    instruction: `Look at the camera and relax your ${part}.`,
    rationale: `Sets what "nothing" looks like, and how much your ${part} wanders when you are not asking for anything.`,
    collects: modality.collects(),
    produces: 'baseline',
    sufficiency: { kind: 'frames', minFrames: 60 },
    tags: [modality.id, 'setup'],
  } satisfies CueSpecInput & { id: string; name: string });
}

/** The player's own categories in the making: the pool the categories are carved from. */
export function vocabularyCue(modality: CarveModality): Cue {
  const { slug, one, many, category } = modality.words;
  return CueSchema.parse({
    id: `${slug}-yours`,
    name: `Your ${many}`,
    instruction: `Make each ${one} you want the instrument to know. Hold each one for a moment, and relax in between.`,
    rationale: 'These become your categories. You choose how many afterwards, so do not count as you go.',
    collects: modality.collects(),
    produces: 'vocabulary',
    sufficiency: { kind: 'variety', minPoints: 6 },
    tags: [modality.id, category],
  } satisfies CueSpecInput & { id: string; name: string });
}

/** Capture segment `n` (1-based) of the vocabulary cue: the cue itself for the first, a fresh
 *  id after each pause, so beginning it never discards an earlier segment's holds. */
export function segmentCue(modality: CarveModality, n: number): Cue {
  const cue = vocabularyCue(modality);
  return n <= 1 ? cue : { ...cue, id: `${cue.id}#${n}` };
}

/** The resting face: the baseline and the noise warm-up. */
export const FACE_REST_CUE: Cue = restCue(faceModality);

/** The player's own faces: the pool the categories are carved from. */
export const FACE_VOCABULARY_CUE: Cue = vocabularyCue(faceModality);

export const FACE_TAKE_DEFAULTS = {
  /** How long the rest lasts, at least. */
  restMs: 3000,
  /** Rest frames with a face in them needed before the faces begin (the session's noise
   *  warm-up is 30 frames; twice that leaves the estimate settled). */
  minRestFrames: 60,
} as const;

export type FaceTakePhase = 'idle' | 'explore' | 'rest' | 'faces' | 'paused' | 'done';

/** What a hold indicator shows: `open` (moving, or nothing to judge), `settling` (a pose is
 *  being held and will be taken once the dwell is up), `held` (taken, or the pose already
 *  given: move to a new one first). */
export type HoldState = 'open' | 'settling' | 'held';

export interface FaceTakeOptions {
  restMs?: number;
  minRestFrames?: number;
  /** The session to feed (a fresh `createSession()` by default; a test injects options). */
  session?: Session;
  /** What is carved (the face by default): its cues, and whether a frame shows it. */
  modality?: CarveModality;
}

export interface FaceTake {
  phase(): FaceTakePhase;
  /** Read the camera without collecting anything (from idle). */
  explore(tMs: number): void;
  /** Begin the rest at `tMs` (from idle or explore). */
  start(tMs: number): void;
  /** Stop collecting faces (from `faces`); the reading goes on. */
  pause(tMs: number): void;
  /** Collect faces again, in a new cue segment (from `paused`). */
  resume(tMs: number): void;
  /** Capture segments begun so far (0 before the faces). */
  segments(): number;
  /** The hold indicator's state now: the capture's sampler while collecting, a watching
   *  sampler while exploring or paused (what WOULD be taken), `open` otherwise. */
  hold(): HoldState;
  /** Feed one live vector. Ignored while idle or done; a repeat of the last time is dropped.
   *  Exploring or paused, it feeds the noise estimate and the watching sampler only. */
  push(vector: FeatureVector, tMs: number): void;
  /** End the take. Builds the session when there is anything to carve; returns whether it built. */
  stop(): boolean;
  /** The rest frames that had the modality in view (a face) (what "neutral" is, by demonstration). */
  restVectors(): readonly FeatureVector[];
  /** Still-points captured so far (each one a held face). */
  pointCount(): number;
  /** When the faces began (engine ms), or null before. */
  facesStartedAt(): number | null;
  session(): Session;
}

export function createFaceTake(options: FaceTakeOptions = {}): FaceTake {
  const restMs = options.restMs ?? FACE_TAKE_DEFAULTS.restMs;
  const minRestFrames = options.minRestFrames ?? FACE_TAKE_DEFAULTS.minRestFrames;
  const session = options.session ?? createSession();
  const modality = options.modality ?? faceModality;
  const cues = { rest: restCue(modality), vocabulary: vocabularyCue(modality) };
  let phase: FaceTakePhase = 'idle';
  let t0 = 0;
  let lastT = Number.NEGATIVE_INFINITY;
  let facesAt: number | null = null;
  let segment = 0;
  const rest: FeatureVector[] = [];
  /** Exploring or paused: what WOULD be held, judged as the capture judges it (the vocabulary
   *  cue's features, the session's shared noise), never collected. */
  let watch: StillPointSampler | null = null;
  const watching = (armed: boolean): StillPointSampler | null =>
    samplingFor(cues.vocabulary) === 'still-points'
      ? createStillPointSampler({ armed, cue: cues.vocabulary.id, features: session.featuresFor(cues.vocabulary), noise: session.noise() })
      : null;
  const holdOf = (settling: boolean, armed: boolean): HoldState => (!armed ? 'held' : settling ? 'settling' : 'open');

  return {
    phase: () => phase,
    explore() {
      if (phase !== 'idle') return;
      phase = 'explore';
      watch = watching(true);
    },
    start(tMs) {
      if (phase !== 'idle' && phase !== 'explore') return;
      phase = 'rest';
      watch = null;
      t0 = tMs;
      session.beginCue(cues.rest);
    },
    pause() {
      if (phase !== 'faces') return;
      session.endCue();
      phase = 'paused';
      // The pose held as Pause is pressed is one just given: it reads as held until the player moves.
      watch = watching(false);
    },
    resume() {
      if (phase !== 'paused') return;
      watch = null;
      segment++;
      session.beginCue(segmentCue(modality, segment));
      phase = 'faces';
    },
    segments: () => segment,
    hold() {
      if (phase === 'faces') return holdOf(session.settling(), session.armed());
      if ((phase === 'explore' || phase === 'paused') && watch) return holdOf(watch.isSettling(), watch.isArmed());
      return 'open';
    },
    push(vector, tMs) {
      if (phase === 'idle' || phase === 'done') return;
      if (!(tMs > lastT)) return;
      lastT = tMs;
      session.push(vector, tMs);
      if (phase === 'explore' || phase === 'paused') {
        if (modality.read(vector) !== null) watch?.push(vector, tMs);
        return;
      }
      if (phase === 'rest') {
        if (modality.read(vector) !== null) rest.push(vector);
        if (tMs - t0 >= restMs && rest.length >= minRestFrames) {
          session.endCue();
          segment = 1;
          session.beginCue(segmentCue(modality, segment));
          phase = 'faces';
          facesAt = tMs;
        }
      }
    },
    stop() {
      if (phase === 'idle' || phase === 'done') return session.built();
      watch = null;
      if (phase === 'explore') {
        // Nothing was collected: an exploration ends with nothing to carve.
        phase = 'done';
        return false;
      }
      if (session.activeCue()) session.endCue();
      phase = 'done';
      if (!session.ready()) return false;
      session.build();
      return true;
    },
    restVectors: () => rest,
    pointCount: () => session.points().length,
    facesStartedAt: () => facesAt,
    session: () => session,
  };
}
