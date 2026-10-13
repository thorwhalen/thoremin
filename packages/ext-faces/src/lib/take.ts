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
 */
import { CueSchema, type Cue, type CueSpecInput } from '@thoremin/sdk/enroll/cue';
import { createSession, type Session } from '@thoremin/sdk/enroll/session';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { faceCollects } from '@thoremin/sdk/features/face_groups';

/** The resting face: the baseline and the noise warm-up. */
export const FACE_REST_CUE: Cue = CueSchema.parse({
  id: 'faces-rest',
  name: 'Rest',
  instruction: 'Look at the camera and relax your face.',
  rationale: 'Sets what "nothing" looks like, and how much your face wanders when you are not asking for anything.',
  collects: faceCollects(),
  produces: 'baseline',
  sufficiency: { kind: 'frames', minFrames: 60 },
  tags: ['face', 'setup'],
} satisfies CueSpecInput & { id: string; name: string });

/** The player's own faces: the pool the categories are carved from. */
export const FACE_VOCABULARY_CUE: Cue = CueSchema.parse({
  id: 'faces-yours',
  name: 'Your faces',
  instruction: 'Make each face you want the instrument to know. Hold each one for a moment, and relax in between.',
  rationale: 'These become your categories. You choose how many afterwards, so do not count as you go.',
  collects: faceCollects(),
  produces: 'vocabulary',
  sufficiency: { kind: 'variety', minPoints: 6 },
  tags: ['face', 'expression'],
} satisfies CueSpecInput & { id: string; name: string });

export const FACE_TAKE_DEFAULTS = {
  /** How long the rest lasts, at least. */
  restMs: 3000,
  /** Rest frames with a face in them needed before the faces begin (the session's noise
   *  warm-up is 30 frames; twice that leaves the estimate settled). */
  minRestFrames: 60,
} as const;

export type FaceTakePhase = 'idle' | 'rest' | 'faces' | 'done';

export interface FaceTakeOptions {
  restMs?: number;
  minRestFrames?: number;
  /** The session to feed (a fresh `createSession()` by default; a test injects options). */
  session?: Session;
}

export interface FaceTake {
  phase(): FaceTakePhase;
  /** Begin the rest at `tMs`. */
  start(tMs: number): void;
  /** Feed one live vector. Ignored while idle or done; a repeat of the last time is dropped. */
  push(vector: FeatureVector, tMs: number): void;
  /** End the take. Builds the session when there is anything to carve; returns whether it built. */
  stop(): boolean;
  /** The rest frames that had a face in them (what "neutral" is, by demonstration). */
  restVectors(): readonly FeatureVector[];
  /** Still-points captured so far (each one a held face). */
  pointCount(): number;
  /** When the faces began (engine ms), or null before. */
  facesStartedAt(): number | null;
  session(): Session;
}

const hasFace = (v: FeatureVector): boolean => Object.keys(v).some((k) => k.startsWith('face.') && Number.isFinite(v[k]));

export function createFaceTake(options: FaceTakeOptions = {}): FaceTake {
  const restMs = options.restMs ?? FACE_TAKE_DEFAULTS.restMs;
  const minRestFrames = options.minRestFrames ?? FACE_TAKE_DEFAULTS.minRestFrames;
  const session = options.session ?? createSession();
  let phase: FaceTakePhase = 'idle';
  let t0 = 0;
  let lastT = Number.NEGATIVE_INFINITY;
  let facesAt: number | null = null;
  const rest: FeatureVector[] = [];

  return {
    phase: () => phase,
    start(tMs) {
      if (phase !== 'idle') return;
      phase = 'rest';
      t0 = tMs;
      session.beginCue(FACE_REST_CUE);
    },
    push(vector, tMs) {
      if (phase !== 'rest' && phase !== 'faces') return;
      if (!(tMs > lastT)) return;
      lastT = tMs;
      session.push(vector, tMs);
      if (phase === 'rest') {
        if (hasFace(vector)) rest.push(vector);
        if (tMs - t0 >= restMs && rest.length >= minRestFrames) {
          session.endCue();
          session.beginCue(FACE_VOCABULARY_CUE);
          phase = 'faces';
          facesAt = tMs;
        }
      }
    },
    stop() {
      if (phase === 'idle' || phase === 'done') return session.built();
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
